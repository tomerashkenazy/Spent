import "server-only";

import type { Page } from "puppeteer";
import {
  clickByText,
  delay,
  fillByLabel,
  fillField,
  localPhone,
  readSavingsTiles,
  SAVINGS_KEYWORDS,
  tilesToAccounts,
} from "./pension/common";
import {
  runVisiblePortal,
  type VisiblePortalOptions,
  type VisiblePortalResult,
} from "./pension/visible-portal";
import type { ScrapedInvestmentAccount } from "./types";

/**
 * Analyst (אנליסט) gemel and study fund member portal: ID, phone and an SMS
 * code. Its invisible reCAPTCHA rejects automated browsers ("Recapcha
 * validation failed"), so the first sign-in runs in a visible window: Spent
 * fills the ID and phone, the user clicks "send code" and types the SMS code
 * there. It is an Angular app, so web storage is saved with the cookies and
 * later syncs read headless until the session expires.
 */

const LOGIN_URL = "https://amitim.analyst.co.il/auth/login?redirectUrl=%2Flobby";
const LOBBY_URL = "https://amitim.analyst.co.il/lobby";
const ID_LABEL = "תעודת זהות";
const PHONE_LABEL = "טלפון נייד";
const DISMISS_LABELS = ["הבנתי", "סגירה", "סגור"];
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export type AnalystSyncResult = VisiblePortalResult;

async function prefill(page: Page, id: string, phone: string): Promise<void> {
  const ready = await page
    .waitForSelector("input[matinput]", { timeout: SIGN_IN_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!ready) return;
  await delay(1500);
  // ID is the default document type. The Material inputs get generated ids,
  // so fall back to their usual order.
  if (!(await fillByLabel(page, ID_LABEL, id))) await fillField(page, "#mat-input-0", id);
  const local = localPhone(phone);
  if (!(await fillByLabel(page, PHONE_LABEL, local))) {
    await fillField(page, "#mat-input-1", local);
  }
  // The "send code" click is left to the user: reCAPTCHA scores it.
}

let loggedLobby = false;

async function readAnalyst(page: Page): Promise<ScrapedInvestmentAccount[]> {
  let path: string;
  try {
    path = new URL(page.url()).pathname;
  } catch {
    return [];
  }
  if (path.startsWith("/auth")) return [];

  await clickByText(page, DISMISS_LABELS);
  const tiles = (
    await Promise.all(page.frames().map((frame) => readSavingsTiles(frame)))
  ).flat();

  if (process.env.SPENT_DEBUG_SCRAPERS === "1" && !loggedLobby) {
    loggedLobby = true;
    // Structure only, to map the page later. Never amounts or names.
    const shape = await page
      .evaluate((keywords: string[]) => {
        const text = document.body.innerText || "";
        return {
          shekelSigns: (text.match(/₪/g) || []).length,
          keywords: keywords.filter((k) => text.includes(k)),
        };
      }, SAVINGS_KEYWORDS)
      .catch(() => null);
    console.log(`[analyst] signed in at ${path}`, JSON.stringify(shape), `tiles: ${tiles.length}`);
  }
  return tilesToAccounts(tiles, "analyst");
}

export function scrapeAnalyst(opts: VisiblePortalOptions): Promise<AnalystSyncResult> {
  loggedLobby = false;
  return runVisiblePortal(
    {
      tag: "analyst",
      name: "Analyst",
      loginUrl: LOGIN_URL,
      resumeUrl: LOBBY_URL,
      prefill,
      read: readAnalyst,
      // The lobby loads its data after the page itself.
      resumeReadMs: 30_000,
      saveStorage: true,
    },
    opts
  );
}
