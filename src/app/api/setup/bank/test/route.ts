import { NextResponse } from "next/server";
import {
  getBankCredentials,
  getRequiresManualTwoFactor,
} from "@/server/db/queries/bank-credentials";
import { scrapeBank } from "@/server/scrapers";
import { scrapePepperWithToken } from "@/server/scrapers/pepper";
import { scrapePsagotWithSession } from "@/server/scrapers/psagot";
import { scrapeAnalyst } from "@/server/scrapers/analyst";
import { scrapeHarel } from "@/server/scrapers/harel";
import { scrapeMenora } from "@/server/scrapers/menora";
import { scrapeMore } from "@/server/scrapers/more";
import { BANK_PROVIDERS, type BankProvider } from "@/lib/types";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json()) as {
    provider: string;
    credentialId?: number;
    credentials?: Record<string, string>;
  };

  const credentials =
    body.credentials ??
    (body.credentialId != null
      ? getBankCredentials(workspaceId, body.credentialId)
      : null);

  if (!credentials) {
    return NextResponse.json(
      { success: false, message: "No credentials found for this account" },
      { status: 400 }
    );
  }

  const manualTwoFactor =
    body.credentialId != null
      ? getRequiresManualTwoFactor(workspaceId, body.credentialId)
      : false;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let result;
  if (body.provider === "psagot") {
    // Every Psagot sign-in needs an SMS code, which only the sync dialog can
    // collect, so a test can only reuse a session a recent sync left behind.
    const psagot = credentials.otpLongTermToken
      ? await scrapePsagotWithSession(credentials.otpLongTermToken)
      : null;
    if (!psagot?.success) {
      return NextResponse.json({
        success: false,
        message:
          "Psagot verifies each sign-in with an SMS code. Save the account, then run Sync now and enter the code you receive.",
      });
    }
    return NextResponse.json({
      success: true,
      message: "Connection successful",
      accountsFound: psagot.investments?.length ?? 0,
    });
  } else if (
    body.provider === "harel" ||
    body.provider === "analyst" ||
    body.provider === "more" ||
    body.provider === "menora"
  ) {
    // These sign in with an SMS code (Menora and Analyst in a visible window),
    // which only a sync can collect, so a test reuses a saved session only.
    const session = credentials.otpLongTermToken;
    const opts = {
      id: credentials.id ?? "",
      phone: credentials.phoneNumber ?? "",
      savedSession: session,
    };
    const name =
      BANK_PROVIDERS.find((b) => b.id === body.provider)?.name ?? body.provider;
    const pension = !session
      ? null
      : body.provider === "menora"
        ? await scrapeMenora({ ...opts, interactive: false })
        : body.provider === "analyst"
          ? await scrapeAnalyst({ ...opts, interactive: false })
          : body.provider === "harel"
            ? await scrapeHarel(opts)
            : await scrapeMore(opts);
    if (!pension?.success) {
      return NextResponse.json({
        success: false,
        message:
          body.provider === "menora" || body.provider === "analyst"
            ? `${name} signs in through a browser window. Save the account, then run Sync now and sign in in the window that opens.`
            : `${name} verifies each sign-in with an SMS code. Save the account, then run Sync now and enter the code you receive.`,
      });
    }
    return NextResponse.json({
      success: true,
      message: "Connection successful",
      accountsFound: pension.investments?.length ?? 0,
    });
  } else if (body.provider === "pepper") {
    // Pepper can only be tested once a sync has saved its device token; the
    // first login needs an SMS code, which only the sync dialog can collect.
    if (!credentials.otpLongTermToken) {
      return NextResponse.json({
        success: false,
        message:
          "Pepper verifies new connections with an SMS code. Save the account, then run Sync now and enter the code you receive.",
      });
    }
    result = await scrapePepperWithToken({
      phoneNumber: credentials.phoneNumber,
      password: credentials.password,
      otpLongTermToken: credentials.otpLongTermToken,
      startDate: sevenDaysAgo,
    });
  } else {
    result = await scrapeBank(
      workspaceId,
      body.provider as BankProvider,
      credentials,
      sevenDaysAgo,
      {
        manualTwoFactor,
        hapoalim: { deviceTrust: credentials.otpLongTermToken },
      }
    );
  }

  if (!result.success) {
    return NextResponse.json({
      success: false,
      message: result.errorMessage ?? "Connection test failed",
    });
  }

  return NextResponse.json({
    success: true,
    message: "Connection successful",
    accountsFound: result.accounts.length,
  });
}
