import { NextResponse } from "next/server";
import { deleteProject, updateProject } from "@/server/db/queries/projects";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import {
  parseId,
  parseProjectInput,
  readJsonBody,
} from "@/server/lib/project-validation";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const parsed = parseProjectInput(await readJsonBody(request));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const project = updateProject(workspaceId, id, parsed.value);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function DELETE(request: Request, { params }: Ctx) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  if (!deleteProject(workspaceId, id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
