"use client";

import { useLocale, useTranslations } from "next-intl";
import { CardShell } from "@/components/home/card-shell";
import { formatCurrency } from "@/lib/formatters";
import type { Locale } from "@/i18n/routing";
import type { Project, ProjectItem } from "@/lib/types";
import { payerLabel } from "./project-utils";

const TILE = "col-span-12 sm:col-span-6 xl:col-span-3";

export function ProjectSummary({
  project,
  items,
  moneyMarketTotal,
}: {
  project: Project;
  items: ProjectItem[];
  /** null while investments load or when there are no money market funds. */
  moneyMarketTotal: number | null;
}) {
  const t = useTranslations("projects");
  const locale = useLocale() as Locale;
  const fmt = (v: number) => formatCurrency(v, "ILS", locale);

  const spent = project.spent;
  const budget = project.budgetAmount;
  const pct = budget && budget > 0 ? Math.min((spent / budget) * 100, 100) : null;
  const over = budget != null && spent > budget;

  const byPayer = new Map<string, number>();
  for (const item of items) {
    if (item.status === "unpaid") continue;
    const key = payerLabel(item) ?? t("paidFromNone");
    byPayer.set(key, (byPayer.get(key) ?? 0) + item.amount);
  }
  const payers = [...byPayer.entries()].sort((a, b) => b[1] - a[1]);

  const deposits = items
    .filter((i) => i.status === "deposit")
    .reduce((s, i) => s + i.amount, 0);

  return (
    <>
      <div className={TILE}>
        <CardShell label={t("summarySpent")}>
          <div className="flex flex-1 flex-col gap-3">
            <span className="font-serif text-3xl leading-none tracking-tight tabular-nums">
              {fmt(spent)}
            </span>
            {budget != null ? (
              <>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct ?? 0}%`,
                      backgroundColor: over ? "var(--status-over)" : "var(--foreground)",
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {over
                    ? t("overBudget", { amount: fmt(spent - budget) })
                    : t("ofBudget", { budget: fmt(budget), left: fmt(budget - spent) })}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{t("noBudget")}</span>
            )}
          </div>
        </CardShell>
      </div>

      <div className={TILE}>
        <CardShell label={t("summaryByPayer")}>
          {payers.length === 0 ? (
            <span className="text-sm text-muted-foreground">–</span>
          ) : (
            <ul className="flex flex-col gap-2">
              {payers.map(([name, value]) => (
                <li key={name} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{name}</span>
                  <span className="shrink-0 tabular-nums">{fmt(value)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardShell>
      </div>

      <div className={TILE}>
        <CardShell label={t("summaryCommitted")}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-serif text-2xl leading-none tabular-nums">
                {fmt(project.unpaid)}
              </span>
              <span className="text-xs text-muted-foreground">{t("summaryUnpaidHint")}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{t("summaryDeposits")}</span>
              <span className="tabular-nums">{fmt(deposits)}</span>
            </div>
          </div>
        </CardShell>
      </div>

      <div className={TILE}>
        <CardShell label={t("summaryMoneyMarket")}>
          <div className="flex flex-col gap-1">
            <span className="font-serif text-2xl leading-none tabular-nums">
              {moneyMarketTotal != null ? fmt(moneyMarketTotal) : "–"}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("summaryMoneyMarketHint")}
            </span>
          </div>
        </CardShell>
      </div>
    </>
  );
}
