import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/server/db/queries/projects";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { parseProjectInput, readJsonBody } from "@/server/lib/project-validation";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return NextResponse.json(listProjects(workspaceId));
}

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const parsed = parseProjectInput(await readJsonBody(request));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (!parsed.value.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const project = createProject(workspaceId, {
    name: parsed.value.name,
    budgetAmount: parsed.value.budgetAmount ?? null,
    excludesFromSpending: parsed.value.excludesFromSpending ?? true,
  });
  return NextResponse.json(project, { status: 201 });
}
