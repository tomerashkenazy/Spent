import "server-only";

import {
  PROJECT_ITEM_STATUSES,
  type ProjectInput,
  type ProjectItemInput,
  type ProjectItemStatus,
} from "@/lib/types";

const MAX_TEXT = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function optionalText(v: unknown, field: string): Parsed<string | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${field} must be a string` };
  const trimmed = v.trim();
  if (trimmed.length > MAX_TEXT) return { ok: false, error: `${field} is too long` };
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

export function parseProjectInput(body: Record<string, unknown>): Parsed<ProjectInput> {
  const out: ProjectInput = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 128) {
      return { ok: false, error: "name must be a non-empty string" };
    }
    out.name = body.name.trim();
  }
  if (body.budgetAmount !== undefined) {
    if (
      body.budgetAmount !== null &&
      (typeof body.budgetAmount !== "number" ||
        !Number.isFinite(body.budgetAmount) ||
        body.budgetAmount < 0)
    ) {
      return { ok: false, error: "budgetAmount must be a positive number or null" };
    }
    out.budgetAmount = body.budgetAmount as number | null;
  }
  if (body.excludesFromSpending !== undefined) {
    if (typeof body.excludesFromSpending !== "boolean") {
      return { ok: false, error: "excludesFromSpending must be a boolean" };
    }
    out.excludesFromSpending = body.excludesFromSpending;
  }
  return { ok: true, value: out };
}

export function parseProjectItemInput(
  body: Record<string, unknown>
): Parsed<ProjectItemInput> {
  const out: ProjectItemInput = {};
  if (body.date !== undefined) {
    if (typeof body.date !== "string" || !DATE_RE.test(body.date)) {
      return { ok: false, error: "date must be YYYY-MM-DD" };
    }
    out.date = body.date;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string" || !body.description.trim()) {
      return { ok: false, error: "description must be a non-empty string" };
    }
    out.description = body.description.trim().slice(0, MAX_TEXT);
  }
  if (body.amount !== undefined) {
    if (typeof body.amount !== "number" || !Number.isFinite(body.amount)) {
      return { ok: false, error: "amount must be a number" };
    }
    out.amount = body.amount;
  }
  if (body.paidFromCredentialId !== undefined) {
    const v = body.paidFromCredentialId;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v <= 0)) {
      return { ok: false, error: "paidFromCredentialId must be an id or null" };
    }
    out.paidFromCredentialId = v as number | null;
  }
  for (const field of ["paidFromText", "category", "notes"] as const) {
    const parsed = optionalText(body[field], field);
    if (!parsed.ok) return parsed;
    if (parsed.value !== undefined) out[field] = parsed.value;
  }
  if (body.status !== undefined) {
    if (!PROJECT_ITEM_STATUSES.includes(body.status as ProjectItemStatus)) {
      return { ok: false, error: "status must be paid, deposit or unpaid" };
    }
    out.status = body.status as ProjectItemStatus;
  }
  return { ok: true, value: out };
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}
