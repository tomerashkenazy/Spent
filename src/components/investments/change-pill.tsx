"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";

/** Gain or loss, with an arrow and sign so it never relies on color alone. */
export function ChangePill({
  amount,
  percent,
  title,
}: {
  amount: number;
  percent: number | null;
  title?: string;
}) {
  const rounded = Math.round(amount * 100) / 100;
  const isFlat = rounded === 0;
  const isUp = rounded > 0;
  const Icon = isUp ? ArrowUp : ArrowDown;
  const cls = isFlat
    ? "text-muted-foreground bg-muted/60"
    : isUp
      ? "text-[var(--status-on-track)] bg-[var(--status-on-track)]/10"
      : "text-[var(--status-over)] bg-[var(--status-over)]/10";
  const sign = isFlat ? "" : isUp ? "+" : "−";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${cls}`}
      title={title}
    >
      {!isFlat && <Icon className="h-3 w-3" />}
      {/* Keeps the sign in front of the number in Hebrew. */}
      <bdi dir="ltr">
        {sign}
        {formatCurrency(rounded)}
        {percent != null && !isFlat && (
          <span className="opacity-80">
            {" "}
            ({sign}
            {Math.abs(percent).toFixed(1)}%)
          </span>
        )}
      </bdi>
    </span>
  );
}

export function signedPercentClass(value: number | null): string {
  if (value == null || value === 0) return "text-muted-foreground";
  return value > 0
    ? "text-[var(--status-on-track)]"
    : "text-[var(--status-over)]";
}
