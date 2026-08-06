import type { LocalEntityMeta } from "@/lib/local-entity-meta";

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
  meta: LocalEntityMeta;
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
  assortmentMeta?: LocalEntityMeta;
  product?: {
    id: string;
    name: string;
    uomName?: string | null;
    groupPath?: string | null;
    packageVolume?: string | null;
    volume?: string | null;
    barcodeEan13?: string | null;
    markingEnabled?: boolean;
    markingMode?: string | null;
    markingStatus?: string | null;
    markingSettings?: unknown;
  };
  copyMeta?: unknown;
};

export type DemandDetailPayload = {
  header: DemandDetailHeader;
  attributes: DemandDetailAttribute[];
  positions: DemandDetailPosition[];
  raw: unknown;
  rawPositions: unknown;
};

/** Устаревший live-загрузчик отключен для обычного runtime. Используйте loadLocalDemandDetailPayload. */
export async function loadDemandDetailPayload(
  id: string
): Promise<{ ok: true; data: DemandDetailPayload } | { ok: false; error: string }> {
  void id;
  return { ok: false, error: "Live-загрузка отгрузок отключена. Используйте локальную БД." };
}
