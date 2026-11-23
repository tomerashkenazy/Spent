"use client";

import { useLocale, useTranslations } from "next-intl";
import { CardShell } from "@/components/home/card-shell";
import { formatCurrency } from "@/lib/formatters";
import { moneyMarketByAccount } from "@/lib/investments";
import type { Locale } from "@/i18n/routing";
import type { InvestmentAccount } from "@/lib/types";

/**
 * Money market funds (קרנות כספיות) across all portfolios: near-cash money
 * that is usually set aside for a goal, so it gets its own view.
 */
export function MoneyMarketCard({
  accounts,
  groupTotal,
}: {
  accounts: InvestmentAccount[];
  /** Total of the Investments screen, for the share line. */
  groupTotal: number;
}) {
  const t = useTranslations("investments");
  const locale = useLocale() as Locale;
  const { groups, total } = moneyMarketByAccount(accounts);
  const sharePct = groupTotal > 0 ? Math.round((total / groupTotal) * 100) : 0;

  return (
    <CardShell label={t("moneyMarketLabel")}>
      <div className="flex flex-1 flex-col gap-5">
        <div className="flex flex-col">
          <span className="font-serif text-3xl leading-none tracking-tight tabular-nums">
            {formatCurrency(total, "ILS", locale)}
          </span>
          <span className="mt-2 text-sm text-muted-foreground">
            {t("moneyMarketShare", { percent: sharePct })}
          </span>
        </div>
        <ul className="flex flex-col gap-4">
          {groups.map((g) => (
            <li key={g.account.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">
                  {g.account.credentialLabel}
                </span>
                <span className="text-sm tabular-nums">
                  {formatCurrency(g.total, "ILS", locale)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${total > 0 ? (g.total / total) * 100 : 0}%` }}
                />
              </div>
              <ul className="flex flex-col gap-1">
                {g.holdings.map((h, i) => (
                  <li
                    key={`${h.name}-${i}`}
                    className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground"
                  >
                    <span className="truncate">{h.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatCurrency(h.value, h.currency, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </CardShell>
  );
}
