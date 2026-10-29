import "server-only";

import type { ScrapedInvestmentAccount } from "../types";
import {
  mapTradeAccountView,
  SECURITY_FIELDS,
  type AccountView,
} from "../investments/trade-view";

/**
 * Psagot Trade REST API, as used by trade.psagot.co.il. Not an official API;
 * the flow follows yshahak/PsagotFetcher:
 *
 *   1. POST json2/login with user + password and Method "2FA": Psagot texts
 *      a code.
 *   2. The same request with the code as Token returns a SessionKey.
 *   3. Data calls send that key in the `session` header, next to a
 *      client-chosen `csession` id.
 *
 * Sessions are short-lived, so the key is saved only to skip the SMS on a
 * sync that follows soon after another one.
 */

const BASE_URL = "https://trade1.psagot.co.il/V2";
const WEB_ORIGIN = "https://trade.psagot.co.il";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 30000;

export interface PsagotCredentials {
  username: string;
  password: string;
}

interface PsagotSavedSession {
  sessionKey: string;
  csession: string;
  savedAt: number;
}

interface LoginResponse {
  Login?: { SessionKey?: string };
  Exception?: { "-ExceptionType"?: string; Message?: string };
}

/** Psagot's answer for an unknown user or a wrong password. */
const INCORRECT_LOGIN = "Incorrect login";

interface PsagotAccount {
  "-key": string;
  "-nickName"?: string;
  "-name"?: string;
}

interface AccountsResponse {
  UserAccounts?: { UserAccount?: PsagotAccount[] | PsagotAccount };
}

/** Psagot no longer accepts the saved session; a new SMS login is needed. */
export class PsagotSessionExpiredError extends Error {
  constructor() {
    super("Psagot session expired");
  }
}

export class PsagotLoginError extends Error {}

export function decodePsagotSession(raw: string): PsagotSavedSession | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PsagotSavedSession>;
    if (typeof parsed.sessionKey === "string" && typeof parsed.csession === "string") {
      return {
        sessionKey: parsed.sessionKey,
        csession: parsed.csession,
        savedAt: Number(parsed.savedAt) || 0,
      };
    }
  } catch {
    // Not ours (or corrupted); treat as no session.
  }
  return null;
}

function asArray<T>(value: T[] | T | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export class PsagotClient {
  private csession: string;
  private sessionKey?: string;

  constructor(saved?: PsagotSavedSession | null) {
    // The web client sends a random number as its client session id.
    this.csession = saved?.csession ?? String(Math.random());
    this.sessionKey = saved?.sessionKey;
  }

  /** The session to store for the next sync, once logged in. */
  get savedSession(): string | undefined {
    if (!this.sessionKey) return undefined;
    const state: PsagotSavedSession = {
      sessionKey: this.sessionKey,
      csession: this.csession,
      savedAt: Date.now(),
    };
    return JSON.stringify(state);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: WEB_ORIGIN,
      Referer: `${WEB_ORIGIN}/`,
      "User-Agent": USER_AGENT,
      csession: this.csession,
    };
    if (this.sessionKey) headers.session = this.sessionKey;
    return headers;
  }

  private async postLogin(
    creds: PsagotCredentials,
    code?: string
  ): Promise<{ status: number; body: LoginResponse | null }> {
    const response = await fetch(`${BASE_URL}/json2/login?catalog=unified`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        Login: {
          "-Product": "Android",
          User: creds.username,
          Password: creds.password,
          Method: "2FA",
          ...(code ? { Token: code } : {}),
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let body: LoginResponse | null = null;
    try {
      body = (await response.json()) as LoginResponse;
    } catch {
      // Step 1 may answer with an empty body; only the status matters there.
    }
    return { status: response.status, body };
  }

  /**
   * Asks Psagot to text a code. Returns "logged-in" when the account has no
   * SMS step and Psagot hands out a session right away.
   */
  async requestCode(creds: PsagotCredentials): Promise<"code-sent" | "logged-in"> {
    const { status, body } = await this.postLogin(creds);
    const key = body?.Login?.SessionKey;
    if (key) {
      this.sessionKey = key;
      return "logged-in";
    }
    // Psagot answers this first step with a 401 whether or not it texted a
    // code, so only its "Incorrect login" message means bad credentials.
    const exception = body?.Exception;
    if (exception) {
      console.warn(
        `[psagot] login step 1: status ${status}, ${exception["-ExceptionType"] ?? "?"}: ${exception.Message ?? ""}`
      );
    }
    if (exception?.Message?.trim() === INCORRECT_LOGIN) {
      throw new PsagotLoginError("Psagot rejected the user name or password.");
    }
    if (status >= 500 || (status >= 400 && status !== 401 && status !== 403)) {
      throw new PsagotLoginError(`Psagot login failed (status ${status}).`);
    }
    return "code-sent";
  }

  async submitCode(creds: PsagotCredentials, code: string): Promise<void> {
    const { status, body } = await this.postLogin(creds, code.trim());
    const key = body?.Login?.SessionKey;
    if (status >= 400 || !key) {
      throw new PsagotLoginError(
        "Psagot did not accept the sign-in. Check the user name, password and SMS code, then try again."
      );
    }
    this.sessionKey = key;
  }

  private async getJson<T>(pathAndQuery: string): Promise<T> {
    const response = await fetch(`${BASE_URL}${pathAndQuery}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      throw new PsagotSessionExpiredError();
    }
    if (!response.ok) {
      throw new Error(`Psagot returned status ${response.status}`);
    }
    try {
      return (await response.json()) as T;
    } catch {
      // The body is not echoed: it can hold account data.
      throw new Error(`Psagot returned a non-JSON body (status ${response.status})`);
    }
  }

  async fetchPortfolios(): Promise<ScrapedInvestmentAccount[]> {
    if (!this.sessionKey) throw new PsagotSessionExpiredError();

    const accountsResponse = await this.getJson<AccountsResponse>(
      "/json/accounts?catalog=unified"
    );
    // A reply without the account list is treated as an expired session.
    if (!accountsResponse.UserAccounts) throw new PsagotSessionExpiredError();
    const accounts = asArray(accountsResponse.UserAccounts.UserAccount);

    const results: ScrapedInvestmentAccount[] = [];
    for (const account of accounts) {
      const key = account["-key"];
      if (!key) continue;
      const params = new URLSearchParams({
        account: key,
        currency: "ils",
        fields: SECURITY_FIELDS,
        catalog: "unified",
      });
      const view = await this.getJson<AccountView>(
        `/json2/account/view/balances?${params}`
      );
      const name = account["-nickName"] || account["-name"] || `Psagot ${key}`;
      const mapped = mapTradeAccountView(view, key, name);
      if (mapped) results.push(mapped);
    }
    return results;
  }
}
