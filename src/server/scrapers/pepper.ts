import "server-only";

import { PepperClient, type PepperCredentials } from "./pepper/pepper-client";
import type { ScrapeResult } from "./types";

/**
 * Pepper is not in israeli-bank-scrapers yet, so it runs through our own
 * API-direct client. The flow mirrors One Zero:
 *
 *   - First sync: password, then an SMS code supplied via the OTP bridge.
 *     The client returns a persistent token (device key + JWT).
 *   - Later syncs: the token plus the password log in without SMS. The JWT
 *     inside the token is refreshed, so the caller must store the returned
 *     token after every sync.
 */

export interface PepperFirstSyncOptions extends PepperCredentials {
  startDate: Date;
  /** Awaits the user-supplied OTP. Rejects on cancel/timeout. */
  awaitOtp: () => Promise<string>;
  onOtpSubmitted?: () => void;
}

export interface PepperSubsequentSyncOptions extends PepperCredentials {
  otpLongTermToken: string;
  startDate: Date;
}

export interface PepperSyncResult extends ScrapeResult {
  otpLongTermToken?: string;
  /** The saved device was rejected; a fresh OTP login is required. */
  needsOtp?: boolean;
}

async function fetchAfterLogin(
  client: PepperClient,
  startDate: Date,
  otpLongTermToken: string | undefined
): Promise<PepperSyncResult> {
  try {
    const accounts = await client.fetchAccounts(startDate);
    return { success: true, accounts, otpLongTermToken };
  } catch (err) {
    console.error("[pepper] fetch failed:", err instanceof Error ? err.message : err);
    return {
      success: false,
      accounts: [],
      errorMessage: "Logged in to Pepper but fetching transactions failed.",
      otpLongTermToken,
    };
  }
}

function loginError(err: unknown): PepperSyncResult {
  console.error("[pepper] login failed:", err instanceof Error ? err.message : err);
  return {
    success: false,
    accounts: [],
    errorMessage: "Could not reach Pepper. Check your connection and try again.",
  };
}

export async function scrapePepperFirstTime(
  opts: PepperFirstSyncOptions
): Promise<PepperSyncResult> {
  const client = new PepperClient();

  let otpCancelled: string | null = null;
  let login;
  try {
    login = await client.loginWithOtp(opts, async () => {
      try {
        const code = await opts.awaitOtp();
        opts.onOtpSubmitted?.();
        return code;
      } catch (err) {
        otpCancelled = err instanceof Error ? err.message : "OTP entry was cancelled.";
        throw err;
      }
    });
  } catch (err) {
    if (otpCancelled) {
      return { success: false, accounts: [], errorMessage: otpCancelled };
    }
    return loginError(err);
  }

  if (!login.success) {
    return {
      success: false,
      accounts: [],
      errorMessage: login.errorMessage ?? "Pepper login failed.",
    };
  }
  return fetchAfterLogin(client, opts.startDate, login.otpLongTermToken);
}

export async function scrapePepperWithToken(
  opts: PepperSubsequentSyncOptions
): Promise<PepperSyncResult> {
  const client = new PepperClient();

  let login;
  try {
    login = await client.loginWithToken(opts, opts.otpLongTermToken);
  } catch (err) {
    return loginError(err);
  }

  if (!login.success) {
    return {
      success: false,
      accounts: [],
      errorMessage: login.errorMessage ?? "Pepper login failed.",
      needsOtp: login.needsOtp,
    };
  }
  return fetchAfterLogin(client, opts.startDate, login.otpLongTermToken);
}
