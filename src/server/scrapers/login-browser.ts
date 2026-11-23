import "server-only";

import puppeteer, { type Browser, type Page } from "puppeteer";
import { getGlobalSetting } from "../db/queries/settings";
import { findFirefox } from "../lib/firefox";
import type { LoginBrowser } from "@/lib/types";

/**
 * Visible scraper windows (manual 2FA, captcha-walled portals, "Show browser
 * during sync") can open in the user's installed Firefox instead of Chromium.
 * Headless runs always stay on the bundled Chromium, which the scrapers are
 * built and tested against.
 *
 * Firefox is driven over WebDriver BiDi with a fresh throwaway profile, so the
 * user's own Firefox profile, saved passwords and history are never touched.
 */

export function getLoginBrowser(): LoginBrowser {
  return getGlobalSetting("login_browser") === "firefox" ? "firefox" : "chrome";
}

/**
 * Launches a visible Firefox window when the user picked Firefox and it is
 * installed. Returns null otherwise so callers fall back to Chromium.
 */
export async function launchVisibleFirefox(): Promise<Browser | null> {
  if (getLoginBrowser() !== "firefox") return null;
  const executablePath = findFirefox();
  if (!executablePath) {
    console.warn("[scraper] Firefox was selected but not found, using Chrome");
    return null;
  }
  try {
    const browser = await puppeteer.launch({
      browser: "firefox",
      executablePath,
      headless: false,
      defaultViewport: null,
      args: ["--width=1280", "--height=960"],
      extraPrefsFirefox: { "intl.accept_languages": "he-IL, he, en-US, en" },
    });
    // Firefox under automation reports navigator.webdriver = true, which bank
    // bot walls look for (Chromium hides it with a launch flag instead). Patch
    // every page opened here, including the ones the scraper library opens.
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (...args: Parameters<Browser["newPage"]>) => {
      const page = await newPage(...args);
      await hideWebdriverFlag(page);
      return page;
    };
    for (const page of await browser.pages()) {
      await hideWebdriverFlag(page);
    }
    return browser;
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "unknown";
    console.warn(`[scraper] could not start Firefox (${message}), using Chrome`);
    return null;
  }
}

async function hideWebdriverFlag(page: Page): Promise<void> {
  await page
    .evaluateOnNewDocument(() => {
      Object.defineProperty(Navigator.prototype, "webdriver", {
        get: () => false,
        configurable: true,
      });
    })
    .catch(() => {});
}
