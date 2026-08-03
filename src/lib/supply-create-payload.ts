import type { MoySkladMeta } from "@/lib/moysklad";

export type SupplyPositionInput = {
  assortment: { meta: MoySkladMeta };
  quantity: number;
  price: number;
  discount?: number;
  vat?: number;
  vatEnabled?: boolean;
};

export type CreateSupplyBody = {
  organization: { meta: MoySkladMeta };
  agent: { meta: MoySkladMeta };
  store: { meta: MoySkladMeta };
  name?: string;
  description?: string;
  moment?: string;
  incomingNumber?: string;
  incomingDate?: string;
  applicable?: boolean;
  vatEnabled?: boolean;
  vatIncluded?: boolean;
  positions?: SupplyPositionInput[];
};

/** Совместимое тело приёмки (цены позиций — в копейках для локального API). */
export function buildSupplyCreatePayload(body: CreateSupplyBody): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    organization: body.organization,
    agent: body.agent,
    store: body.store,
  };

  if (body.name?.trim()) payload.name = body.name.trim();
  if (body.description?.trim()) payload.description = body.description.trim();
  if (body.moment?.trim()) payload.moment = body.moment.trim();
  if (body.incomingNumber?.trim()) payload.incomingNumber = body.incomingNumber.trim();
  if (body.incomingDate?.trim()) payload.incomingDate = body.incomingDate.trim();
  if (typeof body.applicable === "boolean") payload.applicable = body.applicable;
  if (typeof body.vatEnabled === "boolean") payload.vatEnabled = body.vatEnabled;
  if (typeof body.vatIncluded === "boolean") payload.vatIncluded = body.vatIncluded;

  if (Array.isArray(body.positions) && body.positions.length > 0) {
    payload.positions = body.positions
      .filter((p) => p.assortment?.meta?.href && Number(p.quantity) > 0)
      .map((p) => ({
        assortment: p.assortment,
        quantity: Number(p.quantity) || 1,
        price: Math.round((Number(p.price) || 0) * 100),
        discount: Number(p.discount) || 0,
        vat: p.vat ?? 0,
        vatEnabled: p.vatEnabled ?? false,
      }));
  }

  return payload;
}
