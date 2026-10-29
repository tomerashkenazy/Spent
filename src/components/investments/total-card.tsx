"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CardShell } from "@/components/home/card-shell";
import { formatCurrency } from "@/lib/formatters";
import type { Locale } from "@/i18n/routing";
import type { InvestmentAccount, InvestmentHistoryPoint } from "@/lib/types";
import { ChangePill } from "./change-pill";

interface Props {
  accounts: InvestmentAccount[];
  /** null when the history query failed. */
  history: InvestmentHistoryPoint[] | null;
}

function formatDay(isoDay: string, locale: Locale): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(
    locale === "he" ? "he-IL" : "en-IL",
    { day: "numeric", month: "short", year: "numeric" }
  );
}

export function TotalCard({ accounts, history }: Props) {
  const t = useTranslations("investments");
  const locale = useLocale() as Locale;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const total = accounts.reduce((sum, a) => sum + a.totalValue, 0);
  // Accounts with a single snapshot count as unchanged, so a newly connected
  // account does not show up as a gain.
  const previous = accounts.reduce(
    (sum, a) => sum + (a.previousValue ?? a.totalValue),
    0
  );
  const change = total - previous;
  const changePct = previous > 0 ? (change / previous) * 100 : null;
  const hasChange = accounts.some((a) => a.previousValue != null);

  const points = history ?? [];
  const hovered = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <CardShell label={t("totalLabel")}>
      <div className="flex flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="flex flex-col">
            <span className="font-serif text-4xl leading-none tracking-tight tabular-nums md:text-5xl">
              {formatCurrency(hovered ? hovered.total : total)}
            </span>
            <span className="mt-2 text-sm text-muted-foreground">
              {hovered
                ? formatDay(hovered.date, locale)
                : t("acrossAccounts", { count: accounts.length })}
            </span>
          </div>
          {!hovered && hasChange && (
            <ChangePill
              amount={change}
              percent={changePct}
              title={t("sinceLastSync")}
            />
          )}
        </div>

        {history === null ? null : points.length < 2 ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl bg-muted/40 py-8 text-center text-sm text-muted-foreground">
            {t("historyBuilding")}
          </div>
        ) : (
          <LineChart
            points={points}
            hoverIdx={hoverIdx}
            onHover={setHoverIdx}
            locale={locale}
          />
        )}
      </div>
    </CardShell>
  );
}

function LineChart({
  points,
  hoverIdx,
  onHover,
  locale,
}: {
  points: InvestmentHistoryPoint[];
  hoverIdx: number | null;
  onHover: (i: number | null) => void;
  locale: Locale;
}) {
  const width = 600;
  const height = 140;
  const padY = 8;
  const values = points.map((p) => p.total);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Zoom into the range, but keep a floor so a flat line does not divide by 0.
  const span = Math.max(max - min, max * 0.01, 1);
  const lo = min - span * 0.15;
  const hi = max + span * 0.15;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => padY + (1 - (v - lo) / (hi - lo)) * (height - padY * 2);

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let ratio = (e.clientX - rect.left) / rect.width;
    // The SVG mirrors in RTL, so the pointer ratio has to as well.
    if (getComputedStyle(e.currentTarget).direction === "rtl") ratio = 1 - ratio;
    const idx = Math.round(ratio * (points.length - 1));
    onHover(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-36 w-full touch-none text-foreground rtl:-scale-x-100"
          onPointerMove={handleMove}
          onPointerLeave={() => onHover(null)}
          role="img"
          aria-label="Investment value over time"
        >
          <path d={area} fill="currentColor" opacity={0.06} />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {hoverIdx != null && (
            <line
              x1={x(hoverIdx)}
              x2={x(hoverIdx)}
              y1={0}
              y2={height}
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {hoverIdx != null && (
          // An HTML dot, since the stretched SVG would squash a circle.
          <span
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card ltr:-translate-x-1/2 rtl:translate-x-1/2"
            style={{
              insetInlineStart: `${(x(hoverIdx) / width) * 100}%`,
              top: `${(y(points[hoverIdx].total) / height) * 100}%`,
            }}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{formatDay(first.date, locale)}</span>
        <span>{formatDay(last.date, locale)}</span>
      </div>
    </div>
  );
}
