import { NextResponse } from "next/server";
import {
  getInvestmentAccounts,
  getInvestmentHistory,
} from "@/server/db/queries/investments";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import type { InvestmentsPayload, InvestmentsSection } from "@/lib/types";

function safe<T>(
  section: InvestmentsSection,
  errors: InvestmentsPayload["errors"],
  fn: () => T
): T | null {
  try {
    return fn();
  } catch (err) {
    errors.push({
      section,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const errors: InvestmentsPayload["errors"] = [];
  const payload: InvestmentsPayload = {
    accounts: safe("accounts", errors, () => getInvestmentAccounts(workspaceId)),
    history: safe("history", errors, () => getInvestmentHistory(workspaceId)),
    errors,
  };
  return NextResponse.json(payload);
}
