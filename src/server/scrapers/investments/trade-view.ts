import "server-only";

import type { ScrapedHolding, ScrapedInvestmentAccount } from "../types";

/**
 * The account view returned by the trading platform behind both Bank
 * Hapoalim's MyTrade and Psagot (same vendor, same JSON shape).
 */

// The view endpoint only returns the metadata fields it is asked for.
export const SECURITY_FIELDS = [
  "EngName",
  "EngSymbol",
  "HebName",
  "HebSymbol",
  "Symbol",
  "ItemType",
  "CurrencyCode",
  "Exchange",
].join(",");

interface SecurityBalance {
  EquityNumber: string;
  LastRate?: number;
  AveragePriceProfitLossPercentage?: number;
  AveragePriceProfitLoss?: number;
  AveragePriceProfitLossNis?: number;
  OnlineNV?: number;
  OnlineVL?: number;
  OnlineNisVL?: number;
  CurrencyCode?: string;
}

interface SecurityMeta {
  "-Key": string;
  EngName?: string;
  EngSymbol?: string;
  HebName?: string;
  HebSymbol?: string;
  Symbol?: string;
  CurrencyCode?: string;
}

export interface AccountView {
  View?: {
    Account?: {
      OnlineValue?: number;
      OnlineCash?: number;
      CurrencyCode?: string;
      AccountPosition?: { Balance?: SecurityBalance[] | SecurityBalance };
    };
    Meta?: { Security?: SecurityMeta[] | SecurityMeta };
  };
}

// The API returns a bare object instead of a one-element array.
function asArray<T>(value: T[] | T | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeCurrency(code: string | undefined): string {
  if (!code || code === "NIS" || code === "ILS" || code === "₪") return "ILS";
  return code;
}

function roundMoney(value: number | undefined): number | undefined {
  return typeof value === "number" ? Math.round(value * 100) / 100 : undefined;
}

export function mapTradeAccountView(
  view: AccountView,
  externalId: string,
  name: string
): ScrapedInvestmentAccount | null {
  const account = view.View?.Account;
  if (!account) return null;

  const meta = new Map(
    asArray(view.View?.Meta?.Security).map((m) => [m["-Key"], m])
  );
  const holdings: ScrapedHolding[] = asArray(account.AccountPosition?.Balance).map(
    (b) => {
      const m = meta.get(b.EquityNumber);
      // OnlineNisVL is the shekel value even for foreign securities, which
      // keeps the account total and the holdings summable.
      const hasNis = typeof b.OnlineNisVL === "number";
      return {
        symbol: m?.EngSymbol || m?.Symbol || m?.HebSymbol || b.EquityNumber,
        name: m?.HebName || m?.EngName || b.EquityNumber,
        quantity: b.OnlineNV,
        value: (hasNis ? b.OnlineNisVL : b.OnlineVL) ?? 0,
        currency: hasNis
          ? "ILS"
          : normalizeCurrency(b.CurrencyCode || m?.CurrencyCode),
        changePct: b.AveragePriceProfitLossPercentage,
        profitLoss: roundMoney(
          b.AveragePriceProfitLossNis ?? b.AveragePriceProfitLoss
        ),
      };
    }
  );

  const totalValue = account.OnlineValue ?? 0;
  if (totalValue === 0 && holdings.length === 0) return null;

  return {
    externalId,
    kind: "brokerage",
    name,
    currency: normalizeCurrency(account.CurrencyCode),
    totalValue,
    cashValue: account.OnlineCash,
    holdings,
  };
}
