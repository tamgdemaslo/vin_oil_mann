import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { MOYSKLAD_BASE, getMoySkladHeaders, moyskladFetch } from "@/lib/moysklad";
import { loadDemandDetailPayload } from "@/lib/demand-detail-load";

type Meta = { href: string; type: string; mediaType: string };

type DemandPositionRow = {
  id: string;
  quantity: number;
  price: number;
  assortment?: { name?: string; meta?: Meta };
  slot?: { name?: string; meta?: Meta };
  discount?: number;
  stock?: {
    cost?: number;
    quantity?: number;
    reserve?: number;
    intransit?: number;
    available?: number;
  };
} & Record<string, unknown>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const loaded = await loadDemandDetailPayload(id);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 502 });

  return NextResponse.json(loaded.data);
}

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

  const payload: Record<string, unknown> = {};
  if (typeof body.name === "string") payload.name = body.name.trim();
  if (typeof body.description === "string") payload.description = body.description.trim();
  if (typeof body.applicable === "boolean") payload.applicable = body.applicable;
  if (Array.isArray(body.attributes)) payload.attributes = body.attributes;

  if (Array.isArray(body.positions)) {
    const current = await moyskladFetch<{ rows: DemandPositionRow[] }>(
      `/entity/demand/${id}/positions`,
      { cache: "no-store" }
    );
    if (!current.ok) {
      return NextResponse.json({ error: current.error }, { status: 502 });
    }

    const currentById = new Map<string, DemandPositionRow>();
    for (const row of current.data.rows ?? []) {
      currentById.set(row.id, row);
    }

    const nextPositions: DemandPositionRow[] = [];

    for (const p of body.positions) {
      const quantity = Number(p.quantity) || 0;
      const price = Number(p.price) || 0;
      const discount =
        typeof p.discount === "number" ? p.discount : undefined;

      if (p.id && currentById.has(p.id)) {
        const base = currentById.get(p.id)!;
        nextPositions.push({
          ...base,
          quantity,
          price,
          ...(typeof discount === "number" ? { discount } : null),
        });
      } else if (!p.id && p.assortment?.meta) {
        // Новая позиция
        nextPositions.push({
          id: "" as string, // будет проигнорирован МойСклад при создании
          quantity,
          price,
          assortment: { meta: p.assortment.meta } as any,
          ...(typeof discount === "number" ? { discount } : null),
        } as DemandPositionRow);
      }
    }

    payload.positions = nextPositions;
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 });
  }

  type DemandPut = {
    id: string;
    name: string;
    moment: string;
    applicable: boolean;
    description?: string;
    sum: number;
    meta: Meta;
  };

  const result = await moyskladFetch<DemandPut>(
    `/entity/demand/${id}`,
    { method: "PUT", body: JSON.stringify(payload), cache: "no-store" }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json({
    id: result.data.id,
    name: result.data.name,
    applicable: result.data.applicable,
    description: result.data.description ?? "",
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const headers = getMoySkladHeaders();
  if (!headers) {
    return NextResponse.json(
      { error: "МойСклад: не заданы MOYSKLAD_TOKEN или пара MOYSKLAD_LOGIN/MOYSKLAD_PASSWORD" },
      { status: 500 }
    );
  }

  const url = `${MOYSKLAD_BASE}/entity/demand/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok) {
    const text = await res.text();
    let errMsg = res.statusText;
    try {
      const j = JSON.parse(text) as { errors?: { error?: string }[] };
      errMsg = j?.errors?.[0]?.error ?? errMsg;
    } catch {
      if (text.trim()) errMsg = text.slice(0, 500);
    }
    return NextResponse.json({ error: errMsg }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

