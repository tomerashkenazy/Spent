import "server-only";

import type { Page } from "puppeteer";
import {
  clickByText,
  delay,
  fillField,
  localPhone,
  pollSavingsTiles,
} from "./pension/common";
import {
  runSmsPortal,
  type SmsPortalOptions,
  type SmsPortalResult,
} from "./pension/sms-portal";
import type { ScrapedInvestmentAccount } from "./types";

/**
 * Harel's member portal: passwordless sign-in with ID, phone and an SMS code,
 * run headless. Balances render in the "client-view" widget, a cross-origin
 * iframe. The session cookies are saved so a later sync can skip the SMS.
 */

const LOGIN_URL = "https://www.harel-group.co.il/Pages/login-Page/Login.aspx";
const PRODUCTS_URL =
  "https://www.harel-group.co.il/personal-info/my-harel/Pages/client-view.aspx";
const OPEN_LOGIN_LABEL = "כניסה לאזור האישי";
const ID_FIELD = "#idUser";
const PHONE_FIELD = "#phone";
const SUBMIT_LABELS = ["המשך", "כניסה", "שלח"];
const DISMISS_LABELS = ["הבנתי, תודה", "הבנתי", "אישור", "סגירה", "סגור", "קיבלתי"];

export type HarelSyncResult = SmsPortalResult;
export type HarelOptions = SmsPortalOptions;

/**
 * Polls every frame until one shows balances. Harel shows a loading screen
 * first. The page's own URL also contains "client-view", so matching frames
 * by URL would pick the empty top page instead of the widget's iframe.
 */
function readHarelBalances(
  page: Page,
  timeoutMs: number
): Promise<ScrapedInvestmentAccount[]> {
  // A privacy notice and a cookie banner can cover the widget, sometimes late.
  return pollSavingsTiles(page, "harel", timeoutMs, DISMISS_LABELS);
}

/** Opens the login panel, fills ID and phone, and asks Harel to text a code. */
async function submitLogin(page: Page, id: string, phone: string): Promise<boolean> {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // The login form hides behind a button, and the page also renders a
  // zero-size copy of it, so click the visible one with a real mouse click.
  try {
    await page.waitForSelector("button, [role=button]", { timeout: 40_000 });
    await delay(2000);
    const point = await page.evaluate((label: string) => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("button, a, [role=button]")
      );
      for (const node of nodes) {
        if ((node.innerText || "").replace(/\s+/g, " ").trim() !== label) continue;
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    }, OPEN_LOGIN_LABEL);
    if (point) {
      await page.mouse.click(point.x, point.y);
      await delay(1500);
    }
  } catch {
    // The ID field wait below reports the failure.
  }

  let filled = false;
  for (let attempt = 0; attempt < 3 && !filled; attempt += 1) {
    const ready = await page
      .waitForSelector(ID_FIELD, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!ready) continue;
    await delay(1500);
    filled = await fillField(page, ID_FIELD, id);
  }
  if (!filled) return false;

  await fillField(page, PHONE_FIELD, localPhone(phone));
  await delay(800);
  if (!(await clickByText(page, SUBMIT_LABELS))) {
    await page.keyboard.press("Enter");
  }
  return true;
}

export function scrapeHarel(opts: HarelOptions): Promise<HarelSyncResult> {
  return runSmsPortal(
    {
      tag: "harel",
      name: "Harel",
      productsUrl: PRODUCTS_URL,
      isLoginUrl: (url) => /login/i.test(url),
      submitLogin,
      readBalances: readHarelBalances,
      navigateAfterCode: true,
    },
    opts
  );
}
