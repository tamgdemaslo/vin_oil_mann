import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";

type Meta = { href: string; type: string; mediaType: string };

type SupplyHeader = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  description?: string;
  sum?: number;
  payedSum?: number;
  incomingNumber?: string;
  incomingDate?: string;
  meta?: { href?: string };
  agent?: { name?: string };
  organization?: { name?: string };
  store?: { name?: string };
};

type SupplyPositionRow = {
  id?: string;
  quantity?: number;
  price?: number;
  discount?: number;
  vat?: number;
  vatEnabled?: boolean;
  assortment?: {
    name?: string;
    code?: string;
    article?: string;
    meta?: Meta;
  };
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const [headerRes, positionsRes] = await Promise.all([
    moyskladFetch<SupplyHeader>(
      `/entity/supply/${encodeURIComponent(id)}?expand=agent,organization,store`,
      { cache: "no-store" }
    ),
    moyskladFetch<{ rows?: SupplyPositionRow[] }>(
      `/entity/supply/${encodeURIComponent(id)}/positions?limit=1000&expand=assortment`,
      { cache: "no-store" }
    ),
  ]);

  if (!headerRes.ok) return NextResponse.json({ error: headerRes.error }, { status: 502 });
  if (!positionsRes.ok) return NextResponse.json({ error: positionsRes.error }, { status: 502 });

  const header = headerRes.data;
  return NextResponse.json({
    header: {
      id: header.id,
      name: header.name,
      moment: header.moment,
      applicable: header.applicable,
      description: header.description ?? "",
      sum: header.sum ?? 0,
      payedSum: header.payedSum ?? 0,
      incomingNumber: header.incomingNumber ?? "",
      incomingDate: header.incomingDate ?? "",
      href: header.meta?.href ?? "",
      agentName: header.agent?.name ?? "",
      organizationName: header.organization?.name ?? "",
      storeName: header.store?.name ?? "",
    },
    positions: (positionsRes.data.rows ?? []).map((row) => ({
      id: row.id,
      name: row.assortment?.name ?? "Позиция без названия",
      code: row.assortment?.article ?? row.assortment?.code ?? "",
      quantity: Number(row.quantity ?? 0),
      price: Number(row.price ?? 0) / 100,
      discount: Number(row.discount ?? 0),
      vat: row.vat,
      vatEnabled: row.vatEnabled,
      assortmentMeta: row.assortment?.meta,
    })),
  });
}
