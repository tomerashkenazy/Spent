"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { getInvestments } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import { moneyMarketByAccount } from "@/lib/investments";
import {
  investmentGroup,
  type InvestmentAccount,
  type InvestmentGroup,
  type InvestmentHistoryPoint,
} from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { PageHeader } from "@/components/layout/app-shell";
import { SyncButton } from "@/components/dashboard/sync-button";
import { CardError, CardSkeleton } from "@/components/home/card-shell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TotalCard } from "./total-card";
import { AllocationCard } from "./allocation-card";
import { AccountCard } from "./account-card";
import { MoneyMarketCard } from "./money-market-card";
import { EmptyState } from "./empty-state";

const ROW_1 = "col-span-12 xl:col-span-8";
const ROW_1_SIDE = "col-span-12 xl:col-span-4";
const GROUPS: InvestmentGroup[] = ["investments", "savings"];

function parseGroup(value: string | null): InvestmentGroup {
  return value === "savings" ? "savings" : "investments";
}

export function InvestmentsPage() {
  const t = useTranslations("investments");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const searchParams = useSearchParams();
  const group = parseGroup(searchParams.get("tab"));
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["investments"],
    queryFn: getInvestments,
  });

  const handleSyncComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["investments"] });
    queryClient.invalidateQueries({ queryKey: ["home"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
  }, [queryClient]);

  const handleTabChange = (value: unknown) => {
    const next = parseGroup(typeof value === "string" ? value : null);
    router.replace(next === "investments" ? "/investments" : "/investments?tab=savings", {
      scroll: false,
    });
  };

  const accountsFailed =
    isError || data?.errors.some((e) => e.section === "accounts");
  const historyFailed =
    isError || data?.errors.some((e) => e.section === "history");
  const accounts = data?.accounts ?? [];
  const byGroup: Record<InvestmentGroup, InvestmentAccount[]> = {
    investments: accounts.filter((a) => investmentGroup(a.kind) === "investments"),
    savings: accounts.filter((a) => investmentGroup(a.kind) === "savings"),
  };
  const groupTotal = (g: InvestmentGroup) =>
    byGroup[g].reduce((s, a) => s + a.totalValue, 0);
  const ready = !isLoading && !!data && !accountsFailed && accounts.length > 0;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        actions={<SyncButton onComplete={handleSyncComplete} />}
      />
      <div className="flex flex-col gap-5 p-4 md:p-6 lg:p-8">
        {ready && (
          <Tabs value={group} onValueChange={handleTabChange}>
            <TabsList variant="line" className="h-auto! gap-6 border-b border-border pb-1">
              {GROUPS.map((g) => (
                <TabsTrigger
                  key={g}
                  value={g}
                  className="flex-none gap-2 px-0 pb-2 text-base"
                >
                  <span>{t(`groups.${g}`)}</span>
                  <span className="text-sm font-normal tabular-nums text-muted-foreground">
                    {formatCurrency(groupTotal(g), "ILS", locale)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        <div className="grid grid-cols-12 gap-4 md:gap-5 lg:gap-6">
          {isLoading || !data ? (
            <>
              <div className={ROW_1}>
                <CardSkeleton label={t("totalLabel")} height={220} />
              </div>
              <div className={ROW_1_SIDE}>
                <CardSkeleton label={t("allocationLabel")} height={220} />
              </div>
              <div className="col-span-12">
                <CardSkeleton label={t("accountsLabel")} height={160} />
              </div>
            </>
          ) : accountsFailed ? (
            <div className="col-span-12">
              <CardError label={t("accountsLabel")} />
            </div>
          ) : accounts.length === 0 ? (
            <div className="col-span-12">
              <EmptyState />
            </div>
          ) : (
            <GroupView
              group={group}
              accounts={byGroup[group]}
              history={historyFailed ? null : (data.history ?? [])}
              total={groupTotal(group)}
            />
          )}
        </div>
      </div>
    </>
  );
}

function GroupView({
  group,
  accounts,
  history,
  total,
}: {
  group: InvestmentGroup;
  accounts: InvestmentAccount[];
  history: InvestmentHistoryPoint[] | null;
  total: number;
}) {
  const t = useTranslations("investments");
  if (accounts.length === 0) {
    return (
      <div className="col-span-12 rounded-3xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        {t(`groupEmpty.${group}`)}
      </div>
    );
  }
  const hasMoneyMarket =
    group === "investments" && moneyMarketByAccount(accounts).total > 0;
  const side =
    group === "investments" ? (
      hasMoneyMarket ? (
        <MoneyMarketCard accounts={accounts} groupTotal={total} />
      ) : null
    ) : (
      <AllocationCard accounts={accounts} />
    );

  return (
    <>
      <div className={side ? ROW_1 : "col-span-12"}>
        <TotalCard
          accounts={accounts}
          history={history}
          group={group}
          label={t(`groupTotals.${group}`)}
        />
      </div>
      {side && <div className={ROW_1_SIDE}>{side}</div>}
      {accounts.map((account) => (
        <div key={account.id} className="col-span-12">
          <AccountCard account={account} />
        </div>
      ))}
    </>
  );
}
