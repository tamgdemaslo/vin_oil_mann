import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildSupplyCreatePayload, type CreateSupplyBody } from "@/lib/supply-create-payload";
import { moyskladFetch } from "@/lib/moysklad";
import { warmMoySkladLookupCaches } from "@/lib/moysklad-lookup-warmup";

type Meta = { href: string; type: string; mediaType: string };

type SupplyRow = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  sum?: number;
  payedSum?: number;
  incomingNumber?: string;
  incomingDate?: string;
  description?: string;
  meta: { href: string };
  agent?: { name?: string };
  organization?: { name?: string };
  store?: { name?: string };
};

type SupplyCreateResult = {
  id: string;
  name: string;
  moment?: string;
  applicable?: boolean;
  sum?: number;
  meta: Meta;
};

function mapSupplyRow(row: SupplyRow) {
  return {
    id: row.id,
    name: row.name,
    moment: row.moment,
    applicable: row.applicable,
    sum: row.sum ?? 0,
    payedSum: row.payedSum ?? 0,
    incomingNumber: row.incomingNumber ?? "",
    incomingDate: row.incomingDate ?? "",
    description: row.description ?? "",
    href: row.meta?.href,
    agentName: row.agent?.name ?? "",
    organizationName: row.organization?.name ?? "",
    storeName: row.store?.name ?? "",
  };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);

  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  qs.set("order", "moment,desc");
  qs.set("expand", "agent,organization,store");
  if (search.trim()) qs.set("search", search.trim());

  const result = await moyskladFetch<{ meta: { size: number; limit: number; offset: number }; rows: SupplyRow[] }>(
    `/entity/supply?${qs.toString()}`,
    { cache: "no-store" }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json({
    meta: result.data.meta,
    rows: (result.data.rows ?? []).map(mapSupplyRow),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: CreateSupplyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  if (!body.organization?.meta?.href || !body.agent?.meta?.href || !body.store?.meta?.href) {
    return NextResponse.json({ error: "Укажите организацию, поставщика и склад (meta.href)" }, { status: 400 });
  }

  const validPositions = (body.positions ?? []).filter(
    (p) => p.assortment?.meta?.href && Number(p.quantity) > 0
  );
  if (validPositions.length === 0) {
    return NextResponse.json({ error: "Добавьте хотя бы одну позицию приёмки" }, { status: 400 });
  }

  const payload = buildSupplyCreatePayload({ ...body, positions: validPositions });
  const result = await moyskladFetch<SupplyCreateResult>(
    "/entity/supply",
    { method: "POST", body: JSON.stringify(payload), cache: "no-store" }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  warmMoySkladLookupCaches("supply-created");

  return NextResponse.json({
    id: result.data.id,
    name: result.data.name,
    moment: result.data.moment,
    applicable: result.data.applicable,
    sum: result.data.sum ?? 0,
    href: result.data.meta?.href,
  });
}
