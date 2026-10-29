-- Investment portfolios (bank securities, brokerages) and long-term savings
-- (pension, gemel, hishtalmut). Each sync writes one snapshot per account per
-- day; the holdings of that snapshot are replaced wholesale, so history is
-- the series of daily totals rather than a ledger of trades.
--
-- Disconnecting a credential removes its investment data (ON DELETE CASCADE):
-- unlike transactions, a balance snapshot has no meaning without the account.

CREATE TABLE investment_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES bank_credentials(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('brokerage', 'pension', 'gemel', 'hishtalmut', 'gemel_lehashkaa')),
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ILS',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(credential_id, external_id)
);

CREATE INDEX idx_investment_accounts_workspace ON investment_accounts(workspace_id);

CREATE TABLE investment_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
  sync_run_id INTEGER REFERENCES sync_runs(id) ON DELETE SET NULL,
  as_of TEXT NOT NULL,
  total_value REAL NOT NULL,
  cash_value REAL,
  monthly_deposit REAL,
  ytd_return_pct REAL,
  mgmt_fee_deposit_pct REAL,
  mgmt_fee_balance_pct REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, as_of)
);

CREATE TABLE investment_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES investment_snapshots(id) ON DELETE CASCADE,
  symbol TEXT,
  name TEXT NOT NULL,
  quantity REAL,
  price REAL,
  value REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ILS',
  change_pct REAL,
  profit_loss REAL
);

CREATE INDEX idx_investment_holdings_snapshot ON investment_holdings(snapshot_id);
