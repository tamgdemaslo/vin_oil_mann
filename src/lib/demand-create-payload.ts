import type { LocalEntityMeta } from "@/lib/local-entity-meta";

export type DemandPositionInput = {
  assortment?: { meta: LocalEntityMeta };
  name?: string;
  comment?: string;
  quantity: number;
  price: number; // рубли за единицу
  discount?: number;
  vat?: number;
  vatEnabled?: boolean;
  copyMeta?: unknown;
};

export type CreateDemandBody = {
  organization: { meta: LocalEntityMeta };
  agent?: { meta: LocalEntityMeta };
  store: { meta: LocalEntityMeta };
  name?: string;
  description?: string;
  moment?: string;
  applicable?: boolean;
  attributes?: { id: string; name?: string; meta?: LocalEntityMeta; value: string | number | boolean | null | unknown }[];
  positions?: DemandPositionInput[];
};

/** Тело POST /entity/demand (цены позиций — в копейках для API). */
export function buildDemandCreatePayload(body: CreateDemandBody): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    organization: body.organization,
    agent: body.agent,
    store: body.store,
  };
  if (body.name?.trim()) payload.name = body.name.trim();
  if (body.description?.trim()) payload.description = body.description.trim();
  if (body.moment?.trim()) payload.moment = body.moment.trim();
  if (typeof body.applicable === "boolean") payload.applicable = body.applicable;
  if (Array.isArray(body.attributes) && body.attributes.length > 0) {
    payload.attributes = body.attributes
      .filter((a) => a.meta?.href && a.value != null && a.value !== "")
      .map((a) => ({ meta: a.meta, value: a.value }));
  }
  if (Array.isArray(body.positions) && body.positions.length > 0) {
    payload.positions = body.positions.map((p) => ({
      assortment: p.assortment,
      name: p.name,
      quantity: Number(p.quantity) || 1,
      price: Math.round((Number(p.price) || 0) * 100),
      discount: Number(p.discount) || 0,
      vat: p.vat ?? 0,
      vatEnabled: p.vatEnabled ?? false,
      copyMeta: p.copyMeta,
    }));
  }
  return payload;
}
