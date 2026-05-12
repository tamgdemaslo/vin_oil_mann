import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildDemandCreatePayload, type CreateDemandBody } from "@/lib/demand-create-payload";
import { moyskladFetch } from "@/lib/moysklad";

type Meta = { href: string; type: string; mediaType: string };

type AttributeMeta = { id: string; name: string; type: string; meta: Meta };

type DemandRow = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  sum: number; // копейки
  agent?: { name?: string };
  organization?: { name?: string };
  store?: { name?: string };
  meta: { href: string };
  attributes?: { id?: string; name?: string; value?: unknown }[];
} & Record<string, unknown>;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);

  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  qs.set("order", "moment,desc");
  qs.set("expand", "agent,organization,store");
  if (search.trim()) qs.set("search", search.trim());

  const result = await moyskladFetch<{ meta: { size: number; limit: number; offset: number }; rows: DemandRow[] }>(
    `/entity/demand?${qs.toString()}`,
    { cache: "no-store" }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  // Пытаемся найти доп. поле «Эко пользователь», чтобы показать, кто создал документ через эко-платформу
  const metaRes = await moyskladFetch<{ rows?: AttributeMeta[] } | AttributeMeta[]>(
    "/entity/demand/metadata/attributes",
    { cache: "no-store" }
  );
  let ecoAttrId: string | null = null;
  if (metaRes.ok) {
    const d: any = metaRes.data;
    const list: AttributeMeta[] = Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : [];
    const found = list.find(
      (a) => (a.name ?? "").toString().trim().toLowerCase() === "эко пользователь".toLowerCase()
    );
    if (found) ecoAttrId = found.id;
  }

  return NextResponse.json({
    meta: result.data.meta,
    rows: (result.data.rows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      moment: r.moment,
      applicable: r.applicable,
      sum: r.sum,
      href: r.meta?.href,
      agentName: r.agent?.name ?? "",
      organizationName: r.organization?.name ?? "",
      storeName: r.store?.name ?? "",
      ecoUserName:
        ecoAttrId && Array.isArray(r.attributes)
          ? (() => {
              const attr = r.attributes!.find((a) => a.id === ecoAttrId || a.name === "Эко пользователь");
              const v = attr?.value;
              if (typeof v === "string") return v;
              if (v == null) return undefined;
              return String(v);
            })()
          : undefined,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: CreateDemandBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  if (!body.organization?.meta?.href || !body.agent?.meta?.href || !body.store?.meta?.href) {
    return NextResponse.json({ error: "Укажите организацию, контрагента и склад (meta.href)" }, { status: 400 });
  }

  // Автоматически записываем в доп. поле «Эко пользователь» логин/имя пользователя эко-платформы, если такое поле создано в МойСклад
  try {
    const metaRes = await moyskladFetch<{ rows?: AttributeMeta[] } | AttributeMeta[]>(
      "/entity/demand/metadata/attributes",
      { cache: "no-store" }
    );
    if (metaRes.ok) {
      const d: any = metaRes.data;
      const list: AttributeMeta[] = Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : [];
      const ecoAttr = list.find(
        (a) => (a.name ?? "").toString().trim().toLowerCase() === "эко пользователь".toLowerCase()
      );
      if (ecoAttr) {
        const ecoValue = (session.user.name || session.user.login).toString();
        const existing = Array.isArray(body.attributes)
          ? body.attributes.filter((a) => a.id !== ecoAttr.id)
          : [];
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
    // если МойСклад вернул ошибку по метаданным — просто не заполняем поле, создание документа не ломаем
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

