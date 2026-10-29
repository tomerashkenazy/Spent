import "server-only";

import { fetchPostWithinPage } from "israeli-bank-scrapers/lib/helpers/fetch";
import type { HTTPRequest, Page } from "puppeteer";
import type { ScrapedInvestmentAccount } from "../types";
import {
  mapTradeAccountView,
  SECURITY_FIELDS,
  type AccountView,
} from "./trade-view";

/**
 * Securities portfolio ("מסחר בשוק ההון", MyTrade) inside the logged-in Bank
 * Hapoalim session. Ported from eshaham/israeli-bank-scrapers PR #1026 (not
 * merged upstream). The trading API rejects calls without the `session` and
 * `csession` headers its own frontend sends, and those only exist after the
 * MyTrade app has loaded, so the page is sent there and the headers are read
 * off its outgoing requests.
 */

const MYTRADE_PATH = "/mytrade/app";
const MYTRADE_LOAD_TIMEOUT_MS = 60000;
const HEADER_WAIT_MS = 15000;
const POLL_INTERVAL_MS = 500;

async function captureSessionHeaders(
  page: Page,
  url: string
): Promise<{ session: string; csession: string } | null> {
  let session: string | null = null;
  let csession: string | null = null;
  // Reading headers needs no request interception, so nothing is blocked.
  const onRequest = (request: HTTPRequest) => {
    const headers = request.headers();
    if (headers.session && !session) session = headers.session;
    if (headers.csession && !csession) csession = headers.csession;
  };
  page.on("request", onRequest);
  try {
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: MYTRADE_LOAD_TIMEOUT_MS,
    });
    const deadline = Date.now() + HEADER_WAIT_MS;
    while ((!session || !csession) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } finally {
    page.off("request", onRequest);
  }
  return session && csession ? { session, csession } : null;
}

/**
 * `accountNumbers` are the scraper's "bank-branch-account" ids. Returns one
 * brokerage account per bank account that has a securities portfolio, and an
 * empty list when MyTrade is not enabled for this customer.
 */
export async function fetchHapoalimSecurities(
  page: Page,
  baseUrl: string,
  accountNumbers: string[]
): Promise<ScrapedInvestmentAccount[]> {
  const mytradeUrl = `${baseUrl}${MYTRADE_PATH}`;
  const headers = await captureSessionHeaders(page, mytradeUrl);
  if (!headers) {
    console.warn("[hapoalim] securities skipped: trading session not established");
    return [];
  }

  const xsrf = (await page.browserContext().cookies()).find(
    (c) => c.name === "XSRF-TOKEN"
  );
  const results: ScrapedInvestmentAccount[] = [];

  for (const accountNumber of accountNumbers) {
    // The trading API wants "branch-account", without the bank number.
    const [, branch, account] = accountNumber.split("-");
    if (!branch || !account) continue;
    const url = `${baseUrl}/ServerServices/mytrade/api/v2/json2/account/view?account=${branch}-${account}&fields=${SECURITY_FIELDS}`;
    const view = await fetchPostWithinPage<AccountView>(
      page,
      url,
      {},
      {
        "Content-Type": "application/json; charset=utf-8",
        session: headers.session,
        csession: headers.csession,
        Referer: mytradeUrl,
        ...(xsrf ? { "X-XSRF-TOKEN": xsrf.value } : {}),
      },
      // A parse error would echo the response body into the message.
      true
    );
    const mapped = view
      ? mapTradeAccountView(
          view,
          `${accountNumber}-securities`,
          `Securities ${branch}-${account}`
        )
      : null;
    if (mapped) results.push(mapped);
  }
  return results;
}
