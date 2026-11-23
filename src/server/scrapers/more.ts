import "server-only";

import type { Page } from "puppeteer";
import type { InvestmentKind } from "@/lib/types";
import {
  clickByText,
  delay,
  fillByLabel,
  localPhone,
  pollSavingsTiles,
  roundMoney,
} from "./pension/common";
import {
  runSmsPortal,
  type SmsPortalOptions,
  type SmsPortalResult,
} from "./pension/sms-portal";
import type { ScrapedInvestmentAccount } from "./types";

/**
 * More (מור) gemel, study fund and pension member portal: ID, phone and an
 * SMS code, behind an invisible reCAPTCHA. It is an Angular app that keeps
 * its login token in sessionStorage, so that is saved with the cookies.
 *
 * After sign-in the dashboard caches its accounts in sessionStorage under
 * "accountData": `[own, managed]`, each `{ accountData: [{ productType,
 * totalProductAmount, productsDetails: [{ kupaNum, ... }] }] }`. Only the
 * member's own funds (index 0) are read; index 1 holds funds they manage
 * for others.
 */

const LOGIN_URL = "https://my-account.more.co.il/personalarea/login";
const DASHBOARD_URL = "https://my-account.more.co.il/personalarea/dashboard";
const ID_LABEL = "מספר ת.ז";
const PHONE_LABEL = "טלפון נייד";
const SUBMIT_LABELS = ["כניסה לאזור האישי"];

// productType enum from More's app bundle.
const PRODUCT_TYPES: Record<number, { name: string; kind: InvestmentKind }> = {
  1: { name: "קרן השתלמות", kind: "hishtalmut" },
  2: { name: "קופת גמל", kind: "gemel" },
  3: { name: "קרן פנסיה", kind: "pension" },
  4: { name: "גמל להשקעה", kind: "gemel_lehashkaa" },
  5: { name: "חיסכון לכל ילד", kind: "gemel" },
  6: { name: "קרן השתלמות IRA", kind: "hishtalmut" },
  7: { name: "קופת גמל IRA", kind: "gemel" },
};

const BALANCE_KEYS = ["totalProductAmount", "balance", "totalAmount", "amount", "totalBalance"];
const NAME_KEYS = ["productName", "maslulName", "kupaName"];

type Json = Record<string, unknown>;

function firstNumber(item: Json, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(item[key]);
    if (item[key] !== undefined && item[key] !== null && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function firstString(item: Json, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Turns the dashboard cache into accounts. Exported for tests. */
export function moreAccountsFromCache(cache: unknown): ScrapedInvestmentAccount[] {
  if (!Array.isArray(cache)) return [];
  const own = cache[0] as Json | undefined;
  const groups = Array.isArray(own?.accountData) ? (own.accountData as Json[]) : [];
  const accounts: ScrapedInvestmentAccount[] = [];

  for (const group of groups) {
    const type = PRODUCT_TYPES[Number(group.productType)];
    const typeName = type?.name ?? "חיסכון";
    const kind = type?.kind ?? "gemel";
    const details = Array.isArray(group.productsDetails)
      ? (group.productsDetails as Json[])
      : [];

    const perFund = details
      .map((item) => ({ item, balance: firstNumber(item, BALANCE_KEYS) }))
      .filter((d): d is { item: Json; balance: number } => d.balance !== null);

    if (perFund.length > 0) {
      for (const { item, balance } of perFund) {
        if (balance <= 0) continue;
        const kupaNum = item.kupaNum !== undefined ? String(item.kupaNum) : null;
        const detail = firstString(item, NAME_KEYS);
        accounts.push({
          externalId: `more:${kupaNum ?? `${typeName}:${detail ?? accounts.length}`}`,
          kind,
          name: detail && !detail.includes(typeName) ? `${typeName} - ${detail}` : (detail ?? typeName),
          currency: "ILS",
          totalValue: roundMoney(balance),
          holdings: [],
        });
      }
      continue;
    }

    // No per-fund figures: one account for the product type's total.
    const total = Number(group.totalProductAmount);
    if (Number.isFinite(total) && total > 0) {
      accounts.push({
        externalId: `more:type-${String(group.productType)}`,
        kind,
        name: typeName,
        currency: "ILS",
        totalValue: roundMoney(total),
        holdings: [],
      });
    }
  }
  return accounts;
}

async function readMoreBalances(
  page: Page,
  timeoutMs: number
): Promise<ScrapedInvestmentAccount[]> {
  const debug = process.env.SPENT_DEBUG_SCRAPERS === "1";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cache = await page
      .evaluate(() => {
        try {
          return JSON.parse(sessionStorage.getItem("accountData") || "null") as unknown;
        } catch {
          return null;
        }
      })
      .catch(() => null);
    if (cache) {
      if (debug) {
        // Field names only, to check the mapping. Never values.
        const own = (Array.isArray(cache) ? cache[0] : null) as Json | null;
        const group = (own?.accountData as Json[] | undefined)?.[0];
        const item = (group?.productsDetails as Json[] | undefined)?.[0];
        console.log("[more] group fields:", group ? Object.keys(group).join(", ") : "-");
        console.log("[more] fund fields:", item ? Object.keys(item).join(", ") : "-");
      }
      const accounts = moreAccountsFromCache(cache);
      if (accounts.length > 0) return accounts;
    }
    await delay(1500);
  }
  // The cache was never written or held nothing usable; try the page itself.
  return pollSavingsTiles(page, "more", 10_000);
}

async function submitLogin(page: Page, id: string, phone: string): Promise<boolean> {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const ready = await page
    .waitForSelector("input[type=tel]", { timeout: 40_000 })
    .then(() => true)
    .catch(() => false);
  if (!ready) return false;
  await delay(1500);
  if (!(await fillByLabel(page, ID_LABEL, id))) return false;
  if (!(await fillByLabel(page, PHONE_LABEL, localPhone(phone)))) return false;
  await delay(800);
  if (!(await clickByText(page, SUBMIT_LABELS))) await page.keyboard.press("Enter");
  return true;
}

export type MoreSyncResult = SmsPortalResult;

export function scrapeMore(opts: SmsPortalOptions): Promise<MoreSyncResult> {
  return runSmsPortal(
    {
      tag: "more",
      name: "More",
      productsUrl: DASHBOARD_URL,
      isLoginUrl: (url) => /\/login/i.test(url),
      submitLogin,
      readBalances: readMoreBalances,
      navigateAfterCode: false,
      saveStorage: true,
      // Replaying it would show the balances from the last sync.
      dropStorageKeys: ["accountData"],
      codeSentPath: /\/api\/auth\/SignIn$/,
    },
    opts
  );
}
