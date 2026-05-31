import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { type CreateDemandBody } from "@/lib/demand-create-payload";
import { createLocalDemand, loadLocalDemandDetailPayload } from "@/lib/local-demand-write";
import { toMoyskladMomentString } from "@/lib/time";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id?.trim()) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const loaded = await loadLocalDemandDetailPayload(id.trim());
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.notFound ? 404 : 400 });

  const raw = loaded.data.raw as {
    organization?: { meta?: { href: string; type: string; mediaType: string } };
    agent?: { meta?: { href: string; type: string; mediaType: string } };
    store?: { meta?: { href: string; type: string; mediaType: string } };
  };

  const orgM = raw.organization?.meta;
  const agentM = raw.agent?.meta;
  const storeM = raw.store?.meta;
  if (!agentM?.href || !storeM?.href) {
    return NextResponse.json(
      { error: "В отгрузке нет организации, контрагента или склада — копирование невозможно" },
      { status: 400 }
    );
  }

  const positionsWithAssortment = loaded.data.positions.filter((p) => p.assortmentMeta?.href);

  const moment = toMoyskladMomentString();

  const body: CreateDemandBody = {
    organization: { meta: orgM ?? { href: "local://organization/default", type: "organization", mediaType: "application/json" } },
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

  const created = await createLocalDemand(body, { ecoUserName: session.user.name || session.user.login });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
  return NextResponse.json(created);
}
