"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Project } from "@/lib/types";

export interface ProjectFormValues {
  name: string;
  budgetAmount: number | null;
  excludesFromSpending: boolean;
}

/** Create a project, or edit one when `project` is given. */
export function ProjectDialog({
  open,
  onOpenChange,
  project,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSubmit: (values: ProjectFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Remount the form each time the dialog opens so it starts fresh. */}
        {open && (
          <ProjectForm
            project={project}
            onSubmit={onSubmit}
            onDelete={onDelete}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  project,
  onSubmit,
  onDelete,
  onCancel,
}: {
  project?: Project;
  onSubmit: (values: ProjectFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [name, setName] = useState(project?.name ?? "");
  const [budget, setBudget] = useState(
    project?.budgetAmount != null ? String(project.budgetAmount) : ""
  );
  const [excludes, setExcludes] = useState(project?.excludesFromSpending ?? true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const budgetNumber = budget.trim() === "" ? null : Number(budget);
  const valid =
    name.trim().length > 0 &&
    (budgetNumber === null || (Number.isFinite(budgetNumber) && budgetNumber >= 0));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        budgetAmount: budgetNumber,
        excludesFromSpending: excludes,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{project ? t("editTitle") : t("createTitle")}</DialogTitle>
        <DialogDescription>{t("createDescription")}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor="project-name">{t("nameLabel")}</Label>
        <Input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          autoFocus
          dir="auto"
          maxLength={128}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="project-budget">{t("budgetLabel")}</Label>
        <Input
          id="project-budget"
          type="number"
          inputMode="decimal"
          min={0}
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder={t("budgetPlaceholder")}
        />
      </div>
      <label className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{t("excludeLabel")}</span>
          <span className="text-xs text-muted-foreground">{t("excludeHint")}</span>
        </span>
        <Switch checked={excludes} onCheckedChange={setExcludes} />
      </label>
      <DialogFooter className="gap-2 sm:justify-between">
        {project && onDelete ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setBusy(true);
              try {
                await onDelete();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmDelete ? t("confirmDelete") : tCommon("delete")}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            {project ? tCommon("save") : t("createAction")}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
