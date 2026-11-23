import "server-only";

import type { Browser, Page } from "puppeteer";
import {
  captureSession,
  decodePensionSession,
  delay,
  enterSmsCode,
  launchPensionBrowser,
  logFrames,
  logJsonPaths,
  logPageErrors,
  restoreSession,
  SMS_CODE_FIELD,
  waitForCodeStep,
} from "./common";
import type { ScrapedInvestmentAccount, ScrapeResult } from "../types";

/**
 * The sign-in most savings portals share: ID and phone, then an SMS code,
 * all headless. The code is collected through the sync dialog, and the
 * session is saved so a later sync can skip it.
 */

export interface SmsPortalResult extends ScrapeResult {
  otpLongTermToken?: string;
  needsOtp?: boolean;
}

export interface SmsPortalOptions {
  id: string;
  phone: string;
  savedSession?: string;
  /** Omitted for scheduled syncs and tests, which cannot ask for a code. */
  awaitOtp?: () => Promise<string>;
  onOtpSubmitted?: () => void;
}

export interface SmsPortalSpec {
  /** Log prefix and externalId prefix. */
  tag: string;
  /** Shown in error messages. */
  name: string;
  /** The page that shows balances once signed in. */
  productsUrl: string;
  /** True when the portal bounced us to its sign-in page. */
  isLoginUrl: (url: string) => boolean;
  /** Opens the sign-in form, fills ID and phone, and asks for a code. */
  submitLogin: (page: Page, id: string, phone: string) => Promise<boolean>;
  readBalances: (page: Page, timeoutMs: number) => Promise<ScrapedInvestmentAccount[]>;
  /**
   * Go to `productsUrl` after the code. Off for single-page apps, which route
   * there on their own and may lose state on a reload.
   */
  navigateAfterCode: boolean;
  /** Also save the portal's local/session storage with the cookies. */
  saveStorage?: boolean;
  /** Storage keys holding cached data, left out of the saved session. */
  dropStorageKeys?: string[];
  /**
   * The API call that sends the SMS. A successful reply means the code step
   * is up, even when its field is a custom widget the DOM check misses.
   */
  codeSentPath?: RegExp;
}

export async function runSmsPortal(
  spec: SmsPortalSpec,
  opts: SmsPortalOptions
): Promise<SmsPortalResult> {
  const fail = (errorMessage: string, extra: Partial<SmsPortalResult> = {}) =>
    ({ success: false, accounts: [], errorMessage, ...extra }) as SmsPortalResult;

  let browser: Browser | undefined;
  try {
    const launched = await launchPensionBrowser(false);
    browser = launched.browser;
    const page = launched.page;
    logJsonPaths(page, spec.tag);

    const finish = async (investments: ScrapedInvestmentAccount[]) => ({
      success: true,
      accounts: [],
      investments,
      otpLongTermToken: await captureSession(
        launched.browser,
        spec.saveStorage ? page : undefined,
        spec.dropStorageKeys
      ),
    });

    // A saved session opens the products page without a sign-in.
    const saved = decodePensionSession(opts.savedSession);
    if (await restoreSession(browser, saved, page)) {
      try {
        await page.goto(spec.productsUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        await delay(3000);
        if (!spec.isLoginUrl(page.url())) {
          const investments = await spec.readBalances(page, 45_000);
          if (investments.length > 0) return await finish(investments);
        }
      } catch {
        // Fall through to a fresh sign-in.
      }
    }

    if (!opts.awaitOtp) {
      return fail(
        `${spec.name} needs a new SMS code. Run Sync now and enter the code you receive.`,
        { needsOtp: true }
      );
    }

    let codeSent = false;
    if (spec.codeSentPath) {
      const sentPath = spec.codeSentPath;
      page.on("response", (res) => {
        if (res.request().method() !== "POST" || !res.ok()) return;
        try {
          if (sentPath.test(new URL(res.url()).pathname)) codeSent = true;
        } catch {
          // Not a URL we can parse.
        }
      });
    }

    if (!(await spec.submitLogin(page, opts.id.trim(), opts.phone))) {
      return fail(`Could not find ${spec.name}'s sign-in form. The site may have changed.`);
    }

    const codeStep = await waitForCodeStep(page, SMS_CODE_FIELD, 90_000, () => codeSent);
    if (!codeStep) {
      await logPageErrors(page, spec.tag);
      return fail(
        `${spec.name} did not ask for an SMS code. Check the ID number and phone number, then try again.`
      );
    }

    let code: string;
    try {
      code = await opts.awaitOtp();
    } catch (err) {
      return fail(err instanceof Error ? err.message : "SMS code entry was cancelled.");
    }
    opts.onOtpSubmitted?.();
    // The code field can render a moment after the API replies.
    await delay(1500);
    await enterSmsCode(page, code.trim());

    if (spec.navigateAfterCode) {
      await delay(7000);
    } else {
      // Single-page apps route away from the sign-in page once it works.
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && spec.isLoginUrl(page.url())) await delay(1000);
      await delay(3000);
    }

    if (spec.navigateAfterCode || spec.isLoginUrl(page.url())) {
      try {
        await page.goto(spec.productsUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
      } catch {
        // Read whatever page loaded.
      }
    }
    // Still on the sign-in page after the code means the portal rejected it.
    if (spec.isLoginUrl(page.url())) {
      await logPageErrors(page, spec.tag);
      return fail(`${spec.name} did not accept the SMS code. Run Sync now and try again.`);
    }
    const investments = await spec.readBalances(page, 75_000);
    if (investments.length === 0) {
      logFrames(page, spec.tag);
      return fail(
        `Signed in to ${spec.name} but could not read the balances. The code may have been wrong, or the site changed.`
      );
    }
    return await finish(investments);
  } catch (err) {
    console.error(
      `[${spec.tag}] scrape failed:`,
      err instanceof Error ? err.message : err
    );
    return fail(`Could not reach ${spec.name}. Check your connection and try again.`);
  } finally {
    await browser?.close().catch(() => {});
  }
}

