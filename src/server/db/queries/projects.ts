import "server-only";

import { getDb } from "../index";
import type {
  Project,
  ProjectInput,
  ProjectItem,
  ProjectItemInput,
  ProjectItemStatus,
} from "@/lib/types";

interface ProjectRow {
  id: number;
  name: string;
  budget_amount: number | null;
  excludes_from_spending: number;
  spent: number;
  unpaid: number;
  item_count: number;
  created_at: string;
}

interface ItemRow {
  id: number;
  project_id: number;
  transaction_id: number | null;
  date: string;
  description: string;
  amount: number;
  paid_from_credential_id: number | null;
  paid_from_label: string | null;
  paid_from_text: string | null;
  category: string | null;
  status: ProjectItemStatus;
  notes: string | null;
}

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    budgetAmount: r.budget_amount,
    excludesFromSpending: r.excludes_from_spending === 1,
    spent: r.spent,
    unpaid: r.unpaid,
    itemCount: r.item_count,
    createdAt: r.created_at,
  };
}

function mapItem(r: ItemRow): ProjectItem {
  return {
    id: r.id,
    projectId: r.project_id,
    transactionId: r.transaction_id,
    date: r.date,
    description: r.description,
    amount: r.amount,
    paidFromCredentialId: r.paid_from_credential_id,
    paidFromLabel: r.paid_from_label,
    paidFromText: r.paid_from_text,
    category: r.category,
    status: r.status,
    notes: r.notes,
  };
}

const PROJECT_SELECT = `
  SELECT p.id, p.name, p.budget_amount, p.excludes_from_spending, p.created_at,
         COALESCE((SELECT SUM(amount) FROM project_items
                   WHERE project_id = p.id AND status != 'unpaid'), 0) AS spent,
         COALESCE((SELECT SUM(amount) FROM project_items
                   WHERE project_id = p.id AND status = 'unpaid'), 0) AS unpaid,
         (SELECT COUNT(*) FROM project_items WHERE project_id = p.id) AS item_count
  FROM projects p`;

export function listProjects(workspaceId: number): Project[] {
  const rows = getDb()
    .prepare(`${PROJECT_SELECT} WHERE p.workspace_id = ? ORDER BY p.created_at ASC, p.id ASC`)
    .all(workspaceId) as ProjectRow[];
  return rows.map(mapProject);
}

export function getProject(workspaceId: number, id: number): Project | null {
  const row = getDb()
    .prepare(`${PROJECT_SELECT} WHERE p.workspace_id = ? AND p.id = ?`)
    .get(workspaceId, id) as ProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export function createProject(
  workspaceId: number,
  input: { name: string; budgetAmount: number | null; excludesFromSpending: boolean }
): Project {
  const result = getDb()
    .prepare(
      `INSERT INTO projects (workspace_id, name, budget_amount, excludes_from_spending)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      workspaceId,
      input.name,
      input.budgetAmount,
      input.excludesFromSpending ? 1 : 0
    );
  return getProject(workspaceId, Number(result.lastInsertRowid))!;
}

export function updateProject(
  workspaceId: number,
  id: number,
  input: ProjectInput
): Project | null {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    values.push(input.name);
  }
  if (input.budgetAmount !== undefined) {
    sets.push("budget_amount = ?");
    values.push(input.budgetAmount);
  }
  if (input.excludesFromSpending !== undefined) {
    sets.push("excludes_from_spending = ?");
    values.push(input.excludesFromSpending ? 1 : 0);
  }
  if (sets.length > 0) {
    getDb()
      .prepare(
        `UPDATE projects SET ${sets.join(", ")}, updated_at = datetime('now')
         WHERE workspace_id = ? AND id = ?`
      )
      .run(...values, workspaceId, id);
  }
  return getProject(workspaceId, id);
}

export function deleteProject(workspaceId: number, id: number): boolean {
  const result = getDb()
    .prepare("DELETE FROM projects WHERE workspace_id = ? AND id = ?")
    .run(workspaceId, id);
  return result.changes > 0;
}

const ITEM_SELECT = `
  SELECT pi.*, bc.label AS paid_from_label
  FROM project_items pi
  JOIN projects p ON p.id = pi.project_id
  LEFT JOIN bank_credentials bc ON bc.id = pi.paid_from_credential_id`;

export function listProjectItems(workspaceId: number, projectId: number): ProjectItem[] {
  const rows = getDb()
    .prepare(
      `${ITEM_SELECT}
       WHERE p.workspace_id = ? AND pi.project_id = ?
       ORDER BY pi.date DESC, pi.id DESC`
    )
    .all(workspaceId, projectId) as ItemRow[];
  return rows.map(mapItem);
}

function getItem(workspaceId: number, itemId: number): ProjectItem | null {
  const row = getDb()
    .prepare(`${ITEM_SELECT} WHERE p.workspace_id = ? AND pi.id = ?`)
    .get(workspaceId, itemId) as ItemRow | undefined;
  return row ? mapItem(row) : null;
}

export type AddTransactionResult =
  | { ok: true; item: ProjectItem }
  | { ok: false; reason: "not_found" | "duplicate" };

/**
 * Links a synced transaction. Date, description, amount and the paying
 * account are copied so the row stays editable and survives the transaction
 * being deleted.
 */
export function addTransactionToProject(
  workspaceId: number,
  projectId: number,
  transactionId: number
): AddTransactionResult {
  const db = getDb();
  const project = getProject(workspaceId, projectId);
  const tx = db
    .prepare(
      `SELECT id, date, description, charged_amount, credential_id
       FROM transactions WHERE workspace_id = ? AND id = ?`
    )
    .get(workspaceId, transactionId) as
    | {
        id: number;
        date: string;
        description: string;
        charged_amount: number;
        credential_id: number | null;
      }
    | undefined;
  if (!project || !tx) return { ok: false, reason: "not_found" };

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO project_items
         (project_id, transaction_id, date, description, amount, paid_from_credential_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      projectId,
      tx.id,
      tx.date.slice(0, 10),
      tx.description,
      -tx.charged_amount,
      tx.credential_id
    );
  if (result.changes === 0) return { ok: false, reason: "duplicate" };
  return { ok: true, item: getItem(workspaceId, Number(result.lastInsertRowid))! };
}

export function addManualProjectItem(
  workspaceId: number,
  projectId: number,
  input: Required<Pick<ProjectItemInput, "date" | "description" | "amount">> &
    ProjectItemInput
): ProjectItem | null {
  if (!getProject(workspaceId, projectId)) return null;
  const result = getDb()
    .prepare(
      `INSERT INTO project_items
         (project_id, date, description, amount, paid_from_credential_id,
          paid_from_text, category, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      projectId,
      input.date,
      input.description,
      input.amount,
      input.paidFromCredentialId ?? null,
      input.paidFromText ?? null,
      input.category ?? null,
      input.status ?? "paid",
      input.notes ?? null
    );
  return getItem(workspaceId, Number(result.lastInsertRowid));
}

const ITEM_COLUMNS: Record<keyof ProjectItemInput, string> = {
  date: "date",
  description: "description",
  amount: "amount",
  paidFromCredentialId: "paid_from_credential_id",
  paidFromText: "paid_from_text",
  category: "category",
  status: "status",
  notes: "notes",
};

export function updateProjectItem(
  workspaceId: number,
  projectId: number,
  itemId: number,
  input: ProjectItemInput
): ProjectItem | null {
  const existing = getItem(workspaceId, itemId);
  if (!existing || existing.projectId !== projectId) return null;
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, column] of Object.entries(ITEM_COLUMNS) as [
    keyof ProjectItemInput,
    string,
  ][]) {
    const value = input[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (sets.length > 0) {
    getDb()
      .prepare(
        `UPDATE project_items SET ${sets.join(", ")}, updated_at = datetime('now')
         WHERE id = ? AND project_id = ?`
      )
      .run(...values, itemId, projectId);
  }
  return getItem(workspaceId, itemId);
}

export function deleteProjectItem(
  workspaceId: number,
  projectId: number,
  itemId: number
): boolean {
  const result = getDb()
    .prepare(
      `DELETE FROM project_items
       WHERE id = ? AND project_id = (
         SELECT id FROM projects WHERE id = ? AND workspace_id = ?
       )`
    )
    .run(itemId, projectId, workspaceId);
  return result.changes > 0;
}
