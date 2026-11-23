import { NextResponse } from "next/server";
import {
  addManualProjectItem,
  addTransactionToProject,
  getProject,
  listProjectItems,
} from "@/server/db/queries/projects";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import {
  parseId,
  parseProjectItemInput,
  readJsonBody,
} from "@/server/lib/project-validation";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  if (!getProject(workspaceId, id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(listProjectItems(workspaceId, id));
}

/** Body: `{ transactionId }` to link a synced transaction, or a manual row. */
export async function POST(request: Request, { params }: Ctx) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const body = await readJsonBody(request);

  if (body.transactionId !== undefined) {
    const txId =
      typeof body.transactionId === "number" ? parseId(String(body.transactionId)) : null;
    if (txId == null) {
      return NextResponse.json({ error: "invalid transactionId" }, { status: 400 });
    }
    const result = addTransactionToProject(workspaceId, id, txId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason },
        { status: result.reason === "duplicate" ? 409 : 404 }
      );
    }
    return NextResponse.json(result.item, { status: 201 });
  }

  const parsed = parseProjectItemInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { date, description, amount } = parsed.value;
  if (!date || !description || amount === undefined) {
    return NextResponse.json(
      { error: "date, description and amount are required" },
      { status: 400 }
    );
  }
  const item = addManualProjectItem(workspaceId, id, {
    ...parsed.value,
    date,
    description,
    amount,
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(item, { status: 201 });
}
