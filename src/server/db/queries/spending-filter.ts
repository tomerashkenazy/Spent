import "server-only";

/**
 * SQL condition for "this transaction counts toward regular spending":
 * not excluded by the user and not linked to a project that is kept out of
 * monthly spending (e.g. a wedding). Pass the table alias used in the query,
 * or omit it when the query reads `FROM transactions` without an alias.
 */
export function spendingFilter(alias?: string): string {
  const col = alias ? `${alias}.` : "transactions.";
  return `(${col}is_excluded = 0 AND NOT EXISTS (
    SELECT 1 FROM project_items spf_pi
    JOIN projects spf_p ON spf_p.id = spf_pi.project_id
    WHERE spf_pi.transaction_id = ${col}id AND spf_p.excludes_from_spending = 1
  ))`;
}
