"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link2, MoreHorizontal, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  PROJECT_ITEM_STATUSES,
  type Integration,
  type ProjectItem,
  type ProjectItemInput,
  type ProjectItemStatus,
} from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { PaidFromSelect } from "./paid-from-select";

const STATUS_DOT: Record<ProjectItemStatus, string> = {
  paid: "var(--status-on-track, #16a34a)",
  deposit: "var(--status-heads-up, #d97706)",
  unpaid: "var(--muted-foreground)",
};

/** A borderless input that saves on blur or Enter and reverts on Escape. */
function InlineInput({
  value,
  onSave,
  placeholder,
  type = "text",
  list,
  className,
  ariaLabel,
  display,
  inputMode,
}: {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  type?: "text" | "date";
  list?: string;
  className?: string;
  ariaLabel: string;
  /** Shown instead of the raw value while not editing (e.g. "₪1,200.00"). */
  display?: string;
  inputMode?: "decimal";
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  // Pick up server changes (e.g. after a refetch) when not editing.
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <input
      type={type}
      value={!focused && display !== undefined ? display : draft}
      list={list}
      inputMode={inputMode}
      dir={type === "text" && !inputMode ? "auto" : undefined}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onSave(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-border focus:border-ring focus:bg-background",
        className
      )}
    />
  );
}

export function ProjectItemsTable({
  items,
  integrations,
  categorySuggestions,
  onUpdate,
  onDelete,
}: {
  items: ProjectItem[];
  integrations: Integration[];
  categorySuggestions: string[];
  onUpdate: (item: ProjectItem, input: ProjectItemInput) => void;
  onDelete: (item: ProjectItem) => void;
}) {
  const t = useTranslations("projects");
  const locale = useLocale() as Locale;
  const total = items.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="overflow-x-auto">
      <datalist id="project-category-suggestions">
        {categorySuggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableRow className="text-[11px] uppercase tracking-[0.06em]">
            <TableHead className="w-[120px]">{t("colDate")}</TableHead>
            <TableHead>{t("colDescription")}</TableHead>
            <TableHead className="w-[130px] text-end">{t("colAmount")}</TableHead>
            <TableHead className="w-[180px]">{t("colPaidFrom")}</TableHead>
            <TableHead className="w-[160px]">{t("colCategory")}</TableHead>
            <TableHead className="w-[130px]">{t("colStatus")}</TableHead>
            <TableHead className="w-[200px]">{t("colNotes")}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const manual = item.transactionId == null;
            return (
              <TableRow key={item.id} className="align-middle">
                <TableCell className="tabular-nums text-muted-foreground">
                  {manual ? (
                    <InlineInput
                      type="date"
                      value={item.date}
                      ariaLabel={t("colDate")}
                      onSave={(v) => v && onUpdate(item, { date: v })}
                    />
                  ) : (
                    <span className="px-2">{formatDate(item.date)}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-1.5">
                    {manual ? (
                      <InlineInput
                        value={item.description}
                        ariaLabel={t("colDescription")}
                        className="font-medium"
                        onSave={(v) => v.trim() && onUpdate(item, { description: v })}
                      />
                    ) : (
                      <>
                        <span className="truncate px-2 font-medium">{item.description}</span>
                        <Link2
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          aria-label={t("linkedTransaction")}
                        >
                          <title>{t("linkedTransaction")}</title>
                        </Link2>
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-end font-medium tabular-nums">
                  {manual ? (
                    <InlineInput
                      inputMode="decimal"
                      value={String(item.amount)}
                      display={`${item.amount < 0 ? "−" : ""}${formatCurrency(item.amount, "ILS", locale)}`}
                      ariaLabel={t("colAmount")}
                      className="text-end tabular-nums"
                      onSave={(v) => {
                        const n = Number(v.replace(/[,₪\s]/g, ""));
                        if (v.trim() !== "" && Number.isFinite(n)) onUpdate(item, { amount: n });
                      }}
                    />
                  ) : (
                    <span className="px-2">
                      {item.amount < 0 ? "−" : ""}
                      {formatCurrency(item.amount, "ILS", locale)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <PaidFromSelect
                    size="sm"
                    value={{
                      credentialId: item.paidFromCredentialId,
                      text: item.paidFromText,
                    }}
                    integrations={integrations}
                    onChange={(v) =>
                      onUpdate(item, {
                        paidFromCredentialId: v.credentialId,
                        paidFromText: v.text,
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <InlineInput
                    value={item.category ?? ""}
                    list="project-category-suggestions"
                    ariaLabel={t("colCategory")}
                    placeholder={t("categoryPlaceholder")}
                    onSave={(v) => onUpdate(item, { category: v.trim() || null })}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={item.status}
                    onValueChange={(v) => {
                      if (v && v !== item.status) {
                        onUpdate(item, { status: v as ProjectItemStatus });
                      }
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue>
                        {(v: ProjectItemStatus) => (
                          <span className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: STATUS_DOT[v] }}
                              aria-hidden
                            />
                            {t(`status.${v}`)}
                          </span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_ITEM_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`status.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <InlineInput
                    value={item.notes ?? ""}
                    ariaLabel={t("colNotes")}
                    placeholder={t("notesPlaceholder")}
                    onSave={(v) => onUpdate(item, { notes: v.trim() || null })}
                  />
                </TableCell>
                <TableCell className="text-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={t("rowActions")}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDelete(item)}
                      >
                        <Trash2 className="me-2 h-3.5 w-3.5" />
                        {t("removeRow")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={2} className="font-medium">
              {t("totalRow", { count: items.length })}
            </TableCell>
            <TableCell className="text-end font-semibold tabular-nums">
              <span className="px-2">{formatCurrency(total, "ILS", locale)}</span>
            </TableCell>
            <TableCell colSpan={5} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
