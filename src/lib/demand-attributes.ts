import { moyskladFetch, type MoySkladMeta } from "@/lib/moysklad";

export type DemandAttributeMeta = {
  id: string;
  name: string;
  type: string;
  meta: MoySkladMeta;
};

const REQUIRED_DEMAND_STRING_ATTRIBUTES = ["Объем", "Моторное масло"];

function normalizeAttributeName(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/ё/g, "е");
}

function parseAttributeList(data: { rows?: DemandAttributeMeta[] } | DemandAttributeMeta[]): DemandAttributeMeta[] {
  if (Array.isArray(data)) return data;
  return Array.isArray(data.rows) ? data.rows : [];
}

async function loadDemandAttributeMetadata() {
  return moyskladFetch<{ rows?: DemandAttributeMeta[] } | DemandAttributeMeta[]>(
    "/entity/demand/metadata/attributes",
    { cache: "no-store" }
  );
}

export async function ensureDemandAttributeMetadata(): Promise<
  | { ok: true; attributes: DemandAttributeMeta[] }
  | { ok: false; error: string; attributes: DemandAttributeMeta[] }
> {
  const loaded = await loadDemandAttributeMetadata();
  if (!loaded.ok) return { ok: false, error: loaded.error, attributes: [] };

  let attributes = parseAttributeList(loaded.data);
  const existingNames = new Set(attributes.map((a) => normalizeAttributeName(a.name)));

  for (const name of REQUIRED_DEMAND_STRING_ATTRIBUTES) {
    if (existingNames.has(normalizeAttributeName(name))) continue;

    const created = await moyskladFetch<DemandAttributeMeta>(
      "/entity/demand/metadata/attributes",
      {
        method: "POST",
        body: JSON.stringify({ name, type: "string" }),
        cache: "no-store",
      }
    );

    if (!created.ok) {
      const reloaded = await loadDemandAttributeMetadata();
      if (reloaded.ok) {
        attributes = parseAttributeList(reloaded.data);
        if (attributes.some((a) => normalizeAttributeName(a.name) === normalizeAttributeName(name))) {
          continue;
        }
      }
      return {
        ok: false,
        error: `Не удалось создать доп. поле отгрузки «${name}» в МойСклад: ${created.error}`,
        attributes,
      };
    }

    attributes.push(created.data);
    existingNames.add(normalizeAttributeName(created.data.name));
  }

  return { ok: true, attributes };
}
