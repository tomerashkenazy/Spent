import "server-only";

import {
  decodePsagotSession,
  PsagotClient,
  PsagotLoginError,
  PsagotSessionExpiredError,
  type PsagotCredentials,
} from "./psagot/psagot-client";
import type { ScrapeResult } from "./types";

/**
 * Psagot is an investment-only provider: it returns portfolios and no
 * transactions. Every sign-in needs an SMS code, so the session is saved in
 * the credential's token slot and reused while Psagot still accepts it.
 */

export interface PsagotSyncResult extends ScrapeResult {
  otpLongTermToken?: string;
  /** The saved session is gone; a new SMS login is required. */
  needsOtp?: boolean;
}

export interface PsagotLoginOptions extends PsagotCredentials {
  /** Awaits the user-supplied SMS code. Rejects on cancel/timeout. */
  awaitOtp: () => Promise<string>;
  onOtpSubmitted?: () => void;
}

async function fetchAfterLogin(client: PsagotClient): Promise<PsagotSyncResult> {
  try {
    const investments = await client.fetchPortfolios();
    return {
      success: true,
      accounts: [],
      investments,
      otpLongTermToken: client.savedSession,
    };
  } catch (err) {
    if (err instanceof PsagotSessionExpiredError) {
      return {
        success: false,
        accounts: [],
        needsOtp: true,
        errorMessage: "Psagot needs a new SMS code. Run Sync now and enter the code you receive.",
      };
    }
    console.error("[psagot] fetch failed:", err instanceof Error ? err.message : err);
    return {
      success: false,
      accounts: [],
      errorMessage: "Logged in to Psagot but reading the portfolio failed.",
    };
  }
}

export async function scrapePsagotWithSession(
  savedSession: string
): Promise<PsagotSyncResult> {
  const session = decodePsagotSession(savedSession);
  if (!session) {
    return {
      success: false,
      accounts: [],
      needsOtp: true,
      errorMessage: "Psagot needs a new SMS code. Run Sync now and enter the code you receive.",
    };
  }
  return fetchAfterLogin(new PsagotClient(session));
}

export async function scrapePsagotWithOtp(
  opts: PsagotLoginOptions
): Promise<PsagotSyncResult> {
  const client = new PsagotClient();
  const creds = { username: opts.username, password: opts.password };

  let cancelled: string | null = null;
  try {
    const step = await client.requestCode(creds);
    if (step === "code-sent") {
      let code: string;
      try {
        code = await opts.awaitOtp();
      } catch (err) {
        cancelled = err instanceof Error ? err.message : "SMS code entry was cancelled.";
        throw err;
      }
      opts.onOtpSubmitted?.();
      await client.submitCode(creds, code);
    }
  } catch (err) {
    if (cancelled) return { success: false, accounts: [], errorMessage: cancelled };
    if (err instanceof PsagotLoginError) {
      return { success: false, accounts: [], errorMessage: err.message };
    }
    console.error("[psagot] login failed:", err instanceof Error ? err.message : err);
    return {
      success: false,
      accounts: [],
      errorMessage: "Could not reach Psagot. Check your connection and try again.",
    };
  }
  return fetchAfterLogin(client);
}
