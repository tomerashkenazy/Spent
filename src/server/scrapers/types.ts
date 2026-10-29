import "server-only";

import type { InvestmentKind } from "@/lib/types";

export interface ScrapedTransaction {
  type: "normal" | "installments";
  identifier?: string | number;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
  installments?: { number: number; total: number };
  status: "completed" | "pending";
}

export interface ScrapedAccount {
  accountNumber: string;
  transactions: ScrapedTransaction[];
}

export interface ScrapedHolding {
  symbol?: string;
  name: string;
  quantity?: number;
  price?: number;
  value: number;
  currency: string;
  changePct?: number;
  profitLoss?: number;
}

export interface ScrapedInvestmentAccount {
  /** Stable id within the credential (portfolio or policy number). */
  externalId: string;
  kind: InvestmentKind;
  name: string;
  currency: string;
  totalValue: number;
  cashValue?: number;
  holdings: ScrapedHolding[];
  pension?: {
    monthlyDeposit?: number;
    ytdReturnPct?: number;
    mgmtFeeDepositPct?: number;
    mgmtFeeBalancePct?: number;
  };
}

export interface ScrapeResult {
  success: boolean;
  accounts: ScrapedAccount[];
  /** Portfolios fetched alongside (or instead of) transactions. */
  investments?: ScrapedInvestmentAccount[];
  errorMessage?: string;
}
