"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { CardShell } from "@/components/home/card-shell";
import { ProviderBadge } from "@/components/setup/provider-badge";
import { formatCurrency } from "@/lib/formatters";
import { translateProviderName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { isMoneyMarketFund } from "@/lib/investments";
import { BANK_PROVIDERS, type InvestmentAccount } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { ChangePill, signedPercentClass } from "./change-pill";

const COLLAPSED_HOLDINGS = 5;

function formatNumber(value: number, locale: Locale, digits = 2): string {
  return value.toLocaleString(locale === "he" ? "he-IL" : "en-IL", {
    maximumFractionDigits: digits,
  });
}

function formatDay(isoDay: string, locale: Locale): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(
    locale === "he" ? "he-IL" : "en-IL",
    { day: "numeric", month: "short" }
  );
}

export function AccountCard({ account }: { account: InvestmentAccount }) {
  const t = useTranslations("investments");
  const tBanks = useTranslations("banks");
  const locale = useLocale() as Locale;
  const info = BANK_PROVIDERS.find((b) => b.id === account.provider);
  const providerName = translateProviderName(
    account.provider,
    info?.name ?? account.provider,
    tBanks
  );
  const change =
    account.previousValue != null
      ? account.totalValue - account.previousValue
      : null;
  const changePct =
    change != null && account.previousValue
      ? (change / account.previousValue) * 100
      : null;

  return (
    <CardShell>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-4">
          <ProviderBadge
            color={info?.color ?? "var(--muted-foreground)"}
            name={providerName}
            domain={info?.domain}
            size={40}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate font-medium">{account.name}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{providerName}</span>
              {account.credentialLabel &&
                account.credentialLabel !== providerName && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{account.credentialLabel}</span>
                  </>
                )}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                {t(`kinds.${account.kind}`)}
              </span>
            </span>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="font-serif text-2xl leading-none tabular-nums">
              {formatCurrency(account.totalValue, account.currency, locale)}
            </span>
            <span className="flex items-center gap-2">
              {change != null && (
                <ChangePill
                  amount={change}
                  percent={changePct}
                  title={t("sinceDate", {
                    date: formatDay(account.previousAsOf ?? account.asOf, locale),
                  })}
                />
              )}
              <span className="text-xs text-muted-foreground">
                {t("asOf", { date: formatDay(account.asOf, locale) })}
              </span>
            </span>
          </div>
        </div>

        {account.kind === "brokerage" ? (
          <Holdings account={account} locale={locale} />
        ) : (
          <SavingsStats account={account} locale={locale} />
        )}
      </div>
    </CardShell>
  );
}

function Holdings({
  account,
  locale,
}: {
  account: InvestmentAccount;
  locale: Locale;
}) {
  const t = useTranslations("investments");
  const [expanded, setExpanded] = useState(false);
  const holdings = account.holdings;
  if (holdings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("noHoldings")}</p>
    );
  }
  const visible = expanded ? holdings : holdings.slice(0, COLLAPSED_HOLDINGS);
  const hasReturn = holdings.some((h) => h.changePct != null);
  const hasProfit = holdings.some((h) => h.profitLoss != null);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="py-2 pe-3 text-start font-medium">{t("colSecurity")}</th>
              <th className="hidden py-2 pe-3 text-end font-medium sm:table-cell">
                {t("colQuantity")}
              </th>
              <th className="py-2 pe-3 text-end font-medium">{t("colValue")}</th>
              {hasReturn && (
                <th className="py-2 pe-3 text-end font-medium">{t("colReturn")}</th>
              )}
              {hasProfit && (
                <th className="hidden py-2 text-end font-medium md:table-cell">
                  {t("colProfit")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((h, i) => (
              <tr
                key={`${h.symbol ?? h.name}-${i}`}
                className="border-b border-border/60 last:border-0"
              >
                <td className="py-2.5 pe-3">
                  <div className="flex flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="line-clamp-1">{h.name}</span>
                      {isMoneyMarketFund(h.name) && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {t("moneyMarketPill")}
                        </span>
                      )}
                    </span>
                    {h.symbol && h.symbol !== h.name && (
                      <span className="text-xs text-muted-foreground">{h.symbol}</span>
                    )}
                  </div>
                </td>
                <td className="hidden py-2.5 pe-3 text-end tabular-nums text-muted-foreground sm:table-cell">
                  {h.quantity != null ? formatNumber(h.quantity, locale) : "–"}
                </td>
                <td className="py-2.5 pe-3 text-end tabular-nums">
                  {formatCurrency(h.value, h.currency, locale)}
                </td>
                {hasReturn && (
                  <td
                    className={cn(
                      "py-2.5 pe-3 text-end tabular-nums",
                      signedPercentClass(h.changePct)
                    )}
                  >
                    <bdi dir="ltr">
                      {h.changePct != null
                        ? `${h.changePct > 0 ? "+" : h.changePct < 0 ? "−" : ""}${Math.abs(h.changePct).toFixed(1)}%`
                        : "–"}
                    </bdi>
                  </td>
                )}
                {hasProfit && (
                  <td
                    className={cn(
                      "hidden py-2.5 text-end tabular-nums md:table-cell",
                      signedPercentClass(h.profitLoss)
                    )}
                  >
                    <bdi dir="ltr">
                      {h.profitLoss != null
                        ? `${h.profitLoss < 0 ? "−" : h.profitLoss > 0 ? "+" : ""}${formatCurrency(h.profitLoss, "ILS", locale)}`
                        : "–"}
                    </bdi>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        {account.cashValue != null ? (
          <span className="tabular-nums">
            {t("cash", { amount: formatCurrency(account.cashValue, "ILS", locale) })}
          </span>
        ) : (
          <span />
        )}
        {holdings.length > COLLAPSED_HOLDINGS && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
          >
            {expanded
              ? t("showFewer")
              : t("showAll", { count: holdings.length })}
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            />
          </button>
        )}
      </div>
    </div>
  );
}

function SavingsStats({
  account,
  locale,
}: {
  account: InvestmentAccount;
  locale: Locale;
}) {
  const t = useTranslations("investments");
  const stats = [
    account.monthlyDeposit != null && {
      label: t("monthlyDeposit"),
      value: formatCurrency(account.monthlyDeposit, "ILS", locale),
      cls: "",
    },
    account.ytdReturnPct != null && {
      label: t("ytdReturn"),
      value: `${account.ytdReturnPct > 0 ? "+" : account.ytdReturnPct < 0 ? "−" : ""}${Math.abs(account.ytdReturnPct).toFixed(2)}%`,
      cls: signedPercentClass(account.ytdReturnPct),
    },
    account.mgmtFeeDepositPct != null && {
      label: t("feeOnDeposits"),
      value: `${account.mgmtFeeDepositPct.toFixed(2)}%`,
      cls: "",
    },
    account.mgmtFeeBalancePct != null && {
      label: t("feeOnBalance"),
      value: `${account.mgmtFeeBalancePct.toFixed(2)}%`,
      cls: "",
    },
  ].filter((s): s is { label: string; value: string; cls: string } => Boolean(s));

  if (stats.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-2xl bg-muted/40 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{s.label}</dt>
          <dd className={cn("mt-1 text-base font-medium tabular-nums", s.cls)}>
            <bdi dir="ltr">{s.value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
