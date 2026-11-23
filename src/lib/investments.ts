import type { InvestmentAccount, InvestmentHolding } from "./types";

// Israeli money market funds carry "כספית" in their name ("איילון כספית",
// "מגדל כספית שקלית"). Brokers do not expose an asset-class field we store,
// so the name is the reliable signal.
const MONEY_MARKET_PATTERN = /כספית|כספי\s*שקלי|money\s*market/i;

export function isMoneyMarketFund(name: string): boolean {
  return MONEY_MARKET_PATTERN.test(name);
}

export interface MoneyMarketGroup {
  account: InvestmentAccount;
  holdings: InvestmentHolding[];
  total: number;
}

/** Money market fund holdings, grouped by account, largest account first. */
export function moneyMarketByAccount(
  accounts: InvestmentAccount[]
): { groups: MoneyMarketGroup[]; total: number } {
  const groups: MoneyMarketGroup[] = [];
  for (const account of accounts) {
    const holdings = account.holdings
      .filter((h) => isMoneyMarketFund(h.name))
      .sort((a, b) => b.value - a.value);
    if (holdings.length === 0) continue;
    const total = holdings.reduce((s, h) => s + h.value, 0);
    groups.push({ account, holdings, total });
  }
  groups.sort((a, b) => b.total - a.total);
  return { groups, total: groups.reduce((s, g) => s + g.total, 0) };
}
