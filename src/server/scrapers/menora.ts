import "server-only";

import type { Page } from "puppeteer";
import type { InvestmentKind } from "@/lib/types";
import {
  delay,
  fillField,
  localPhone,
  pensionKindFromTitle,
  roundMoney,
} from "./pension/common";
import {
  runVisiblePortal,
  type VisiblePortalOptions,
  type VisiblePortalResult,
} from "./pension/visible-portal";
import type { ScrapedInvestmentAccount } from "./types";

/**
 * Menora Mivtachim's member portal sits behind a captcha that automation
 * can't pass. So the first sign-in happens in a visible Chrome window: Spent
 * fills the ID and phone, the user clears the captcha and types the SMS code,
 * and Spent reads the balances from the dashboard API once that works. The
 * session cookies are saved, so later syncs read headless until they expire.
 */

const HOME_URL = "https://www.menoramivt.co.il/";
const LOGIN_URL = "https://www.menoramivt.co.il/customer-login/";
const SUMMARY_PATH = "/personal/dashboard/api/v1/customer-summary/active";
const ID_FIELD = "#id-num";
const PHONE_FIELD = "#email-phone-num";
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export type MenoraSyncResult = VisiblePortalResult;
export type MenoraOptions = VisiblePortalOptions;

interface SummaryRow {
  group: string;
  title?: string;
  balance?: number;
}

// Arrays in the dashboard summary that hold savings. socialBenefit holds both
// gemel and study funds; the insurance arrays are skipped.
const SAVINGS_GROUPS: Record<string, InvestmentKind | null> = {
  pension: "pension",
  managerFund: "pension",
  annuity: "pension",
  socialBenefit: null,
};

/** Reads the dashboard summary. Returns null until the session is signed in. */
async function readSummary(page: Page): Promise<SummaryRow[] | null> {
  const debug = process.env.SPENT_DEBUG_SCRAPERS === "1";
  try {
    const result = await page.evaluate(
      async (path: string, groups: string[], withKeys: boolean) => {
        const uuid =
          Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
        const res = await fetch(`${path}?counter=1&uuid=${uuid}`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return null;
        const body = (await res.json().catch(() => null)) as {
          data?: Record<string, unknown>;
        } | null;
        if (!body?.data) return null;
        const rows: { group: string; title?: string; balance?: number }[] = [];
        const keys: Record<string, string[]> = {};
        for (const group of groups) {
          const list = body.data[group];
          if (!Array.isArray(list)) continue;
          for (const item of list as Record<string, unknown>[]) {
            if (withKeys) keys[group] = Object.keys(item);
            rows.push({
              group,
              title: typeof item.title === "string" ? item.title : undefined,
              balance: Number(item.cashSurrenderValue),
            });
          }
        }
        return { rows, keys, groups: withKeys ? Object.keys(body.data) : [] };
      },
      SUMMARY_PATH,
      Object.keys(SAVINGS_GROUPS),
      debug
    );
    if (!result) return null;
    if (debug) {
      // Field names only, to map more of the summary later. Never values.
      console.log("[menora] summary groups:", result.groups.join(", "));
      for (const [group, keys] of Object.entries(result.keys)) {
        console.log(`[menora] ${group} fields:`, keys.join(", "));
      }
    }
    return result.rows;
  } catch {
    // The page navigated mid-read, or the API refused us.
    return null;
  }
}

function toAccounts(rows: SummaryRow[]): ScrapedInvestmentAccount[] {
  const accounts: ScrapedInvestmentAccount[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    const name = (row.title ?? "").trim();
    const balance = Number(row.balance);
    if (!name || !Number.isFinite(balance) || balance <= 0) continue;
    // Two products can share a title, so number the repeats.
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    accounts.push({
      externalId: count === 1 ? `menora:${name}` : `menora:${name}#${count}`,
      kind: SAVINGS_GROUPS[row.group] ?? pensionKindFromTitle(name),
      name,
      currency: "ILS",
      totalValue: roundMoney(balance),
      holdings: [],
    });
  }
  return accounts;
}

async function prefill(page: Page, id: string, phone: string): Promise<void> {
  // The form only renders after the captcha, so this wait spans the user's
  // time on it.
  const ready = await page
    .waitForSelector(ID_FIELD, { timeout: SIGN_IN_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!ready) return;
  await delay(900);
  await fillField(page, ID_FIELD, id);
  if (phone) await fillField(page, PHONE_FIELD, localPhone(phone));
}

async function readMenora(page: Page): Promise<ScrapedInvestmentAccount[]> {
  const rows = await readSummary(page);
  return rows ? toAccounts(rows) : [];
}

export function scrapeMenora(opts: MenoraOptions): Promise<MenoraSyncResult> {
  return runVisiblePortal(
    {
      tag: "menora",
      name: "Menora",
      loginUrl: LOGIN_URL,
      resumeUrl: HOME_URL,
      prefill,
      read: readMenora,
    },
    opts
  );
}
