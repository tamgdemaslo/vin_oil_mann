import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  deleteLocalDemand,
  loadLocalDemandDetailPayload,
  updateLocalDemand,
} from "@/lib/local-demand-write";

type Meta = { href: string; type: string; mediaType: string };

type UpdateBody = {
  name?: string;
  description?: string;
  applicable?: boolean;
  attributes?: unknown[];
  positions?: {
    id?: string;
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

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const loaded = await loadLocalDemandDetailPayload(id);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.notFound ? 404 : 400 });
  }

  return NextResponse.json(loaded.data);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: UpdateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const updated = await updateLocalDemand(id, body);
  if (!updated.ok) {
    return NextResponse.json({ error: updated.error }, { status: updated.notFound ? 404 : 400 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const deleted = await deleteLocalDemand(id);
  if (!deleted.ok) {
    return NextResponse.json({ error: deleted.error }, { status: deleted.notFound ? 404 : 400 });
  }

  return NextResponse.json({ ok: true });
}
