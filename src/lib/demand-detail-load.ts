import type { MoySkladMeta } from "@/lib/moysklad";

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
  copyMeta?: unknown;
};

export type DemandDetailPayload = {
  header: DemandDetailHeader;
  attributes: DemandDetailAttribute[];
  positions: DemandDetailPosition[];
  raw: unknown;
  rawPositions: unknown;
};

/** Legacy-загрузчик live МойСклад отключен для обычного runtime. Используйте loadLocalDemandDetailPayload. */
export async function loadDemandDetailPayload(
  id: string
): Promise<{ ok: true; data: DemandDetailPayload } | { ok: false; error: string }> {
  void id;
  return { ok: false, error: "Live-загрузка отгрузок МойСклад отключена. Используйте локальную БД." };
}
