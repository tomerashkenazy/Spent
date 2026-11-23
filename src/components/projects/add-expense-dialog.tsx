"use client";

import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Check, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTransactions } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { toLocalISODateClient } from "./project-utils";
import { PaidFromSelect, type PaidFromValue } from "./paid-from-select";
import type { Locale } from "@/i18n/routing";
import type { Integration, ProjectItemInput } from "@/lib/types";

type Mode = "transactions" | "manual";

export function AddExpenseDialog({
  open,
  onOpenChange,
  projectId,
  linkedTransactionIds,
  integrations,
  categorySuggestions,
  onAddTransaction,
  onAddManual,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  linkedTransactionIds: Set<number>;
  integrations: Integration[];
  categorySuggestions: string[];
  onAddTransaction: (transactionId: number) => Promise<void>;
  onAddManual: (
    input: ProjectItemInput & { date: string; description: string; amount: number }
  ) => Promise<void>;
}) {
  const t = useTranslations("projects");
  const [mode, setMode] = useState<Mode>("transactions");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("addExpenseTitle")}</DialogTitle>
          <DialogDescription>{t("addExpenseDescription")}</DialogDescription>
        </DialogHeader>
        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v === "manual" ? "manual" : "transactions")}
        >
          <TabsList>
            <TabsTrigger value="transactions">{t("fromTransactions")}</TabsTrigger>
            <TabsTrigger value="manual">{t("manualEntry")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {open &&
          (mode === "transactions" ? (
            <TransactionPicker
              key={projectId}
              linkedTransactionIds={linkedTransactionIds}
              onAdd={onAddTransaction}
            />
          ) : (
            <ManualForm
              integrations={integrations}
              categorySuggestions={categorySuggestions}
              onSubmit={async (input) => {
                await onAddManual(input);
                onOpenChange(false);
              }}
            />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function TransactionPicker({
  linkedTransactionIds,
  onAdd,
}: {
  linkedTransactionIds: Set<number>;
  onAdd: (transactionId: number) => Promise<void>;
}) {
  const t = useTranslations("projects");
  const locale = useLocale() as Locale;
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search.trim());
  const [busyId, setBusyId] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ["transactions", "project-picker", deferred],
    queryFn: () =>
      getTransactions({
        search: deferred || undefined,
        kind: "expense",
        sort: "date",
        order: "desc",
        limit: 30,
      }),
  });
  const rows = query.data?.transactions ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="ps-9"
          dir="auto"
          autoFocus
        />
      </div>
      <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border">
        {query.isLoading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("noTransactionsFound")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((txn) => {
              const linked = linkedTransactionIds.has(txn.id);
              return (
                <li key={txn.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{txn.description}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {formatDate(txn.date)}
                      {txn.accountLabel ? ` · ${txn.accountLabel}` : ""}
                      {txn.projectName && !linked ? ` · ${txn.projectName}` : ""}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">
                    {formatCurrency(txn.chargedAmount, "ILS", locale)}
                  </span>
                  <Button
                    size="icon-sm"
                    variant={linked ? "ghost" : "outline"}
                    disabled={linked || busyId === txn.id}
                    aria-label={linked ? t("alreadyAdded") : t("addAction")}
                    title={linked ? t("alreadyAdded") : t("addAction")}
                    onClick={async () => {
                      setBusyId(txn.id);
                      try {
                        await onAdd(txn.id);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Failed");
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    {linked ? <Check /> : <Plus />}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ManualForm({
  integrations,
  categorySuggestions,
  onSubmit,
}: {
  integrations: Integration[];
  categorySuggestions: string[];
  onSubmit: (
    input: ProjectItemInput & { date: string; description: string; amount: number }
  ) => Promise<void>;
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [date, setDate] = useState(() => toLocalISODateClient(new Date()));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [paidFrom, setPaidFrom] = useState<PaidFromValue>({
    credentialId: null,
    text: null,
  });
  const [busy, setBusy] = useState(false);

  const amountNumber = Number(amount);
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    description.trim().length > 0 &&
    amount.trim() !== "" &&
    Number.isFinite(amountNumber);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        try {
          await onSubmit({
            date,
            description: description.trim(),
            amount: amountNumber,
            category: category.trim() || null,
            paidFromCredentialId: paidFrom.credentialId,
            paidFromText: paidFrom.text,
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="item-description">{t("colDescription")}</Label>
          <Input
            id="item-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            autoFocus
            dir="auto"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="item-amount">{t("colAmount")}</Label>
          <Input
            id="item-amount"
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="item-date">{t("colDate")}</Label>
          <Input
            id="item-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("colPaidFrom")}</Label>
          <PaidFromSelect
            value={paidFrom}
            integrations={integrations}
            onChange={setPaidFrom}
            className="w-full"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="item-category">{t("colCategory")}</Label>
          <Input
            id="item-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="project-category-suggestions-manual"
            dir="auto"
            placeholder={t("categoryPlaceholder")}
          />
          <datalist id="project-category-suggestions-manual">
            {categorySuggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={!valid || busy}>
          {tCommon("add")}
        </Button>
      </div>
    </form>
  );
}
