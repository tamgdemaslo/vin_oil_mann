import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildDemandCreatePayload, type CreateDemandBody } from "@/lib/demand-create-payload";
import { loadDemandDetailPayload } from "@/lib/demand-detail-load";
import { moyskladFetch } from "@/lib/moysklad";

type AttributeMeta = { id: string; name: string; type: string; meta: { href: string; type: string; mediaType: string } };

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id?.trim()) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const loaded = await loadDemandDetailPayload(id.trim());
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 502 });

  const raw = loaded.data.raw as {
    organization?: { meta?: { href: string; type: string; mediaType: string } };
    agent?: { meta?: { href: string; type: string; mediaType: string } };
    store?: { meta?: { href: string; type: string; mediaType: string } };
  };

  const orgM = raw.organization?.meta;
  const agentM = raw.agent?.meta;
  const storeM = raw.store?.meta;
  if (!orgM?.href || !agentM?.href || !storeM?.href) {
    return NextResponse.json(
      { error: "В отгрузке нет организации, контрагента или склада — копирование невозможно" },
      { status: 400 }
    );
  }

  const positionsWithAssortment = loaded.data.positions.filter((p) => p.assortmentMeta?.href);

  const moment = new Date().toISOString().slice(0, 19).replace("T", " ");

  const body: CreateDemandBody = {
    organization: { meta: orgM },
    agent: { meta: agentM },
    store: { meta: storeM },
    description: loaded.data.header.description?.trim() || undefined,
    applicable: false,
    moment,
    attributes: loaded.data.attributes.map((a) => ({
      id: a.id,
      name: a.name,
      meta: a.meta,
      value: a.value as string | number | boolean | null | unknown,
    })),
    positions:
      positionsWithAssortment.length > 0
        ? positionsWithAssortment.map((p) => ({
            assortment: { meta: p.assortmentMeta! },
            quantity: Number(p.quantity) || 1,
            price: (Number(p.price) || 0) / 100,
            discount: typeof p.discount === "number" ? p.discount : 0,
            vat: 0,
            vatEnabled: false,
          }))
        : undefined,
  };

  try {
    const metaRes = await moyskladFetch<{ rows?: AttributeMeta[] } | AttributeMeta[]>(
      "/entity/demand/metadata/attributes",
      { cache: "no-store" }
    );
    if (metaRes.ok) {
      const d: unknown = metaRes.data;
      const list: AttributeMeta[] = Array.isArray(d) ? d : Array.isArray((d as { rows?: AttributeMeta[] })?.rows) ? (d as { rows: AttributeMeta[] }).rows : [];
      const ecoAttr = list.find(
        (a) => (a.name ?? "").toString().trim().toLowerCase() === "эко пользователь".toLowerCase()
      );
      if (ecoAttr) {
        const ecoValue = (session.user.name || session.user.login).toString();
        const existing = Array.isArray(body.attributes) ? body.attributes.filter((a) => a.id !== ecoAttr.id) : [];
        body.attributes = [
          ...existing,
          {
            id: ecoAttr.id,
            name: ecoAttr.name,
            meta: ecoAttr.meta,
            value: ecoValue,
          },
        ];
      }
    }
  } catch {
    // как в POST /api/demands
  }

  const payload = buildDemandCreatePayload(body);
  const result = await moyskladFetch<{ id: string; name: string; meta: { href: string } }>(
    "/entity/demand",
    { method: "POST", body: JSON.stringify(payload), cache: "no-store" }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json({
    id: result.data.id,
    name: result.data.name,
    href: result.data.meta?.href,
  });
}
