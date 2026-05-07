import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";

type Meta = { href: string; type: string; mediaType: string };

// Берём объект от МойСклад как есть, чтобы не терять поля
type DemandGet = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  description?: string;
  sum: number;
  meta: Meta;
  agent?: { name?: string };
  organization?: { name?: string };
  store?: { name?: string };
} & Record<string, unknown>;

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

type AttributeMeta = {
  id: string;
  name: string;
  type: string;
  meta: Meta;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const [demandRes, metaRes] = await Promise.all([
    moyskladFetch<DemandGet>(`/entity/demand/${id}?expand=agent,organization,store`, {
      cache: "no-store",
    }),
    moyskladFetch<{ rows?: AttributeMeta[] } | AttributeMeta[]>("/entity/demand/metadata/attributes"),
  ]);
  if (!demandRes.ok) return NextResponse.json({ error: demandRes.error }, { status: 502 });

  const posRes = await moyskladFetch<{ rows: DemandPositionRow[] }>(
    `/entity/demand/${id}/positions?expand=assortment,slot&fields=stock`,
    { cache: "no-store" }
  );

  const storeName = (demandRes.data as any).store?.name ?? "";
  let stockByHref: Record<string, number> = {};
  if (storeName) {
    const reportRes = await moyskladFetch<{
      rows?: { meta?: { href?: string }; stockByStore?: { name: string; stock: number }[] }[];
    }>("/report/stock/bystore", { cache: "no-store" });
    if (reportRes.ok && reportRes.data.rows) {
      for (const row of reportRes.data.rows) {
        const href = row.meta?.href ?? "";
        if (!href) continue;
        const forStore = (row.stockByStore ?? []).find((s) => s.name === storeName);
        stockByHref[href] = forStore?.stock ?? 0;
      }
    }
  }

  // Полный список доп. полей из метаданных + значения из документа
  let metaAttributes: AttributeMeta[] = [];
  if (metaRes.ok) {
    const d: any = metaRes.data;
    if (Array.isArray(d)) {
      metaAttributes = d as AttributeMeta[];
    } else if (Array.isArray(d.rows)) {
      metaAttributes = d.rows as AttributeMeta[];
    }
  }
  const currentAttributes = (demandRes.data as any).attributes || [];
  const currentById = new Map<string, any>();
  for (const a of currentAttributes) {
    if (a?.id) currentById.set(a.id as string, a);
  }
  const attributes = metaAttributes.map((m) => {
    const cur = currentById.get(m.id) ?? currentAttributes.find((a: any) => a?.name === m.name);
    return {
      id: m.id,
      name: m.name,
      type: m.type,
      meta: m.meta,
      value: cur?.value ?? null,
    };
  });

  const storeMeta = (demandRes.data as any).store?.meta;
  const storeId = storeMeta?.href?.split("/").pop() ?? "";

  const ecoUserAttr = attributes.find(
    (a) => (a.name ?? "").toString().trim().toLowerCase() === "эко пользователь".toLowerCase()
  );
  const ecoUserName = (() => {
    const v = ecoUserAttr?.value;
    if (typeof v === "string") return v;
    if (v == null) return undefined;
    return String(v);
  })();

  return NextResponse.json({
    header: {
      id: demandRes.data.id,
      name: demandRes.data.name,
      moment: demandRes.data.moment,
      applicable: demandRes.data.applicable,
      description: demandRes.data.description ?? "",
      sum: demandRes.data.sum,
      href: demandRes.data.meta?.href,
      agentName: demandRes.data.agent?.name ?? "",
      organizationName: demandRes.data.organization?.name ?? "",
      storeName: demandRes.data.store?.name ?? "",
      storeId,
      ecoUserName,
    },
    attributes,
    positions:
      posRes.ok && posRes.data.rows
        ? posRes.data.rows.map((p) => {
            const assortmentHref = (p.assortment as any)?.meta?.href;
            const fromReport = assortmentHref != null ? stockByHref[assortmentHref] : undefined;
            const baseStock = p.stock ?? {};
            const stock =
              typeof fromReport === "number"
                ? { ...baseStock, quantity: fromReport }
                : baseStock;
            return {
              id: p.id,
              name:
                (p.assortment as any)?.name ??
                (p.assortment as any)?.meta?.href ??
                "",
              quantity: p.quantity,
              price: p.price,
              slotName: p.slot?.name ?? "",
              discount: typeof p.discount === "number" ? p.discount : 0,
              stock,
              assortmentMeta: (p.assortment as any)?.meta,
            };
          })
        : [],
    raw: demandRes.data,
    rawPositions: posRes.ok && posRes.data.rows ? posRes.data.rows : [],
  });
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

  const result = await moyskladFetch<DemandGet>(
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

