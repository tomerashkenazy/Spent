"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { getInvestments } from "@/lib/api";
import { PageHeader } from "@/components/layout/app-shell";
import { SyncButton } from "@/components/dashboard/sync-button";
import { CardError, CardSkeleton } from "@/components/home/card-shell";
import { TotalCard } from "./total-card";
import { AllocationCard } from "./allocation-card";
import { AccountCard } from "./account-card";
import { EmptyState } from "./empty-state";

const ROW_1 = "col-span-12 xl:col-span-8";
const ROW_1_SIDE = "col-span-12 xl:col-span-4";

export function InvestmentsPage() {
  const t = useTranslations("investments");
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

  const accountsFailed =
    isError || data?.errors.some((e) => e.section === "accounts");
  const historyFailed =
    isError || data?.errors.some((e) => e.section === "history");
  const accounts = data?.accounts ?? [];

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        actions={<SyncButton onComplete={handleSyncComplete} />}
      />
      <div className="p-4 md:p-6 lg:p-8">
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
            <>
              <div className={ROW_1}>
                <TotalCard
                  accounts={accounts}
                  history={historyFailed ? null : (data.history ?? [])}
                />
              </div>
              <div className={ROW_1_SIDE}>
                <AllocationCard accounts={accounts} />
              </div>
              {accounts.map((account) => (
                <div key={account.id} className="col-span-12">
                  <AccountCard account={account} />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
