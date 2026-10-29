import "server-only";

import LeumiScraper from "israeli-bank-scrapers/lib/scrapers/leumi";
import { fetchGetWithinPage } from "israeli-bank-scrapers/lib/helpers/fetch";
import type { Page } from "puppeteer";
import { toLocalISODate } from "../../lib/date-utils";
import type { ScrapedInvestmentAccount } from "../types";

/**
 * Securities portfolios inside the logged-in Bank Leumi session. Ported from
 * eshaham/israeli-bank-scrapers PR #1166 (not merged upstream). After the
 * transaction scrape the page is already on hb2.bankleumi.co.il, so the
 * trading API is a same-origin fetch with the session cookies.
 */

const BASE_URL = "https://hb2.bankleumi.co.il";
const CONFIG_URL = `${BASE_URL}/lti/lti-app/api/config`;
const STATEMENT_URL = `${BASE_URL}/lti/lti-app/api/Trade/Statement`;

interface RawPortfolio {
  PortfolioId: string;
  PortfolioName?: string;
}

interface RawHolding {
  PaperName?: string;
  Symbol?: string;
  Amount?: number;
  Value?: number;
}

interface StatementResponse {
  data?: {
    UserStatement?: {
      DataSource?: RawHolding[] | null;
      PortfolioValue?: number;
    };
  };
}

// Reproduced from the bank's own request; only the index and date vary.
function statementUrl(portfolioIndex: number, asOf: string): string {
  const params = new URLSearchParams({
    PortfolioIndex: String(portfolioIndex),
    StatementType: "ByDate",
    ViewDate: asOf,
    ViewID: "7",
    SubView: "16",
    FromCache: "false",
    AlwaysChangePercent: "false",
    IsMain: "false",
    RegionId: "-1",
    CurrencyCode: "0",
    rt: "true",
  });
  return `${STATEMENT_URL}?${params.toString()}`;
}

export function mapLeumiStatement(
  data: StatementResponse,
  portfolio: RawPortfolio
): ScrapedInvestmentAccount | null {
  const statement = data.data?.UserStatement;
  if (!statement) return null;
  const holdings = (statement.DataSource ?? []).map((row) => ({
    symbol: row.Symbol || undefined,
    name: row.PaperName || row.Symbol || "Unknown security",
    quantity: row.Amount,
    value: row.Value ?? 0,
    // Leumi reports every holding in shekels; there is no currency field.
    currency: "ILS",
  }));
  // PortfolioValue also covers uninvested cash, so prefer it to a sum.
  const totalValue =
    statement.PortfolioValue ?? holdings.reduce((sum, h) => sum + h.value, 0);
  if (totalValue === 0 && holdings.length === 0) return null;
  return {
    externalId: `${portfolio.PortfolioId}-securities`,
    kind: "brokerage",
    name: portfolio.PortfolioName || `Portfolio ${portfolio.PortfolioId}`,
    currency: "ILS",
    totalValue,
    holdings,
  };
}

export async function fetchLeumiSecurities(
  page: Page
): Promise<ScrapedInvestmentAccount[]> {
  const config = await fetchGetWithinPage<{
    data?: { user?: { Portfolios?: RawPortfolio[] } };
  }>(page, CONFIG_URL, true);
  // No config means the customer has no trading service.
  const portfolios = config?.data?.user?.Portfolios ?? [];
  const today = toLocalISODate(new Date());

  const results: ScrapedInvestmentAccount[] = [];
  for (let index = 0; index < portfolios.length; index += 1) {
    const data = await fetchGetWithinPage<StatementResponse>(
      page,
      statementUrl(index, today),
      true
    );
    const mapped = data ? mapLeumiStatement(data, portfolios[index]) : null;
    if (mapped) results.push(mapped);
  }
  return results;
}

/** The stock Leumi scraper, plus the securities portfolios after transactions. */
export class LeumiInvestmentsScraper extends LeumiScraper {
  capturedInvestments?: ScrapedInvestmentAccount[];

  async fetchData() {
    const result = await super.fetchData();
    if (result.success) {
      try {
        this.capturedInvestments = await fetchLeumiSecurities(this.page);
      } catch {
        // Never fail the transaction sync over the portfolio; the message
        // could echo account data, so it is not logged.
        console.warn("[leumi] securities fetch failed");
      }
    }
    return result;
  }
}
