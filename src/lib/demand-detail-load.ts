import { moyskladFetch, type MoySkladMeta } from "@/lib/moysklad";

export type DemandDetailHeader = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  description: string;
  sum: number;
  href?: string;
  agentName: string;
  organizationName: string;
  storeName: string;
  storeId: string;
  ecoUserName?: string;
};

export type DemandDetailAttribute = {
  id: string;
  name: string;
  type: string;
  meta: MoySkladMeta;
  value: unknown;
};

export type DemandDetailPosition = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  slotName: string;
  discount: number;
  stock: {
    cost?: number;
    quantity?: number;
    reserve?: number;
    intransit?: number;
    available?: number;
  };
  assortmentMeta?: MoySkladMeta;
};

export type DemandDetailPayload = {
  header: DemandDetailHeader;
  attributes: DemandDetailAttribute[];
  positions: DemandDetailPosition[];
  raw: unknown;
  rawPositions: unknown;
};

type DemandGet = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  description?: string;
  sum: number;
  meta: MoySkladMeta;
  agent?: { name?: string };
  organization?: { name?: string };
  store?: { name?: string };
} & Record<string, unknown>;

type DemandPositionRow = {
  id: string;
  quantity: number;
  price: number;
  assortment?: { name?: string; meta?: MoySkladMeta };
  slot?: { name?: string; meta?: MoySkladMeta };
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
  meta: MoySkladMeta;
};

/** Загрузка отгрузки для API и экспорта (МойСклад expand + позиции + остатки по складу). */
export async function loadDemandDetailPayload(
  id: string
): Promise<{ ok: true; data: DemandDetailPayload } | { ok: false; error: string }> {
  const [demandRes, metaRes] = await Promise.all([
    moyskladFetch<DemandGet>(`/entity/demand/${id}?expand=agent,organization,store`, {
      cache: "no-store",
    }),
    moyskladFetch<{ rows?: AttributeMeta[] } | AttributeMeta[]>("/entity/demand/metadata/attributes"),
  ]);
  if (!demandRes.ok) return { ok: false, error: demandRes.error };

  const posRes = await moyskladFetch<{ rows: DemandPositionRow[] }>(
    `/entity/demand/${id}/positions?expand=assortment,slot&fields=stock`,
    { cache: "no-store" }
  );

  const storeName = (demandRes.data as { store?: { name?: string } }).store?.name ?? "";
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

  let metaAttributes: AttributeMeta[] = [];
  if (metaRes.ok) {
    const d = metaRes.data as { rows?: AttributeMeta[] } | AttributeMeta[];
    if (Array.isArray(d)) {
      metaAttributes = d;
    } else if (Array.isArray(d.rows)) {
      metaAttributes = d.rows;
    }
  }
  const currentAttributes = ((demandRes.data as { attributes?: unknown[] }).attributes ?? []) as {
    id?: string;
    name?: string;
    value?: unknown;
  }[];
  const currentById = new Map<string, (typeof currentAttributes)[0]>();
  for (const a of currentAttributes) {
    if (a?.id) currentById.set(a.id as string, a);
  }
  const attributes: DemandDetailAttribute[] = metaAttributes.map((m) => {
    const cur =
      currentById.get(m.id) ?? currentAttributes.find((a) => a?.name === m.name);
    return {
      id: m.id,
      name: m.name,
      type: m.type,
      meta: m.meta,
      value: cur?.value ?? null,
    };
  });

  const storeMeta = (demandRes.data as { store?: { meta?: { href?: string } } }).store?.meta;
  const storeId = storeMeta?.href?.split("/").pop() ?? "";

  const ecoUserAttr = attributes.find(
    (a) => (a.name ?? "").toString().trim().toLowerCase() === "эко пользователь"
  );
  const ecoUserName = (() => {
    const v = ecoUserAttr?.value;
    if (typeof v === "string") return v;
    if (v == null) return undefined;
    return String(v);
  })();

  const data: DemandDetailPayload = {
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
            const assortmentHref = (p.assortment as { meta?: { href?: string } } | undefined)?.meta?.href;
            const fromReport = assortmentHref != null ? stockByHref[assortmentHref] : undefined;
            const baseStock = p.stock ?? {};
            const stock =
              typeof fromReport === "number"
                ? { ...baseStock, quantity: fromReport }
                : baseStock;
            return {
              id: p.id,
              name:
                (p.assortment as { name?: string } | undefined)?.name ??
                (p.assortment as { meta?: { href?: string } } | undefined)?.meta?.href ??
                "",
              quantity: p.quantity,
              price: p.price,
              slotName: p.slot?.name ?? "",
              discount: typeof p.discount === "number" ? p.discount : 0,
              stock,
              assortmentMeta: (p.assortment as { meta?: MoySkladMeta } | undefined)?.meta,
            };
          })
        : [],
    raw: demandRes.data,
    rawPositions: posRes.ok && posRes.data.rows ? posRes.data.rows : [],
  };

  return { ok: true, data };
}
