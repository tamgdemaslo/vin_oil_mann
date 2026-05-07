import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";
import { syncAqsiPendingOrder } from "@/lib/aqsi";

type Meta = { href: string; type: string; mediaType: string };

type DemandGet = {
  id: string;
  name: string;
  moment: string;
  description?: string;
  agent?: {
    name?: string;
    phone?: string;
    email?: string;
    phones?: Array<{ phone?: string } | string>;
    meta?: Meta;
  } & Record<string, unknown>;
} & Record<string, unknown>;

type DemandPositionRow = {
  quantity: number;
  price: number;
  discount?: number;
  assortment?: {
    name?: string;
    code?: string;
    article?: string;
    meta?: Meta;
  } & Record<string, unknown>;
} & Record<string, unknown>;

function pickCustomerContact(agent: DemandGet["agent"]): string | undefined {
  if (!agent) return undefined;

  const directPhone = typeof agent.phone === "string" ? agent.phone.trim() : "";
  if (directPhone) return directPhone;

  const directEmail = typeof agent.email === "string" ? agent.email.trim() : "";
  if (directEmail) return directEmail;

  if (Array.isArray(agent.phones)) {
    for (const phone of agent.phones) {
      if (typeof phone === "string" && phone.trim()) return phone.trim();
      if (phone && typeof phone === "object" && typeof phone.phone === "string" && phone.phone.trim()) {
        return phone.phone.trim();
      }
    }
  }

  return undefined;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id не указан" }, { status: 400 });
  }

  const [demandRes, positionsRes] = await Promise.all([
    moyskladFetch<DemandGet>(`/entity/demand/${id}?expand=agent`, {
      cache: "no-store",
    }),
    moyskladFetch<{ rows: DemandPositionRow[] }>(
      `/entity/demand/${id}/positions?expand=assortment`,
      { cache: "no-store" }
    ),
  ]);

  if (!demandRes.ok) {
    return NextResponse.json({ error: demandRes.error }, { status: 502 });
  }
  if (!positionsRes.ok) {
    return NextResponse.json({ error: positionsRes.error }, { status: 502 });
  }

  const items = (positionsRes.data.rows ?? []).map((row) => ({
    name:
      row.assortment?.name ??
      row.assortment?.article ??
      row.assortment?.code ??
      "Позиция без названия",
    quantity: Number(row.quantity) || 0,
    unitPrice: (Number(row.price) || 0) / 100,
    discountPercent: typeof row.discount === "number" ? row.discount : 0,
    sku: row.assortment?.article ?? row.assortment?.code ?? undefined,
  }));

  try {
    const aqsi = await syncAqsiPendingOrder({
      id: demandRes.data.id,
      number: demandRes.data.name || demandRes.data.id,
      dateTime: demandRes.data.moment,
      comment: demandRes.data.description ?? "",
      customer: demandRes.data.agent?.name ?? "",
      customerContact: pickCustomerContact(demandRes.data.agent),
      items,
    });

    return NextResponse.json({
      ok: true,
      orderId: aqsi.orderId,
      uid: aqsi.uid,
      status: aqsi.status,
      deviceId: aqsi.deviceId,
      shopId: aqsi.shopId,
      cashierId: aqsi.cashierId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось отправить заказ в AQSI",
      },
      { status: 502 }
    );
  }
}
