import { BANK_PROVIDERS, type Integration, type ProjectItem } from "@/lib/types";

export function toLocalISODateClient(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Accounts money can be paid from: banks and cards, not pension funds. */
export function payingAccounts(integrations: Integration[]): Integration[] {
  const investmentOnly = new Set<string>(
    BANK_PROVIDERS.filter((p) => p.kind === "investment").map((p) => p.id)
  );
  return integrations.filter((i) => !investmentOnly.has(i.provider));
}

export function payerLabel(item: ProjectItem): string | null {
  return item.paidFromLabel ?? item.paidFromText ?? null;
}
