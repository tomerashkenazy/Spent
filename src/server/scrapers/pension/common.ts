import "server-only";

import puppeteer, {
  type Browser,
  type CookieData,
  type Frame,
  type Page,
} from "puppeteer";
import type { InvestmentKind } from "@/lib/types";
import type { ScrapedInvestmentAccount } from "../types";
import { launchVisibleFirefox } from "../login-browser";

/**
 * Shared browser helpers for the pension, gemel and study-fund portals.
 *
 * The login and form-filling logic is adapted from israeli-pension-scrapers
 * (https://github.com/MotionPeak/israeli-pension-scrapers), Copyright (c) 2026
 * Shahar Solomons, MIT License. See THIRD_PARTY_NOTICES.md.
 *
 * Unlike that library, sessions are kept only as encrypted cookies in the
 * credential row (never a Chrome profile on disk), and no page HTML or
 * screenshots are written anywhere.
 */

/** Saved portal sessions older than this are not replayed. */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const SMS_CODE_FIELD =
  'input[name="otp"], input[name="otp1"], input[id="otp"], ' +
  'input[autocomplete="one-time-code"]';

export interface PensionSession {
  cookies: CookieData[];
  /** Web storage of the portal's origin, for portals that keep the token there. */
  storage?: SavedStorage;
  savedAt: number;
}

interface SavedStorage {
  origin: string;
  local: Record<string, string>;
  session: Record<string, string>;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function decodePensionSession(raw: string | undefined): PensionSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PensionSession>;
    const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
    const storage = parsed.storage?.origin ? parsed.storage : undefined;
    if (cookies.length === 0 && !storage) return null;
    const savedAt = Number(parsed.savedAt) || 0;
    if (Date.now() - savedAt > SESSION_MAX_AGE_MS) return null;
    return { cookies, storage, savedAt };
  } catch {
    return null;
  }
}

/**
 * Saves the browser's cookies. With `page`, also the local and session
 * storage of the page's current origin, minus `dropKeys` (cached data that
 * must be fetched fresh next time).
 */
export async function captureSession(
  browser: Browser,
  page?: Page,
  dropKeys: string[] = []
): Promise<string | undefined> {
  try {
    const cookies = await browser.defaultBrowserContext().cookies();
    const storage = page
      ? await page
          .evaluate((skip: string[]) => {
            const dump = (store: Storage) => {
              const out: Record<string, string> = {};
              for (let i = 0; i < store.length; i += 1) {
                const key = store.key(i);
                if (key !== null && !skip.includes(key)) out[key] = store.getItem(key) ?? "";
              }
              return out;
            };
            return {
              origin: location.origin,
              local: dump(localStorage),
              session: dump(sessionStorage),
            };
          }, dropKeys)
          .catch(() => undefined)
      : undefined;
    const hasStorage =
      storage &&
      (Object.keys(storage.local).length > 0 || Object.keys(storage.session).length > 0);
    if (cookies.length === 0 && !hasStorage) return undefined;
    const session: PensionSession = {
      cookies,
      storage: hasStorage ? storage : undefined,
      savedAt: Date.now(),
    };
    return JSON.stringify(session);
  } catch {
    return undefined;
  }
}

/**
 * Puts saved cookies back. Saved web storage is written before any script
 * of the portal runs, so its app finds the token on first load; that needs
 * `page`.
 */
export async function restoreSession(
  browser: Browser,
  session: PensionSession | null,
  page?: Page
): Promise<boolean> {
  if (!session) return false;
  try {
    if (session.cookies.length > 0) {
      await browser.defaultBrowserContext().setCookie(...session.cookies);
    }
    if (session.storage && page) {
      await page.evaluateOnNewDocument((saved: SavedStorage) => {
        if (location.origin !== saved.origin) return;
        if (sessionStorage.getItem("__spent_restored") === "1") return;
        for (const [k, v] of Object.entries(saved.local)) localStorage.setItem(k, v);
        for (const [k, v] of Object.entries(saved.session)) sessionStorage.setItem(k, v);
        sessionStorage.setItem("__spent_restored", "1");
      }, session.storage);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Headless runs use the bundled Chromium. Visible runs (captcha-walled
 * portals) open in Firefox when the user picked it, otherwise prefer the
 * installed Google Chrome, which captchas trust more, and fall back to the
 * bundled Chromium. Always a fresh, throwaway profile.
 */
export async function launchPensionBrowser(
  visible: boolean
): Promise<{ browser: Browser; page: Page }> {
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--lang=he-IL",
    ...(visible ? ["--window-size=1280,960"] : []),
  ];
  if (process.env.SPENT_DISABLE_CHROMIUM_SANDBOX === "1") {
    args.push("--no-sandbox");
  }
  const options = {
    headless: !visible,
    defaultViewport: visible ? null : { width: 1280, height: 900 },
    args,
  };

  const firefox = visible ? await launchVisibleFirefox() : null;
  if (firefox) {
    const page = (await firefox.pages())[0] ?? (await firefox.newPage());
    return { browser: firefox, page };
  }

  let browser: Browser;
  if (visible) {
    try {
      browser = await puppeteer.launch({ ...options, channel: "chrome" });
    } catch {
      browser = await puppeteer.launch(options);
    }
  } else {
    browser = await puppeteer.launch(options);
  }

  const page = (await browser.pages())[0] ?? (await browser.newPage());
  // Headless Chromium announces itself in the user agent; portals' bot walls
  // look for that.
  const userAgent = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");
  await page.setUserAgent({ userAgent });
  await page.setExtraHTTPHeaders({ "Accept-Language": "he-IL,he;q=0.9,en;q=0.8" });
  return { browser, page };
}

/**
 * Field names of a JSON value, a few levels deep, with arrays shown by their
 * first item. Never values, so debug logs can't leak balances or IDs.
 */
function jsonShape(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) {
    return value.length > 0 ? [jsonShape(value[0], depth)] : [];
  }
  if (value && typeof value === "object") {
    if (depth <= 0) return "{...}";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonShape(v, depth - 1);
    return out;
  }
  return typeof value;
}

/**
 * Logs the API calls a portal makes, to map it: method, path and status for
 * every XHR/fetch, plus the field names of JSON replies. Never values.
 */
export function logJsonPaths(page: Page, tag: string): void {
  if (process.env.SPENT_DEBUG_SCRAPERS !== "1") return;
  page.on("response", (res) => {
    const kind = res.request().resourceType();
    if (kind !== "xhr" && kind !== "fetch") return;
    let path: string;
    try {
      const url = new URL(res.url());
      path = `${url.host}${url.pathname}`;
    } catch {
      return;
    }
    if (/google|gstatic|nagich|analytics|\/api\/content\//.test(path)) return;
    const head = `[${tag}] ${res.request().method()} ${res.status()} ${path}`;
    const type = res.headers()["content-type"] ?? "";
    if (res.status() >= 400) {
      // Rejections carry the reason; digits are masked in case it echoes
      // an ID or phone number.
      void res
        .text()
        .then((body) =>
          console.log(`${head} ${body.replace(/\d/g, "#").replace(/\s+/g, " ").slice(0, 300)}`)
        )
        .catch(() => console.log(head));
      return;
    }
    if (!type.includes("json")) {
      console.log(head);
      return;
    }
    void res
      .json()
      .then((body: unknown) => {
        console.log(`${head} ${JSON.stringify(jsonShape(body, 3)).slice(0, 600)}`);
      })
      .catch(() => console.log(head));
  });
}

/**
 * Logs each frame's host and path and whether it shows any shekel figure,
 * to explain a failed balance read. Never the text itself.
 */
export function logFrames(page: Page, tag: string): void {
  if (process.env.SPENT_DEBUG_SCRAPERS !== "1") return;
  for (const frame of page.frames()) {
    let where = frame.url();
    try {
      const url = new URL(where);
      where = `${url.host}${url.pathname}`;
    } catch {
      // Keep the raw value, e.g. about:blank.
    }
    void frame
      .evaluate(() => /₪|ש["״]ח/.test(document.body?.innerText ?? ""))
      .then((money) => console.log(`[${tag}] frame ${where} shekels=${money}`))
      .catch(() => console.log(`[${tag}] frame ${where} unreadable`));
  }
}

/**
 * Logs error messages the page shows (form errors, toasts), to explain a
 * failed step. Only short texts from error-styled elements.
 */
export async function logPageErrors(page: Page, tag: string): Promise<void> {
  if (process.env.SPENT_DEBUG_SCRAPERS !== "1") return;
  const errors = await page
    .evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          'mat-error, [role=alert], [class*="error" i], [class*="snack" i], [class*="toast" i]'
        )
      )
        .filter((el) => el.offsetWidth || el.offsetHeight)
        .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
        .filter((t) => t && t.length < 120 && !/\d{6,}/.test(t))
    )
    .catch(() => [] as string[]);
  console.log(`[${tag}] page errors:`, errors.length ? [...new Set(errors)].join(" | ") : "none");
}

/**
 * Types into the visible match of `selector`, then also sets the value with
 * input/change events so framework-bound forms register it.
 */
export async function fillField(
  page: Page,
  selector: string,
  value: string
): Promise<boolean> {
  const handles = await page.$$(selector).catch(() => []);
  if (handles.length === 0) return false;
  let target = handles[0];
  for (const handle of handles) {
    const box = await handle.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      target = handle;
      break;
    }
  }
  try {
    await target.click({ count: 3 });
    await target.type(value, { delay: 45 });
  } catch {
    // Not cleanly interactable; the direct assignment below still works.
  }
  await target
    .evaluate((el, val) => {
      const input = el as HTMLInputElement;
      input.focus();
      input.value = val;
      for (const type of ["input", "change", "blur"]) {
        input.dispatchEvent(new Event(type, { bubbles: true }));
      }
    }, value)
    .catch(() => {});
  return true;
}

/**
 * Fills the text input whose label (a `<label>`, aria-label or placeholder)
 * reads `label`. For portals whose input ids change on every load.
 */
export async function fillByLabel(
  page: Page,
  label: string,
  value: string
): Promise<boolean> {
  const marker = `f${Math.random().toString(36).slice(2, 8)}`;
  const found = await page
    .evaluate(
      (wanted: string, mark: string) => {
        const norm = (s: string | null | undefined) =>
          (s || "").replace(/\s+/g, " ").trim();
        const textual = (el: Element | null): el is HTMLInputElement =>
          el instanceof HTMLInputElement &&
          ["text", "tel", "number", "password", "email", ""].includes(
            (el.getAttribute("type") || "text").toLowerCase()
          );
        let target: HTMLInputElement | null = null;
        for (const lab of Array.from(document.querySelectorAll("label"))) {
          if (norm(lab.innerText) !== wanted) continue;
          const byFor = lab.htmlFor ? document.getElementById(lab.htmlFor) : null;
          const candidate =
            (textual(byFor) && byFor) ||
            lab.querySelector("input") ||
            lab.closest("mat-form-field, .mat-mdc-form-field, .form-group, div")
              ?.querySelector("input") ||
            null;
          if (textual(candidate)) {
            target = candidate;
            break;
          }
        }
        if (!target) {
          target =
            Array.from(document.querySelectorAll("input")).find(
              (el) =>
                textual(el) &&
                (norm(el.getAttribute("aria-label")) === wanted ||
                  norm(el.placeholder) === wanted)
            ) ?? null;
        }
        if (!target) return false;
        target.setAttribute("data-spent-field", mark);
        return true;
      },
      label,
      marker
    )
    .catch(() => false);
  if (!found) return false;
  return fillField(page, `[data-spent-field="${marker}"]`, value);
}

/**
 * Waits for the SMS code step: `sent()` (the SMS API replied), `selector`,
 * or a new short, empty input (ID and phone fields are longer and filled).
 */
export async function waitForCodeStep(
  page: Page,
  selector: string,
  timeoutMs: number,
  sent: () => boolean = () => false
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (sent()) return true;
    const ready = await page
      .evaluate((sel: string) => {
        const visible = (el: HTMLElement) => Boolean(el.offsetWidth || el.offsetHeight);
        const hit = Array.from(document.querySelectorAll<HTMLElement>(sel)).some(visible);
        if (hit) return true;
        return Array.from(document.querySelectorAll("input")).some((el) => {
          const type = (el.getAttribute("type") || "text").toLowerCase();
          if (!["text", "tel", "number", "password", ""].includes(type)) return false;
          if (!visible(el) || el.disabled || el.readOnly || el.value) return false;
          const max = el.maxLength;
          return max >= 1 && max <= 8;
        });
      }, selector)
      .catch(() => false);
    if (ready) return true;
    await delay(1000);
  }
  return false;
}

export const SAVINGS_KEYWORDS = [
  "קרן השתלמות", "השתלמות", "קופת גמל", "גמל להשקעה", "גמל",
  "קרן פנסיה", "פנסיה", "תגמולים", "פיצויים", "ביטוח מנהלים", "קצבה", "חיסכון",
];

export interface SavingsTile {
  label: string;
  balance: number;
}

/**
 * Reads product tiles from a frame. A tile is a short block that names a
 * savings product and carries a shekel figure. Only numbers written next to
 * a ₪ or ש"ח sign count as money, so account numbers and dates in the same block
 * are never taken for the balance; the largest such amount is the balance.
 */
export async function readSavingsTiles(frame: Frame): Promise<SavingsTile[]> {
  try {
    return await frame.evaluate((keywords: string[]) => {
      const results: { label: string; balance: number }[] = [];
      const blocks = Array.from(
        document.querySelectorAll<HTMLElement>("div, section, li, article, tr")
      );
      // Shekels show as ₪ or as ש"ח (straight or Hebrew quote mark).
      const amount =
        /(?:₪|ש["״]ח)\s?(\d[\d,]*(?:\.\d+)?)|(?<![\d/.])(\d[\d,]*(?:\.\d+)?)\s?(?:₪|ש["״]ח)/g;
      const shekel = /₪|ש["״]ח/;
      const date = /\d{1,2}[./]\d{1,2}[./]\d{2,4}/g;
      for (const block of blocks) {
        // Dates go first: a year right before the ₪ sign is not an amount.
        const text = (block.innerText || "")
          .replace(/[\s\u00a0]+/g, " ")
          .replace(date, " ")
          .trim();
        if (!text || text.length > 200 || !shekel.test(text)) continue;
        if (!keywords.some((k) => text.includes(k))) continue;
        let largest = 0;
        for (const match of text.matchAll(amount)) {
          const value = parseFloat((match[1] ?? match[2] ?? "").replace(/,/g, ""));
          if (Number.isFinite(value) && value > largest) largest = value;
        }
        if (largest < 1000) continue;
        const label = text
          .replace(amount, " ")
          .replace(/נכון ל(?:יום|תאריך)?|מס(?:פר|') (?:חשבון|פוליסה|עמית)|יתרה|סה"כ|₪/g, " ")
          .replace(/\d+/g, " ")
          .replace(/[\s:/\-,.]+$/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 50);
        results.push({ label: label || "חיסכון", balance: largest });
      }
      return results;
    }, SAVINGS_KEYWORDS);
  } catch {
    return [];
  }
}

/** Turns tiles into accounts. A parent block repeats its child's balance; keep the tightest label. */
export function tilesToAccounts(
  tiles: SavingsTile[],
  prefix: string
): ScrapedInvestmentAccount[] {
  const byBalance = new Map<number, string>();
  for (const tile of tiles) {
    const previous = byBalance.get(tile.balance);
    if (previous === undefined || tile.label.length < previous.length) {
      byBalance.set(tile.balance, tile.label);
    }
  }
  return [...byBalance].map(([balance, label]) => ({
    externalId: `${prefix}:${label}`,
    kind: pensionKindFromTitle(label),
    name: label,
    currency: "ILS",
    totalValue: roundMoney(balance),
    holdings: [],
  }));
}

/** Polls every frame of the page for savings tiles until some show up. */
export async function pollSavingsTiles(
  page: Page,
  prefix: string,
  timeoutMs: number,
  dismissLabels: string[] = []
): Promise<ScrapedInvestmentAccount[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dismissLabels.length > 0) await clickByText(page, dismissLabels);
    for (const frame of page.frames()) {
      const tiles = await readSavingsTiles(frame);
      if (tiles.length > 0) return tilesToAccounts(tiles, prefix);
    }
    await delay(1500);
  }
  return [];
}

/** Clicks the first enabled control whose text matches one of `labels`. */
export async function clickByText(page: Page, labels: string[]): Promise<boolean> {
  try {
    return await page.evaluate((wanted: string[]) => {
      type Node = HTMLElement & { value?: string; disabled?: boolean };
      const norm = (s: string | undefined) => (s || "").replace(/\s+/g, " ").trim();
      const off = (n: Node) =>
        Boolean(n.disabled) || n.getAttribute("aria-disabled") === "true";
      for (const label of wanted) {
        const controls = Array.from(
          document.querySelectorAll<Node>(
            "button, input[type=submit], input[type=button], a, [role=button]"
          )
        );
        let hit = controls.find((n) => {
          const t = norm(n.innerText || n.value || n.getAttribute("aria-label") || "");
          return !off(n) && (t === label || t.includes(label));
        });
        if (!hit) {
          // Buttons built from plain divs/spans: take the innermost exact match.
          const plain = Array.from(
            document.querySelectorAll<Node>("span, div, a, p, li")
          ).filter((n) => norm(n.innerText) === label && !off(n));
          plain.sort(
            (a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length
          );
          hit = plain[0];
        }
        if (hit) {
          (hit.closest<HTMLElement>("button, a, [role=button]") || hit).click();
          return true;
        }
      }
      return false;
    }, labels);
  } catch {
    return false;
  }
}

/** Normalizes to the local 05XXXXXXXX form the portals expect. */
export function localPhone(raw: string): string {
  let phone = (raw ?? "").replace(/\D/g, "");
  if (phone.startsWith("972")) phone = `0${phone.slice(3)}`;
  if (phone.length === 9 && phone.startsWith("5")) phone = `0${phone}`;
  return phone;
}

/**
 * Types an SMS code into a single code field or a row of one-digit boxes,
 * then submits it. The submit is scoped to the code's dialog so a button on
 * the login form behind it is not clicked, and "send again" is never clicked.
 */
export async function enterSmsCode(page: Page, code: string): Promise<void> {
  const digits = code.replace(/\D/g, "");
  const boxes = await page.evaluate(() => {
    type Input = HTMLInputElement;
    const inputs = Array.from(document.querySelectorAll("input"));
    const visible = (el: Input) => Boolean(el.offsetWidth || el.offsetHeight);
    const isSearch = (el: Input) =>
      (el.getAttribute("type") || "").toLowerCase() === "search" ||
      el.getAttribute("role") === "searchbox" ||
      /search|חיפוש/i.test(`${el.id} ${el.getAttribute("name") || ""}`);
    let picked = inputs.filter((el) => {
      const key =
        el.getAttribute("name") || el.getAttribute("formcontrolname") || el.id || "";
      const oneTimeCode =
        (el.getAttribute("autocomplete") || "").toLowerCase() === "one-time-code";
      return (/^otp\d*$/i.test(key) || oneTimeCode) && visible(el) && !el.disabled;
    });
    if (picked.length === 0) {
      picked = inputs.filter((el) => {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        return (
          ["text", "tel", "number", "password", ""].includes(type) &&
          visible(el) &&
          !el.disabled &&
          !el.readOnly &&
          !el.value &&
          !isSearch(el)
        );
      });
    }
    picked.forEach((el, i) => el.setAttribute("data-spent-code", String(i)));
    return picked.length;
  });

  if (boxes >= 2) {
    for (let i = 0; i < boxes && i < digits.length; i += 1) {
      await page.click(`[data-spent-code="${i}"]`).catch(() => {});
      await page.type(`[data-spent-code="${i}"]`, digits[i] ?? "", { delay: 80 });
    }
  } else if (boxes === 1) {
    await page.click('[data-spent-code="0"]', { count: 3 }).catch(() => {});
    await page.type('[data-spent-code="0"]', digits, { delay: 60 });
  }

  await delay(600);
  const submitted = await page.evaluate(() => {
    type Node = HTMLElement & { value?: string; disabled?: boolean };
    const norm = (s: string | undefined) => (s || "").replace(/\s+/g, " ").trim();
    const labels = ["המשך", "אישור", "כניסה", "התחברות", "שלח", "Continue", "Submit", "Verify"];
    const isResend = (t: string) => /שוב|חוזר|resend|send.?again|שלחו לי/i.test(t);
    const field = document.querySelector("[data-spent-code]");
    const scopes: ParentNode[] = [];
    const dialog = field?.closest(
      '[role=dialog], dialog, [class*="modal" i], [class*="dialog" i], form'
    );
    if (dialog) scopes.push(dialog);
    scopes.push(document);
    for (const scope of scopes) {
      const controls = Array.from(
        scope.querySelectorAll<Node>("button, input[type=submit], [role=button]")
      ).filter((b) => !b.disabled && !isResend(norm(b.innerText || b.value)));
      let hit =
        controls.find((b) => labels.includes(norm(b.innerText || b.value))) ??
        controls.find((b) => labels.some((l) => norm(b.innerText || b.value).includes(l)));
      if (!hit) {
        const plain = Array.from(scope.querySelectorAll<Node>("span, div, a")).filter(
          (n) => labels.includes(norm(n.innerText))
        );
        plain.sort(
          (a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length
        );
        hit = plain[0];
      }
      if (hit) {
        (hit.closest<HTMLElement>("button, a, [role=button]") || hit).click();
        return true;
      }
    }
    return false;
  });
  if (!submitted) await page.keyboard.press("Enter");
}

/** Maps a product title from a portal to a savings kind. */
export function pensionKindFromTitle(title: string): InvestmentKind {
  if (/השתלמות/.test(title)) return "hishtalmut";
  if (/גמל להשקעה/.test(title)) return "gemel_lehashkaa";
  if (/גמל|תגמולים|פיצויים/.test(title)) return "gemel";
  return "pension";
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
