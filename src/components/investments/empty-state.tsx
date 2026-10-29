"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { TrendingUp } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CardShell } from "@/components/home/card-shell";

export function EmptyState() {
  const t = useTranslations("investments");
  return (
    <CardShell>
      <div className="flex flex-col items-center gap-4 px-4 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <TrendingUp className="h-5 w-5 text-muted-foreground" />
        </span>
        <div className="flex max-w-md flex-col gap-2">
          <h2 className="font-serif text-2xl">{t("emptyTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
        </div>
        <Link
          href="/settings/bank"
          className={buttonVariants({ variant: "outline" })}
        >
          {t("emptyAction")}
        </Link>
      </div>
    </CardShell>
  );
}
