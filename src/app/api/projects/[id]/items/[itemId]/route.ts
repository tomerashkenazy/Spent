import { NextResponse } from "next/server";
import { deleteProjectItem, updateProjectItem } from "@/server/db/queries/projects";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import {
  parseId,
  parseProjectItemInput,
  readJsonBody,
} from "@/server/lib/project-validation";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const p = await params;
  const id = parseId(p.id);
  const itemId = parseId(p.itemId);
  if (id == null || itemId == null) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const parsed = parseProjectItemInput(await readJsonBody(request));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const item = updateProjectItem(workspaceId, id, itemId, parsed.value);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(item);
}

export async function DELETE(request: Request, { params }: Ctx) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const p = await params;
  const id = parseId(p.id);
  const itemId = parseId(p.itemId);
  if (id == null || itemId == null) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (!deleteProjectItem(workspaceId, id, itemId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
