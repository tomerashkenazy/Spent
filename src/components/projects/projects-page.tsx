"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { FolderKanban, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { CardShell, CardSkeleton } from "@/components/home/card-shell";
import { Button } from "@/components/ui/button";
import {
  addManualProjectItem,
  addTransactionToProject,
  createProject,
  deleteProject,
  deleteProjectItem,
  getInvestments,
  listIntegrations,
  listProjectItems,
  listProjects,
  updateProject,
  updateProjectItem,
} from "@/lib/api";
import { moneyMarketByAccount } from "@/lib/investments";
import { cn } from "@/lib/utils";
import type { ProjectItem, ProjectItemInput } from "@/lib/types";
import { ProjectDialog, type ProjectFormValues } from "./project-dialog";
import { AddExpenseDialog } from "./add-expense-dialog";
import { ProjectItemsTable } from "./project-items-table";
import { ProjectSummary } from "./project-summary";

export function ProjectsPage() {
  const t = useTranslations("projects");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: listIntegrations,
  });
  const investmentsQuery = useQuery({
    queryKey: ["investments"],
    queryFn: getInvestments,
  });

  const projects = projectsQuery.data ?? [];
  const requestedId = Number(searchParams.get("id"));
  const project = projects.find((p) => p.id === requestedId) ?? projects[0] ?? null;

  const itemsQuery = useQuery({
    queryKey: ["project-items", project?.id],
    queryFn: () => listProjectItems(project!.id),
    enabled: project != null,
  });
  const items = itemsQuery.data ?? [];
  const integrations = integrationsQuery.data ?? [];

  const moneyMarket = investmentsQuery.data?.accounts
    ? moneyMarketByAccount(investmentsQuery.data.accounts).total
    : null;

  const categorySuggestions = [
    ...new Set(items.map((i) => i.category).filter((c): c is string => !!c)),
  ].sort((a, b) => a.localeCompare(b));

  const selectProject = (id: number) => {
    router.replace(`/projects?id=${id}`, { scroll: false });
  };

  // Spending totals elsewhere depend on which transactions belong to a project.
  const invalidateAll = (projectId?: number) => {
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    if (projectId != null) {
      queryClient.invalidateQueries({ queryKey: ["project-items", projectId] });
    }
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
    queryClient.invalidateQueries({ queryKey: ["home"] });
  };

  const handleCreate = async (values: ProjectFormValues) => {
    try {
      const created = await createProject(values);
      invalidateAll();
      setCreateOpen(false);
      selectProject(created.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleEdit = async (values: ProjectFormValues) => {
    if (!project) return;
    try {
      await updateProject(project.id, values);
      invalidateAll(project.id);
      setEditOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleDeleteProject = async () => {
    if (!project) return;
    try {
      await deleteProject(project.id);
      invalidateAll();
      setEditOpen(false);
      router.replace("/projects", { scroll: false });
      toast.success(t("deletedToast", { name: project.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleUpdateItem = async (item: ProjectItem, input: ProjectItemInput) => {
    // Optimistic: edits are frequent and small, so update the row at once.
    const key = ["project-items", item.projectId];
    const previous = queryClient.getQueryData<ProjectItem[]>(key);
    queryClient.setQueryData<ProjectItem[]>(key, (rows) =>
      rows?.map((r) => (r.id === item.id ? { ...r, ...input } : r))
    );
    try {
      await updateProjectItem(item.projectId, item.id, input);
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (err) {
      queryClient.setQueryData(key, previous);
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleDeleteItem = async (item: ProjectItem) => {
    try {
      await deleteProjectItem(item.projectId, item.id);
      invalidateAll(item.projectId);
      toast.success(t("removedToast"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const header = (
    <PageHeader
      title={t("pageTitle")}
      actions={
        project ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            {t("addExpense")}
          </Button>
        ) : null
      }
    />
  );

  if (projectsQuery.isLoading) {
    return (
      <>
        {header}
        <div className="p-4 md:p-6 lg:p-8">
          <CardSkeleton height={240} />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-5 p-4 md:p-6 lg:p-8">
        {project == null ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProject(p.id)}
                  aria-pressed={p.id === project.id}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                    p.id === project.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("newProject")}
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="ms-auto text-muted-foreground"
                onClick={() => setEditOpen(true)}
              >
                <Settings2 />
                {t("projectSettings")}
              </Button>
            </div>

            <div className="grid grid-cols-12 gap-4 md:gap-5">
              <ProjectSummary
                project={project}
                items={items}
                moneyMarketTotal={moneyMarket && moneyMarket > 0 ? moneyMarket : null}
              />
            </div>

            <CardShell label={t("expensesLabel")}>
              {itemsQuery.isLoading ? (
                <div className="h-32" />
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="max-w-md text-sm text-muted-foreground">
                    {t("noItems")}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                    <Plus />
                    {t("addExpense")}
                  </Button>
                </div>
              ) : (
                <ProjectItemsTable
                  items={items}
                  integrations={integrations}
                  categorySuggestions={categorySuggestions}
                  onUpdate={handleUpdateItem}
                  onDelete={handleDeleteItem}
                />
              )}
            </CardShell>
          </>
        )}
      </div>

      <ProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
      />
      {project && (
        <>
          <ProjectDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            project={project}
            onSubmit={handleEdit}
            onDelete={handleDeleteProject}
          />
          <AddExpenseDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            projectId={project.id}
            linkedTransactionIds={
              new Set(
                items
                  .map((i) => i.transactionId)
                  .filter((id): id is number => id != null)
              )
            }
            integrations={integrations}
            categorySuggestions={categorySuggestions}
            onAddTransaction={async (transactionId) => {
              await addTransactionToProject(project.id, transactionId);
              invalidateAll(project.id);
            }}
            onAddManual={async (input) => {
              await addManualProjectItem(project.id, input);
              invalidateAll(project.id);
            }}
          />
        </>
      )}
    </>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations("projects");
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
        <FolderKanban className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="flex max-w-md flex-col gap-1.5">
        <h2 className="font-serif text-2xl tracking-tight">{t("emptyTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
      </div>
      <Button onClick={onCreate}>
        <Plus />
        {t("createAction")}
      </Button>
    </div>
  );
}
