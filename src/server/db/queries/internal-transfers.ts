import "server-only";

import { getDb } from "../index";
import { BANK_PROVIDER_IDS } from "../../lib/transfers";

/** Transfers smaller than this are too likely to be coincidental matches. */
const MIN_AMOUNT = 50;
/** Standing orders can land a few days apart across banks. */
const MAX_DAYS_APART = 3;

interface Candidate {
  outId: number;
  inId: number;
  gap: number;
}

/**
 * Marks money moved between the user's own bank accounts (e.g. a standing
 * order from a personal account into a joint one) as `transfer`, so it is not
 * counted as both an expense and income.
 *
 * A pair is an outgoing and an incoming bank transaction of the exact same
 * amount, in different accounts, at most a few days apart. Pairing is 1:1 and
 * closest-date-first, so two people each sending 5,000 into the same joint
 * account on the same day yields two pairs, not four. Rows whose kind the
 * user set by hand (`kind_locked`) are never touched.
 *
 * Idempotent: safe to run after every sync.
 */
export function markInternalTransfers(workspaceId: number): number {
  const db = getDb();
  const providers = BANK_PROVIDER_IDS.map(() => "?").join(",");

  const candidates = db
    .prepare(
      `SELECT a.id AS outId, b.id AS inId,
              ABS(julianday(a.date) - julianday(b.date)) AS gap
       FROM transactions a
       JOIN transactions b
         ON b.workspace_id = a.workspace_id
        AND b.charged_amount = -a.charged_amount
        AND (b.credential_id IS NOT a.credential_id OR b.account_number != a.account_number)
        AND ABS(julianday(a.date) - julianday(b.date)) <= ?
       WHERE a.workspace_id = ?
         AND a.charged_amount <= -?
         AND a.provider IN (${providers})
         AND b.provider IN (${providers})
         AND a.kind != 'transfer' AND b.kind != 'transfer'
         AND a.kind_locked = 0 AND b.kind_locked = 0
       ORDER BY gap ASC, a.date ASC, a.id ASC, b.id ASC`
    )
    .all(
      MAX_DAYS_APART,
      workspaceId,
      MIN_AMOUNT,
      ...BANK_PROVIDER_IDS,
      ...BANK_PROVIDER_IDS
    ) as Candidate[];

  const used = new Set<number>();
  const ids: number[] = [];
  for (const c of candidates) {
    if (used.has(c.outId) || used.has(c.inId)) continue;
    used.add(c.outId);
    used.add(c.inId);
    ids.push(c.outId, c.inId);
  }
  if (ids.length === 0) return 0;

  const update = db.prepare(
    `UPDATE transactions SET kind = 'transfer', updated_at = datetime('now')
     WHERE workspace_id = ? AND id = ?`
  );
  db.transaction(() => {
    for (const id of ids) update.run(workspaceId, id);
  })();
  return ids.length / 2;
}
