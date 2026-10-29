"use client";

import { useTranslations } from "next-intl";
import { CardShell } from "@/components/home/card-shell";
import { formatCurrency } from "@/lib/formatters";
import { isLongTermInvestment, type InvestmentAccount } from "@/lib/types";

/**
 * Long-term savings vs liquid investments. Two segments in one ink at two
 * strengths, each labelled with its amount and share, so identity never rests
 * on color.
 */
export function AllocationCard({ accounts }: { accounts: InvestmentAccount[] }) {
  const t = useTranslations("investments");
  let longTerm = 0;
  let brokerage = 0;
  for (const a of accounts) {
    if (isLongTermInvestment(a.kind)) longTerm += a.totalValue;
    else brokerage += a.totalValue;
  }
  const total = longTerm + brokerage;
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  const rows = [
    { key: "longTerm", label: t("longTerm"), hint: t("longTermHint"), value: longTerm, opacity: 1 },
    { key: "brokerage", label: t("brokerage"), hint: t("brokerageHint"), value: brokerage, opacity: 0.35 },
  ].filter((r) => r.value > 0);

  return (
    <CardShell label={t("allocationLabel")}>
      <div className="flex flex-1 flex-col gap-5">
        <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
          {rows.map((r) => (
            <div
              key={r.key}
              className="h-full bg-foreground first:rounded-s-full last:rounded-e-full"
              style={{ width: `${share(r.value)}%`, opacity: r.opacity }}
              title={`${r.label}: ${formatCurrency(r.value)}`}
            />
          ))}
        </div>
        <ul className="flex flex-col gap-4">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start gap-3">
              <span
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-foreground"
                style={{ opacity: r.opacity }}
                aria-hidden
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{r.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.round(share(r.value))}%
                  </span>
                </div>
                <span className="font-serif text-xl tabular-nums">
                  {formatCurrency(r.value)}
                </span>
                <span className="text-xs text-muted-foreground">{r.hint}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </CardShell>
  );
}
