import "server-only";

import HapoalimScraper from "israeli-bank-scrapers/lib/scrapers/hapoalim";
import { LoginResults } from "israeli-bank-scrapers/lib/scrapers/base-scraper-with-browser";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors";
import type {
  ScraperLoginResult,
  ScraperOptions,
} from "israeli-bank-scrapers/lib/scrapers/interface";
import type { CookieData } from "puppeteer";
import { fetchHapoalimSecurities } from "./investments/hapoalim-securities";
import type { ScrapedInvestmentAccount } from "./types";

/**
 * Bank Hapoalim shows an SMS one-time-code overlay (form.auth-otp-login) on an
 * unrecognized device, on the login URL and without a redirect. The stock
 * scraper only waits 20s for a redirect and fails. This subclass, ported from
 * eshaham/israeli-bank-scrapers PR #1200 (not merged upstream):
 *
 *   - detects the overlay after the credentials are submitted
 *   - asks the caller for the code and types it into the overlay
 *   - captures cookies + localStorage after a successful scrape ("device
 *     trust") and restores them next time so the bank skips the SMS.
 */

const OTP_FORM_SELECTOR = "form.auth-otp-login";
const OTP_SUBMIT_SELECTOR = ".btn-red_1";
const OTP_ERROR_SELECTOR = ".errors-rb .error-message, .auth-otp-login .error";

// After the overlay closes the homepage URL can carry extra query params, so
// only fragments are matched (the library's own Success list is exact URLs).
const OTP_HOME_URL_FRAGMENTS = [
  "/portalserver/HomePage",
  "/ng-portals-bt/rb/he/homepage",
  "/ng-portals/rb/he/homepage",
];

const MAX_OTP_ATTEMPTS = 3;
const OTP_RESULT_TIMEOUT_MS = 20000;
const OTP_HOME_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 1000;
const LOGIN_SETTLE_TIMEOUT_MS = 30000;
const LOCAL_STORAGE_GOTO_TIMEOUT_MS = 15000;

export interface HapoalimDeviceTrust {
  cookies: CookieData[];
  localStorage: Record<string, string>;
}

export interface HapoalimOtpHooks {
  /** Saved trust from a previous successful scrape, as a JSON string. */
  deviceTrust?: string;
  /**
   * Asks the user for the SMS code. Omit when nobody can answer (connection
   * test, scheduled sync): the login then fails fast with a clear message.
   */
  awaitOtp?: (attempt: number) => Promise<string>;
  /** Also read the securities portfolio after the transactions. */
  fetchSecurities?: boolean;
}

export const HAPOALIM_OTP_REQUIRED_MESSAGE =
  "Bank Hapoalim sent an SMS code to verify this device. Run Sync now from the dashboard and enter the code there.";

type HapoalimCredentials = { userCode: string; password: string };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollUntil<T>(
  fn: () => Promise<T | false>,
  timeoutMs: number
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== false) return value;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

export function parseDeviceTrust(
  raw: string | undefined
): HapoalimDeviceTrust | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HapoalimDeviceTrust> | null;
    if (!parsed || !Array.isArray(parsed.cookies)) return null;
    return {
      cookies: parsed.cookies,
      localStorage:
        parsed.localStorage && typeof parsed.localStorage === "object"
          ? parsed.localStorage
          : {},
    };
  } catch {
    return null;
  }
}

// The browser rejects an expires value that is not a future timestamp, so a
// session cookie (expires: -1) is restored by omitting the field.
function toCookieParam(cookie: CookieData): CookieData {
  const param: CookieData = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  };
  if (typeof cookie.expires === "number" && cookie.expires > Date.now() / 1000) {
    param.expires = cookie.expires;
  }
  return param;
}

export class HapoalimOtpScraper extends HapoalimScraper {
  /** Set after a successful scrape; store it for the next run. */
  capturedDeviceTrust?: string;
  /** True when the bank asked for a code and no `awaitOtp` was supplied. */
  otpRequiredButUnavailable = false;
  capturedInvestments?: ScrapedInvestmentAccount[];

  private hooks: HapoalimOtpHooks;

  constructor(options: ScraperOptions, hooks: HapoalimOtpHooks) {
    super(options);
    this.hooks = hooks;
  }

  getLoginOptions(credentials: HapoalimCredentials) {
    const base = super.getLoginOptions(credentials);
    return {
      ...base,
      // Wait for either a redirect or the SMS overlay. The poll must never
      // throw: a throw mid-navigation means the page is moving, keep polling.
      postAction: async () => {
        const initialUrl = this.page.url();
        await pollUntil(async () => {
          try {
            if (this.page.url() !== initialUrl) return true;
            return (await this.isOtpFormPresent()) || false;
          } catch {
            return false;
          }
        }, LOGIN_SETTLE_TIMEOUT_MS);
      },
      possibleResults: {
        ...base.possibleResults,
        [LoginResults.TwoFactorRetrieverMissing]: [
          async () => this.isOtpFormPresent(),
        ],
      },
    };
  }

  async initialize() {
    await super.initialize();
    // Best effort: losing the trust only means another SMS code.
    const trust = parseDeviceTrust(this.hooks.deviceTrust);
    if (trust) {
      try {
        await this.injectDeviceTrust(trust);
      } catch (e) {
        console.warn("[hapoalim] could not restore device trust:", (e as Error).message);
      }
    }
  }

  async login(credentials: HapoalimCredentials): Promise<ScraperLoginResult> {
    let result: ScraperLoginResult;
    try {
      result = await super.login(credentials);
    } catch (e) {
      // The base class throws on login results it does not know, including
      // TwoFactorRetrieverMissing. The DOM decides whether it was the overlay.
      if (!(await this.isOtpFormPresent())) throw e;
      result = { success: false, errorType: ScraperErrorTypes.TwoFactorRetrieverMissing };
    }

    if (result.success || result.errorType !== ScraperErrorTypes.TwoFactorRetrieverMissing) {
      return result;
    }

    if (!this.hooks.awaitOtp) {
      this.otpRequiredButUnavailable = true;
      return {
        success: false,
        errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
        errorMessage: HAPOALIM_OTP_REQUIRED_MESSAGE,
      };
    }
    return this.otpLogin(this.hooks.awaitOtp);
  }

  private async otpLogin(
    awaitOtp: (attempt: number) => Promise<string>
  ): Promise<ScraperLoginResult> {
    for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt += 1) {
      const digits = (await awaitOtp(attempt)).replace(/\D/g, "");
      if (!digits) {
        return {
          success: false,
          errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
          errorMessage: "No SMS code was entered for Bank Hapoalim.",
        };
      }

      await this.fillOtpCode(digits);
      // The bank's Angular form ignores a synthetic el.click(); page.click()
      // sends trusted mouse events.
      await this.page.click(OTP_SUBMIT_SELECTOR);

      const outcome = await this.waitForOtpOutcome();
      if (outcome === "gone") {
        if (await this.waitForHomePage()) return { success: true };
        return {
          success: false,
          errorType: ScraperErrorTypes.General,
          errorMessage:
            "Bank Hapoalim accepted the SMS code but the homepage did not load.",
        };
      }
    }

    return {
      success: false,
      errorType: ScraperErrorTypes.General,
      errorMessage: `Bank Hapoalim rejected the SMS code ${MAX_OTP_ATTEMPTS} times.`,
    };
  }

  private async fillOtpCode(code: string) {
    const inputs = await this.page.$$(`${OTP_FORM_SELECTOR} input[type="text"]`);
    // The overlay is either one input or one input per digit.
    if (inputs.length === 1) {
      await inputs[0].click({ count: 3 });
      await inputs[0].type(code);
      return;
    }
    for (let i = 0; i < inputs.length; i += 1) {
      const input = inputs[i];
      await input.click();
      await input.evaluate((el) => {
        (el as HTMLInputElement).value = "";
      });
      if (i < code.length) await input.type(code[i]);
      await sleep(100);
    }
  }

  // 'gone' when the overlay closed (code accepted), 'error' on an inline
  // rejection or timeout, in which case a fresh code is requested.
  private async waitForOtpOutcome(): Promise<"gone" | "error"> {
    const outcome = await pollUntil<"gone" | "error">(async () => {
      let form;
      try {
        form = await this.page.$(OTP_FORM_SELECTOR);
      } catch {
        // Execution context destroyed: navigating away from the overlay.
        return "gone";
      }
      if (!form) return "gone";
      try {
        return (await this.page.$(OTP_ERROR_SELECTOR)) ? "error" : false;
      } catch {
        return false;
      }
    }, OTP_RESULT_TIMEOUT_MS);
    return outcome ?? "error";
  }

  private async waitForHomePage(): Promise<boolean> {
    const reached = await pollUntil(
      async () =>
        OTP_HOME_URL_FRAGMENTS.some((f) => this.page.url().includes(f)) || false,
      OTP_HOME_TIMEOUT_MS
    );
    return reached === true;
  }

  private async isOtpFormPresent(): Promise<boolean> {
    try {
      return Boolean(await this.page.$(OTP_FORM_SELECTOR));
    } catch {
      return false;
    }
  }

  async fetchData() {
    const result = await super.fetchData();
    if (result.success && this.hooks.fetchSecurities) {
      try {
        this.capturedInvestments = await fetchHapoalimSecurities(
          this.page,
          this.baseUrl,
          result.accounts.map((a) => a.accountNumber)
        );
      } catch {
        // Never fail the transaction sync over the portfolio; the message
        // could echo account data, so it is not logged.
        console.warn("[hapoalim] securities fetch failed");
      }
    }
    return result;
  }

  async terminate(success: boolean) {
    // Must run before the base cleanups close the page, and must never throw:
    // a throw here turns a successful scrape into a failure.
    if (success) {
      try {
        this.capturedDeviceTrust = JSON.stringify(await this.extractDeviceTrust());
      } catch (e) {
        console.warn("[hapoalim] could not capture device trust:", (e as Error).message);
      }
    }
    await super.terminate(success);
  }

  private async injectDeviceTrust(trust: HapoalimDeviceTrust) {
    for (const cookie of trust.cookies) {
      try {
        await this.page.browserContext().setCookie(toCookieParam(cookie));
      } catch {
        // One bad cookie should not block the rest.
      }
    }

    const entries = Object.entries(trust.localStorage);
    if (!entries.length) return;
    // localStorage is origin-scoped and was captured on the post-login
    // homepage, which always lives on the scraper's base URL.
    await this.page.goto(this.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: LOCAL_STORAGE_GOTO_TIMEOUT_MS,
    });
    await this.page.evaluate((items: Record<string, string>) => {
      for (const [key, value] of Object.entries(items)) {
        window.localStorage.setItem(key, value);
      }
    }, trust.localStorage);
  }

  private async extractDeviceTrust(): Promise<HapoalimDeviceTrust> {
    // The device registration lives in cookies scoped to the whole login
    // domain, so read the context's full cookie store, not page.cookies().
    const rawCookies = await this.page.browserContext().cookies();
    const cookies: CookieData[] = rawCookies.map(
      ({ name, value, domain, path, expires, httpOnly, secure, sameSite }) => ({
        name,
        value,
        domain,
        path,
        expires,
        httpOnly,
        secure,
        sameSite,
      })
    );
    const localStorage = await this.page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key !== null) items[key] = window.localStorage.getItem(key) ?? "";
      }
      return items;
    });
    return { cookies, localStorage };
  }
}
