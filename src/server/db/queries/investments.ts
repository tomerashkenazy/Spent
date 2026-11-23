import "server-only";

import { getDb } from "../index";
import { toLocalISODate } from "../../lib/date-utils";
import type { ScrapedInvestmentAccount } from "../../scrapers/types";
import {
  investmentGroup,
  type InvestmentAccount,
  type InvestmentHistoryPoint,
  type InvestmentHolding,
  type InvestmentKind,
} from "@/lib/types";

/**
 * Upsert today's snapshot for each scraped account. A second sync on the same
 * day replaces the snapshot and its holdings instead of adding a new point.
 */
export function saveInvestmentSnapshots(
  workspaceId: number,
  credentialId: number,
  provider: string,
  syncRunId: number,
  accounts: ScrapedInvestmentAccount[],
  asOf: Date = new Date()
): number {
  const db = getDb();
  const day = toLocalISODate(asOf);

  const upsertAccount = db.prepare(
    `INSERT INTO investment_accounts
       (workspace_id, credential_id, provider, external_id, kind, name, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(credential_id, external_id) DO UPDATE SET
       kind = excluded.kind,
       name = excluded.name,
       currency = excluded.currency,
       updated_at = datetime('now')
     RETURNING id`
  );
  const upsertSnapshot = db.prepare(
    `INSERT INTO investment_snapshots
       (account_id, sync_run_id, as_of, total_value, cash_value, monthly_deposit,
        ytd_return_pct, mgmt_fee_deposit_pct, mgmt_fee_balance_pct)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, as_of) DO UPDATE SET
       sync_run_id = excluded.sync_run_id,
       total_value = excluded.total_value,
       cash_value = excluded.cash_value,
       monthly_deposit = excluded.monthly_deposit,
       ytd_return_pct = excluded.ytd_return_pct,
       mgmt_fee_deposit_pct = excluded.mgmt_fee_deposit_pct,
       mgmt_fee_balance_pct = excluded.mgmt_fee_balance_pct,
       created_at = datetime('now')
     RETURNING id`
  );
  const clearHoldings = db.prepare(
    `DELETE FROM investment_holdings WHERE snapshot_id = ?`
  );
  const insertHolding = db.prepare(
    `INSERT INTO investment_holdings
       (snapshot_id, symbol, name, quantity, price, value, currency, change_pct, profit_loss)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const run = db.transaction(() => {
    for (const account of accounts) {
      const { id: accountId } = upsertAccount.get(
        workspaceId,
        credentialId,
        provider,
        account.externalId,
        account.kind,
        account.name,
        account.currency
      ) as { id: number };
      const { id: snapshotId } = upsertSnapshot.get(
        accountId,
        syncRunId,
        day,
        account.totalValue,
        account.cashValue ?? null,
        account.pension?.monthlyDeposit ?? null,
        account.pension?.ytdReturnPct ?? null,
        account.pension?.mgmtFeeDepositPct ?? null,
        account.pension?.mgmtFeeBalancePct ?? null
      ) as { id: number };
      clearHoldings.run(snapshotId);
      for (const h of account.holdings) {
        insertHolding.run(
          snapshotId,
          h.symbol ?? null,
          h.name,
          h.quantity ?? null,
          h.price ?? null,
          h.value,
          h.currency,
          h.changePct ?? null,
          h.profitLoss ?? null
        );
      }
    }
  });
  run();
  return accounts.length;
}

interface AccountRow {
  id: number;
  credential_id: number;
  credential_label: string;
  provider: string;
  external_id: string;
  kind: InvestmentKind;
  name: string;
  currency: string;
  snapshot_id: number;
  as_of: string;
  total_value: number;
  cash_value: number | null;
  monthly_deposit: number | null;
  ytd_return_pct: number | null;
  mgmt_fee_deposit_pct: number | null;
  mgmt_fee_balance_pct: number | null;
  previous_value: number | null;
  previous_as_of: string | null;
}

interface HoldingRow {
  snapshot_id: number;
  symbol: string | null;
  name: string;
  quantity: number | null;
  price: number | null;
  value: number;
  currency: string;
  change_pct: number | null;
  profit_loss: number | null;
}

/** Every account with its latest snapshot, holdings, and previous total. */
export function getInvestmentAccounts(workspaceId: number): InvestmentAccount[] {
  const db = getDb();
  const rows = db
    .prepare(
      `WITH ranked AS (
         SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.account_id ORDER BY s.as_of DESC) AS rn
         FROM investment_snapshots s
       )
       SELECT a.id, a.credential_id, c.label AS credential_label, a.provider,
              a.external_id, a.kind, a.name, a.currency,
              cur.id AS snapshot_id, cur.as_of, cur.total_value, cur.cash_value,
              cur.monthly_deposit, cur.ytd_return_pct,
              cur.mgmt_fee_deposit_pct, cur.mgmt_fee_balance_pct,
              prev.total_value AS previous_value, prev.as_of AS previous_as_of
       FROM investment_accounts a
       JOIN bank_credentials c ON c.id = a.credential_id
       JOIN ranked cur ON cur.account_id = a.id AND cur.rn = 1
       LEFT JOIN ranked prev ON prev.account_id = a.id AND prev.rn = 2
       WHERE a.workspace_id = ?
       ORDER BY cur.total_value DESC`
    )
    .all(workspaceId) as AccountRow[];

  if (rows.length === 0) return [];

  const placeholders = rows.map(() => "?").join(",");
  const holdingRows = db
    .prepare(
      `SELECT snapshot_id, symbol, name, quantity, price, value, currency,
              change_pct, profit_loss
       FROM investment_holdings
       WHERE snapshot_id IN (${placeholders})
       ORDER BY value DESC`
    )
    .all(...rows.map((r) => r.snapshot_id)) as HoldingRow[];

  const holdingsBySnapshot = new Map<number, InvestmentHolding[]>();
  for (const h of holdingRows) {
    const list = holdingsBySnapshot.get(h.snapshot_id) ?? [];
    list.push({
      symbol: h.symbol,
      name: h.name,
      quantity: h.quantity,
      price: h.price,
      value: h.value,
      currency: h.currency,
      changePct: h.change_pct,
      profitLoss: h.profit_loss,
    });
    holdingsBySnapshot.set(h.snapshot_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    credentialId: r.credential_id,
    credentialLabel: r.credential_label,
    provider: r.provider,
    externalId: r.external_id,
    kind: r.kind,
    name: r.name,
    currency: r.currency,
    asOf: r.as_of,
    totalValue: r.total_value,
    cashValue: r.cash_value,
    previousValue: r.previous_value,
    previousAsOf: r.previous_as_of,
    monthlyDeposit: r.monthly_deposit,
    ytdReturnPct: r.ytd_return_pct,
    mgmtFeeDepositPct: r.mgmt_fee_deposit_pct,
    mgmtFeeBalancePct: r.mgmt_fee_balance_pct,
    holdings: holdingsBySnapshot.get(r.snapshot_id) ?? [],
  }));
}

/**
 * Daily totals across all accounts. Accounts sync on different days, so each
 * account's last known value is carried forward until its next snapshot.
 */
export function getInvestmentHistory(workspaceId: number): InvestmentHistoryPoint[] {
  const rows = getDb()
    .prepare(
      `SELECT s.account_id, a.kind, s.as_of, s.total_value
       FROM investment_snapshots s
       JOIN investment_accounts a ON a.id = s.account_id
       WHERE a.workspace_id = ?
       ORDER BY s.as_of ASC`
    )
    .all(workspaceId) as {
    account_id: number;
    kind: InvestmentKind;
    as_of: string;
    total_value: number;
  }[];

  // Start once every account has a value: before that, connecting a new
  // account would show up in the chart as a jump in wealth.
  const firstSeen = new Map<number, string>();
  for (const r of rows) {
    if (!firstSeen.has(r.account_id)) firstSeen.set(r.account_id, r.as_of);
  }
  const start = [...firstSeen.values()].reduce((a, b) => (a > b ? a : b), "");

  const latest = new Map<number, { kind: InvestmentKind; value: number }>();
  const points: InvestmentHistoryPoint[] = [];
  let i = 0;
  while (i < rows.length) {
    const date = rows[i].as_of;
    while (i < rows.length && rows[i].as_of === date) {
      latest.set(rows[i].account_id, {
        kind: rows[i].kind,
        value: rows[i].total_value,
      });
      i += 1;
    }
    if (date < start) continue;
    let investments = 0;
    let savings = 0;
    for (const { kind, value } of latest.values()) {
      if (investmentGroup(kind) === "savings") savings += value;
      else investments += value;
    }
    points.push({ date, investments, savings, total: investments + savings });
  }
  return points;
}
