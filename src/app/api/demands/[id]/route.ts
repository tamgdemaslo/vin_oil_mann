import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  deleteLocalDemand,
  loadLocalDemandDetailPayload,
  updateLocalDemand,
} from "@/lib/local-demand-write";
import { requireBranchApi } from "@/lib/branch-api";

type Meta = { href: string; type: string; mediaType: string };

type UpdateBody = {
  organization?: { meta: Meta };
  agent?: { meta: Meta };
  store?: { meta: Meta };
  name?: string;
  description?: string;
  moment?: string;
  applicable?: boolean;
  attributes?: unknown[];
  positions?: {
    id?: string;
    name?: string;
    comment?: string;
    quantity: number;
    price: number;
    discount?: number;
    assortment?: { meta: Meta };
  }[];
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const loaded = await loadLocalDemandDetailPayload(id, branchAccess.context.branchId!);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.notFound ? 404 : 400 });
  }

  return NextResponse.json(loaded.data);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: UpdateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  try {
    const updated = await updateLocalDemand(id, body, session.user, branchAccess.context.branchId!, branchAccess.context.organizationId!);
    if (!updated.ok) {
      return NextResponse.json({ error: updated.error }, { status: updated.notFound ? 404 : 400 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[api/demands/:id] update failed", error);
    return NextResponse.json(
      { error: error instanceof Error && error.message.trim() ? error.message : "Не удалось сохранить отгрузку" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const deleted = await deleteLocalDemand(id, branchAccess.context.branchId!);
  if (!deleted.ok) {
    return NextResponse.json({ error: deleted.error }, { status: deleted.notFound ? 404 : 400 });
  }

  return NextResponse.json({ ok: true });
}
