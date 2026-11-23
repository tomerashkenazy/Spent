import "server-only";

import type { Browser, Page } from "puppeteer";
import {
  captureSession,
  decodePensionSession,
  delay,
  launchPensionBrowser,
  logJsonPaths,
  restoreSession,
} from "./common";
import type { ScrapedInvestmentAccount, ScrapeResult } from "../types";

/**
 * For portals whose sign-in a script can't pass (a captcha, or a bot score
 * that rejects automated browsers): the first sign-in happens in a visible
 * window. Spent fills the ID and phone, the user finishes the sign-in there,
 * and Spent reads the balances once it works. The session is saved, so later
 * syncs read headless until it expires.
 */

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface VisiblePortalResult extends ScrapeResult {
  otpLongTermToken?: string;
  needsOtp?: boolean;
}

export interface VisiblePortalOptions {
  id: string;
  phone: string;
  savedSession?: string;
  /** False for scheduled syncs and tests: never open a window. */
  interactive: boolean;
  /** Called when the sign-in window opens. */
  onWindowOpen?: () => void;
}

export interface VisiblePortalSpec {
  /** Log prefix. */
  tag: string;
  /** Shown in error messages. */
  name: string;
  loginUrl: string;
  /** Opened with a saved session; shows balances when it still works. */
  resumeUrl: string;
  /** Fills what it can of the sign-in form. May wait for the form to appear. */
  prefill: (page: Page, id: string, phone: string) => Promise<void>;
  /**
   * One quick attempt at the balances. Empty until the page is signed in;
   * called every few seconds while the user signs in.
   */
  read: (page: Page) => Promise<ScrapedInvestmentAccount[]>;
  /** How long the headless resume keeps trying `read`. */
  resumeReadMs?: number;
  /** Also save the portal's local/session storage with the cookies. */
  saveStorage?: boolean;
  dropStorageKeys?: string[];
}

async function finish(
  spec: VisiblePortalSpec,
  browser: Browser,
  page: Page,
  investments: ScrapedInvestmentAccount[]
): Promise<VisiblePortalResult> {
  return {
    success: true,
    accounts: [],
    investments,
    otpLongTermToken: await captureSession(
      browser,
      spec.saveStorage ? page : undefined,
      spec.dropStorageKeys
    ),
  };
}

/** Headless read with the saved session. Null when it no longer works. */
async function readWithSavedSession(
  spec: VisiblePortalSpec,
  savedSession: string | undefined
): Promise<VisiblePortalResult | null> {
  const saved = decodePensionSession(savedSession);
  if (!saved) return null;
  let browser: Browser | undefined;
  try {
    const launched = await launchPensionBrowser(false);
    browser = launched.browser;
    const page = launched.page;
    logJsonPaths(page, spec.tag);
    await restoreSession(browser, saved, page);
    await page.goto(spec.resumeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const deadline = Date.now() + (spec.resumeReadMs ?? 0);
    do {
      const investments = await spec.read(page);
      if (investments.length > 0) return await finish(spec, browser, page, investments);
      if (Date.now() >= deadline) break;
      await delay(2000);
    } while (true);
    return null;
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

export async function runVisiblePortal(
  spec: VisiblePortalSpec,
  opts: VisiblePortalOptions
): Promise<VisiblePortalResult> {
  const resumed = await readWithSavedSession(spec, opts.savedSession);
  if (resumed) return resumed;

  if (!opts.interactive) {
    return {
      success: false,
      accounts: [],
      needsOtp: true,
      errorMessage: `${spec.name} needs you to sign in again. Run Sync now and sign in in the window that opens.`,
    };
  }

  let browser: Browser | undefined;
  try {
    const launched = await launchPensionBrowser(true);
    browser = launched.browser;
    const page = launched.page;
    logJsonPaths(page, spec.tag);
    try {
      await page.goto(spec.loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } catch {
      // A bot wall can redirect mid-load; the window is still usable.
    }
    opts.onWindowOpen?.();
    void spec.prefill(page, opts.id.trim(), opts.phone).catch(() => {});

    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(5000);
      if (page.isClosed() || !browser.connected) {
        return {
          success: false,
          accounts: [],
          errorMessage: `The ${spec.name} window was closed before the sign-in finished.`,
        };
      }
      const investments = await spec.read(page);
      if (investments.length > 0) return await finish(spec, browser, page, investments);
    }
    return {
      success: false,
      accounts: [],
      errorMessage: `The ${spec.name} sign-in was not finished within 5 minutes. Run Sync now to try again.`,
    };
  } catch (err) {
    console.error(
      `[${spec.tag}] scrape failed:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      accounts: [],
      errorMessage: `Could not open ${spec.name}. Check your connection and try again.`,
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
