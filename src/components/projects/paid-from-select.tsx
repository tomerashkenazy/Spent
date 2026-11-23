"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Integration } from "@/lib/types";
import { payingAccounts } from "./project-utils";

export interface PaidFromValue {
  credentialId: number | null;
  text: string | null;
}

const NONE = "none";
const OTHER = "other";

/**
 * Who paid: one of the connected accounts, or free text for money that
 * never passed through one (cash, a gift, a money market fund redemption).
 */
export function PaidFromSelect({
  value,
  integrations,
  onChange,
  className,
  size = "default",
}: {
  value: PaidFromValue;
  integrations: Integration[];
  onChange: (value: PaidFromValue) => void;
  className?: string;
  size?: "sm" | "default";
}) {
  const t = useTranslations("projects");
  const accounts = payingAccounts(integrations);
  const [otherMode, setOtherMode] = useState(
    value.credentialId == null && value.text != null
  );
  const [draft, setDraft] = useState(value.text ?? "");

  const selected =
    value.credentialId != null
      ? `cred:${value.credentialId}`
      : otherMode
        ? OTHER
        : NONE;

  const labelFor = (v: string) => {
    if (v === NONE) return t("paidFromNone");
    if (v === OTHER) return t("paidFromOther");
    const id = Number(v.slice(5));
    return accounts.find((a) => a.id === id)?.label ?? t("paidFromNone");
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Select
        value={selected}
        onValueChange={(v) => {
          if (!v) return;
          if (v === OTHER) {
            setOtherMode(true);
            onChange({ credentialId: null, text: draft.trim() || null });
          } else if (v === NONE) {
            setOtherMode(false);
            onChange({ credentialId: null, text: null });
          } else {
            setOtherMode(false);
            onChange({ credentialId: Number(v.slice(5)), text: null });
          }
        }}
      >
        <SelectTrigger size={size} className="w-full min-w-0">
          <SelectValue>{(v: string) => labelFor(v)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("paidFromNone")}</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={`cred:${a.id}`}>
              {a.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={OTHER}>{t("paidFromOther")}</SelectItem>
        </SelectContent>
      </Select>
      {selected === OTHER && (
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const next = draft.trim() || null;
            if (next !== value.text) onChange({ credentialId: null, text: next });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder={t("paidFromOtherPlaceholder")}
          dir="auto"
          className={size === "sm" ? "h-7 text-xs" : undefined}
        />
      )}
    </div>
  );
}
