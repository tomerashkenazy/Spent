-- 1. Manual kind overrides win over automatic transfer detection. Set when the
--    user changes a transaction's kind from the UI.
ALTER TABLE transactions
  ADD COLUMN kind_locked INTEGER NOT NULL DEFAULT 0;

-- 2. Max bills appear in bank statements as "מקס איט פיננסי" (sometimes
--    truncated), which the card-payment patterns did not catch, so Max
--    spending was counted twice: once on the card, once as a bank expense.
UPDATE transactions
SET kind = 'transfer'
WHERE kind = 'expense'
  AND provider IN (
    'hapoalim', 'leumi', 'mizrahi', 'discount', 'mercantile', 'beinleumi',
    'otsarHahayal', 'pagi', 'yahav', 'massad', 'union', 'oneZero', 'pepper'
  )
  AND description LIKE '%מקס איט%';

-- 3. Projects: a named budget (a wedding, a renovation, a trip) that groups
--    expenses. Items either link to a synced transaction or are entered by
--    hand (cash, gifts, payments from accounts that are not connected).
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  budget_amount REAL,
  -- When on, linked transactions are left out of monthly spending and
  -- budgets so a one-off project does not distort the regular picture.
  excludes_from_spending INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_projects_workspace ON projects(workspace_id);

CREATE TABLE project_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  -- Positive number = money spent on the project.
  amount REAL NOT NULL,
  paid_from_credential_id INTEGER REFERENCES bank_credentials(id) ON DELETE SET NULL,
  paid_from_text TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'paid' CHECK(status IN ('unpaid', 'deposit', 'paid')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, transaction_id)
);

CREATE INDEX idx_project_items_project ON project_items(project_id);
CREATE INDEX idx_project_items_transaction ON project_items(transaction_id);
