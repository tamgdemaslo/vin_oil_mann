"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CreditCard,
  ExternalLink,
  PackagePlus,
  Plus,
  Receipt,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Wrench,
  X,
} from "lucide-react";
import { getOilLineBaseName } from "@/lib/oil-pack-volume";
import { DiagnosticMapModal } from "@/components/diagnostic/DiagnosticMapModal";
import { EcoBadge, EcoButton } from "@/components/platform/EcoUI";
import MoneyInput from "@/components/MoneyInput";
import { ShipmentPrintMenu } from "@/components/shipment/ShipmentPrintMenu";
import { formatServiceDateTime, toServiceMomentString } from "@/lib/date-time";
import { inferDiagnosticVehicleHintsFromLookup } from "@/lib/diagnostic-vehicle-hints";

type Meta = { href: string; type: string; mediaType: string };

type Org = { id: string; name: string; meta: Meta };
type Store = { id: string; name: string; meta: Meta; isMain?: boolean };
type Counterparty = { id: string; name: string; meta: Meta };
type ProductSearchMode = "all" | "product" | "service";
type Product = {
  id: string;
  name: string;
  article?: string;
  price: number;
  currency: string;
  meta: Meta;
  cell?: string;
  stockQuantity?: number;
  reserveQuantity?: number;
  availableQuantity?: number;
  slotName?: string;
  cost?: number;
  buyPriceCents?: number;
};

type Position = {
  id?: string;
  name: string;
  quantity: number;
  price: number;
  assortmentMeta?: Meta;
  /** Значение доп. поля товара «Ячейка» (если есть) */
  cell?: string;
  slotName?: string;
  stock?: {
    cost?: number;
    quantity?: number;
    reserve?: number;
    available?: number;
    slotName?: string;
  };
  discount?: number;
  discountMode?: "percent" | "amount";
  discountAmount?: number;
};

type ShipmentAttribute = { id: string; name: string; type: string; meta: Meta; value: string | null };
type SessionJson = { user?: { role?: string } };
type OrganizationsJson = { organizations?: Org[]; error?: string };
type StoresJson = { stores?: Store[]; error?: string };
type StockJson = { stockByAssortment?: Record<string, { quantity: number; reserve?: number; available?: number; slotName?: string; cost?: number }> };
type AttributesJson = { attributes?: ShipmentAttribute[]; error?: string };
type CounterpartiesJson = { counterparties?: Counterparty[]; error?: string };
type ProductsJson = { products?: Product[]; error?: string };
type AgentCreateJson = { id?: string; name?: string; meta?: Meta; error?: string };
type DemandCreateJson = { id?: string; name?: string; applicable?: boolean; description?: string; error?: string };
type DiagnosticExistingJson = { diagnostic?: { id?: string }; error?: string };
type DiagnosticCreateJson = { diagnosticId?: string; error?: string };

type DemandDetailJson = {
  header?: {
    id: string;
    name: string;
    moment: string;
    applicable: boolean;
    description?: string;
    agentName?: string;
    organizationName?: string;
    storeName?: string;
  };
  attributes?: ShipmentAttribute[];
  positions?: Array<Position & { price: number }>;
  raw?: {
    agent?: { id?: string; name?: string; meta?: Meta };
    organization?: { id?: string; name?: string; meta?: Meta };
    store?: { id?: string; name?: string; meta?: Meta; isMain?: boolean };
  };
  error?: string;
};

const EDITABLE_ATTR_NAMES = ["vin номер", "модель авто", "год", "гос. номер", "пробег", "объем", "моторное масло"];

async function safeJson<T>(response: Response, fallback: T): Promise<T> {
  try {
    const text = await response.text();
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

type VinLookupItem = {
  name: string;
  article?: string;
  price: number;
  currency: string;
  quantity: number;
  store: string;
  cell?: string;
  productId?: string;
  volumeLiters?: number;
  imageHref?: string;
  lookupKind?: "oil" | "oil-filter" | "fuel-filter" | "air-filter" | "cabin-filter" | "other";
};

type VinLookupResult = {
  vin: string;
  decoded?: {
    make?: string;
    model?: string;
    modelYear?: string;
    displacementL?: string;
    enginePowerPS?: number;
    engineSeries?: string;
    modification?: string;
  } | null;
  decodeError?: string;
  oilInfo?: {
    approval?: string;
    fillVolumeLiters?: string;
    sae?: string[];
    acea?: string[];
    api?: string[];
    oilFilterOem?: string;
    fuelFilterOem?: string;
    airFilterOem?: string;
    cabinFilterOem?: string;
    oilFilterMann?: string;
    airFilterMann?: string;
    cabinFilterMann?: string;
    transmission?: {
      code: string;
      gearbox: string;
      fluid: string;
      partialVolumeLiters?: string;
      fullVolumeLiters?: string;
      levelCheckTempC?: string;
      note?: string;
    };
  } | null;
  openaiError?: string;
  moySkladItems: VinLookupItem[];
  moySkladError?: string;
};

type OilVariant = {
  key: string;
  name: string;
  article?: string;
  price: number;
  currency: string;
  available: number;
  volumeLiters?: number;
  productId?: string;
  imageHref?: string;
  stores: string[];
  sourceItems: VinLookupItem[];
};

type OilBundleLine = {
  variant: OilVariant;
  quantity: number;
};

type OilGroup = {
  key: string;
  baseName: string;
  variants: OilVariant[];
  bestBundle: OilBundleLine[];
  bestTotalLiters?: number;
  bestTotalPrice?: number;
  bestExcessLiters?: number;
};

type MaintenanceOfferLine = {
  name: string;
  article?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  currency: string;
};

type MaintenanceOffer = {
  key: string;
  title: string;
  note: string;
  lines: MaintenanceOfferLine[];
  total: number;
  currency: string;
};

const OIL_VOLUME_SUFFIX_RE =
  /(?:[\s,./()-]*)(\d+(?:[.,]\d+)?)\s*(л|l|литр(?:а|ов)?|литра|литров|ml|мл)\.?$/i;

const FILTER_SECTION_META = {
  "oil-filter": { title: "Масляные фильтры", accent: "amber" },
  "air-filter": { title: "Воздушные фильтры", accent: "sky" },
  "cabin-filter": { title: "Салонные фильтры", accent: "violet" },
  "fuel-filter": { title: "Топливные фильтры", accent: "emerald" },
} as const;

type FilterSectionKind = keyof typeof FILTER_SECTION_META;

function formatMoney(value: number, currency = "руб."): string {
  return `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function parseDecimalInput(value: string): number {
  return Number(value.replace(",", ".")) || 0;
}

function formatVolume(volume?: number): string {
  if (typeof volume !== "number" || Number.isNaN(volume) || volume <= 0) return "—";
  if (volume < 1) return `${Math.round(volume * 1000)} мл`;
  return `${volume.toLocaleString("ru-RU", { minimumFractionDigits: Number.isInteger(volume) ? 0 : 1, maximumFractionDigits: 2 })} л`;
}

function getStockToneClass(value?: number): string {
  const qty = Math.max(0, Math.floor(value ?? 0));
  if (qty <= 0) return "text-red-600 dark:text-red-400";
  if (qty <= 2) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function localEntityIdFromMeta(meta?: Meta): string {
  const href = meta?.href?.trim() ?? "";
  if (!href) return "";
  const localMatch = href.match(/^local:\/\/[^/]+\/([^/?#]+)/i);
  if (localMatch?.[1]) return decodeURIComponent(localMatch[1]);
  const entityMatch = href.match(/\/entity\/(?:product|variant|service|counterparty)\/([^/?#]+)/i);
  return entityMatch?.[1] ? decodeURIComponent(entityMatch[1]) : "";
}

function productCatalogHref(product: Product): string {
  return `/inventory/products?product=${encodeURIComponent(product.id)}`;
}

function positionProductHref(position: Position): string {
  const productId = localEntityIdFromMeta(position.assortmentMeta);
  if (productId) return `/inventory/products?product=${encodeURIComponent(productId)}`;
  return `/inventory/products?search=${encodeURIComponent(position.name)}`;
}

function isServiceMeta(meta?: Meta): boolean {
  return meta?.type === "service" || /^local:\/\/service\//i.test(meta?.href ?? "") || /\/entity\/service\//i.test(meta?.href ?? "");
}

function counterpartyCatalogHref(counterparty: Counterparty): string {
  const id = counterparty.id?.trim() || localEntityIdFromMeta(counterparty.meta);
  if (id) return `/clients/counterparties?counterparty=${encodeURIComponent(id)}`;
  const name = counterparty.name.trim();
  return name ? `/clients/counterparties?search=${encodeURIComponent(name)}` : "/clients/counterparties";
}

function detectFilterKind(item: VinLookupItem): FilterSectionKind | null {
  if (item.lookupKind && item.lookupKind in FILTER_SECTION_META) return item.lookupKind as FilterSectionKind;
  const name = item.name.toLowerCase();
  if (/салон|cabin|interior/.test(name)) return "cabin-filter";
  if (/воздуш|air filter/.test(name)) return "air-filter";
  if (/топлив|fuel filter/.test(name)) return "fuel-filter";
  if (/маслян|масля|oil filter/.test(name)) return "oil-filter";
  return /фильтр|filter/.test(name) ? "oil-filter" : null;
}

function getFilterSectionClasses(kind: FilterSectionKind): string {
  switch (kind) {
    case "oil-filter":
      return "border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-900/10";
    case "air-filter":
      return "border-sky-200 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-900/10";
    case "cabin-filter":
      return "border-violet-200 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-900/10";
    case "fuel-filter":
      return "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-900/10";
  }
}

function getMoySkladImageUrl(imageHref?: string): string | undefined {
  return imageHref ? `/api/moysklad/image?href=${encodeURIComponent(imageHref)}` : undefined;
}

function parseFillVolume(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value.replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function hasText(value?: string): boolean {
  return Boolean(value && value.trim().length > 0);
}

function normalizeAttrName(value?: string): string {
  return (value ?? "").toString().trim().toLowerCase().replace(/ё/g, "е");
}

function attributeValueToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

function getAttributeString(attributes: ShipmentAttribute[], matches: (name: string) => boolean): string {
  const attr = attributes.find((a) => matches((a.name ?? "").toLowerCase()));
  return attributeValueToString(attr?.value).trim();
}

function getOilBaseName(name: string, volumeLiters?: number): string {
  return getOilLineBaseName(name, volumeLiters);
}

function describeBundle(bundle: OilBundleLine[]): string {
  return bundle
    .map(({ variant, quantity }) => `${quantity} x ${formatVolume(variant.volumeLiters)}`)
    .join(" + ");
}

function buildOilVariants(items: VinLookupItem[]): OilVariant[] {
  const grouped = new Map<string, OilVariant>();
  for (const item of items) {
    const key = item.productId ?? `${item.name}|${item.article ?? ""}|${item.price}|${item.volumeLiters ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.available += Math.max(0, Math.floor(item.quantity || 0));
      if (item.store && item.store !== "—" && !existing.stores.includes(item.store)) existing.stores.push(item.store);
      existing.sourceItems.push(item);
      continue;
    }
    grouped.set(key, {
      key,
      name: item.name,
      article: item.article,
      price: item.price,
      currency: item.currency,
      available: Math.max(0, Math.floor(item.quantity || 0)),
      volumeLiters: item.volumeLiters,
      productId: item.productId,
      imageHref: item.imageHref,
      stores: item.store && item.store !== "—" ? [item.store] : [],
      sourceItems: [item],
    });
  }
  return [...grouped.values()].sort((a, b) => {
    if (b.available !== a.available) return b.available - a.available;
    const aVolume = a.volumeLiters ?? 0;
    const bVolume = b.volumeLiters ?? 0;
    if (bVolume !== aVolume) return bVolume - aVolume;
    return a.price - b.price;
  });
}

function chooseBestOilBundle(variants: OilVariant[], targetLiters?: number): {
  bundle: OilBundleLine[];
  totalLiters?: number;
  totalPrice?: number;
  excessLiters?: number;
} {
  const usable = variants.filter((variant) => (variant.volumeLiters ?? 0) > 0);
  if (usable.length === 0) return { bundle: [] };
  const anyStockOverall = usable.some((variant) => variant.available > 0);
  if (!anyStockOverall) return { bundle: [] };
  if (!targetLiters || targetLiters <= 0) {
    const cheapest = [...usable].sort((a, b) => {
      const aUnit = a.volumeLiters ? a.price / a.volumeLiters : Number.POSITIVE_INFINITY;
      const bUnit = b.volumeLiters ? b.price / b.volumeLiters : Number.POSITIVE_INFINITY;
      return aUnit - bUnit || a.price - b.price;
    })[0];
    return cheapest
      ? {
          bundle: [{ variant: cheapest, quantity: 1 }],
          totalLiters: cheapest.volumeLiters,
          totalPrice: cheapest.price,
          excessLiters: 0,
        }
      : { bundle: [] };
  }

  const preferred = usable.filter((variant) => variant.available > 0);

  let best:
    | {
        bundle: OilBundleLine[];
        totalLiters: number;
        totalPrice: number;
        excessLiters: number;
      }
    | undefined;

  const search = (index: number, lines: OilBundleLine[], totalLiters: number, totalPrice: number, totalCount: number) => {
    if (totalLiters >= targetLiters) {
      const candidate = {
        bundle: lines.filter((line) => line.quantity > 0),
        totalLiters,
        totalPrice,
        excessLiters: totalLiters - targetLiters,
      };
      const shouldReplace =
        !best ||
        candidate.excessLiters < best.excessLiters ||
        (candidate.excessLiters === best.excessLiters && candidate.totalPrice < best.totalPrice) ||
        (candidate.excessLiters === best.excessLiters &&
          candidate.totalPrice === best.totalPrice &&
          totalCount < best.bundle.reduce((sum, line) => sum + line.quantity, 0));
      if (shouldReplace) best = candidate;
      return;
    }
    if (index >= preferred.length) return;

    const variant = preferred[index];
    const volume = variant.volumeLiters ?? 0;
    if (volume <= 0) {
      search(index + 1, lines, totalLiters, totalPrice, totalCount);
      return;
    }

    const maxNeeded = Math.ceil(targetLiters / volume) + 1;
    const maxQty = Math.max(0, Math.min(variant.available, maxNeeded));
    for (let qty = maxQty; qty >= 0; qty -= 1) {
      if (qty === 0) {
        search(index + 1, lines, totalLiters, totalPrice, totalCount);
        continue;
      }
      search(
        index + 1,
        [...lines, { variant, quantity: qty }],
        totalLiters + volume * qty,
        totalPrice + variant.price * qty,
        totalCount + qty
      );
    }
  };

  search(0, [], 0, 0, 0);
  return best ? best : { bundle: [] };
}

function buildOilGroups(items: VinLookupItem[], targetLiters?: number): OilGroup[] {
  const groups = new Map<string, VinLookupItem[]>();
  for (const item of items) {
    const baseName = getOilBaseName(item.name, item.volumeLiters);
    const key = baseName.toLowerCase();
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  return [...groups.entries()]
    .map(([key, groupItems]) => {
      const variants = buildOilVariants(groupItems);
      const best = chooseBestOilBundle(variants, targetLiters);
      return {
        key,
        baseName: getOilBaseName(groupItems[0]?.name ?? key, groupItems[0]?.volumeLiters),
        variants,
        bestBundle: best.bundle,
        bestTotalLiters: best.totalLiters,
        bestTotalPrice: best.totalPrice,
        bestExcessLiters: best.excessLiters,
      };
    })
    .filter((group) => group.variants.length > 0)
    .sort((a, b) => {
      const aHasBundle = a.bestBundle.length > 0 ? 1 : 0;
      const bHasBundle = b.bestBundle.length > 0 ? 1 : 0;
      if (bHasBundle !== aHasBundle) return bHasBundle - aHasBundle;
      if ((a.bestExcessLiters ?? Number.POSITIVE_INFINITY) !== (b.bestExcessLiters ?? Number.POSITIVE_INFINITY)) {
        return (a.bestExcessLiters ?? Number.POSITIVE_INFINITY) - (b.bestExcessLiters ?? Number.POSITIVE_INFINITY);
      }
      if ((a.bestTotalPrice ?? Number.POSITIVE_INFINITY) !== (b.bestTotalPrice ?? Number.POSITIVE_INFINITY)) {
        return (a.bestTotalPrice ?? Number.POSITIVE_INFINITY) - (b.bestTotalPrice ?? Number.POSITIVE_INFINITY);
      }
      return a.baseName.localeCompare(b.baseName, "ru");
    });
}

function getVehicleSummary(result: VinLookupResult): string {
  const decoded = result.decoded;
  const title = [decoded?.make, decoded?.model, decoded?.modelYear].filter(Boolean).join(" ");
  return title || "не определен";
}

function getCheapestAvailableItem(items: VinLookupItem[]): VinLookupItem | undefined {
  return [...items]
    .filter((item) => item.quantity > 0)
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, "ru"))[0];
}

/** Для текста клиента: сначала вариант в наличии, иначе самый дешёвый из подобранного (остаток 0). */
function getRepresentativeFilterItem(items: VinLookupItem[]): VinLookupItem | undefined {
  if (items.length === 0) return undefined;
  const inStock = items.filter((item) => item.quantity > 0);
  const pool = inStock.length > 0 ? inStock : items;
  return [...pool].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, "ru"))[0];
}

function getFilterLinePrefix(kind: FilterSectionKind): string {
  switch (kind) {
    case "oil-filter":
      return "Масляный фильтр";
    case "air-filter":
      return "Воздушный фильтр";
    case "cabin-filter":
      return "Салонный фильтр";
    case "fuel-filter":
      return "Топливный фильтр";
  }
}

function getOilOfferLines(group?: OilGroup): MaintenanceOfferLine[] {
  if (!group) return [];
  if (group.bestBundle.length > 0) {
    return group.bestBundle.map((line) => ({
      name: `${group.baseName} ${formatVolume(line.variant.volumeLiters)}`,
      article: line.variant.article,
      quantity: line.quantity,
      unitPrice: line.variant.price,
      total: line.variant.price * line.quantity,
      currency: line.variant.currency,
    }));
  }
  const variant = group.variants[0];
  if (!variant) return [];
  return [
    {
      name: `${group.baseName} ${formatVolume(variant.volumeLiters)}`,
      article: variant.article,
      quantity: 1,
      unitPrice: variant.price,
      total: variant.price,
      currency: variant.currency,
    },
  ];
}

function buildMaintenanceOffer(
  key: string,
  title: string,
  note: string,
  oilGroup: OilGroup | undefined,
  filterSections: { kind: FilterSectionKind; title: string; items: VinLookupItem[] }[]
): MaintenanceOffer | null {
  const lines = [
    ...getOilOfferLines(oilGroup),
    ...filterSections.flatMap((section) => {
      const item = getRepresentativeFilterItem(section.items);
      if (!item) return [];
      return [
        {
          name: `${getFilterLinePrefix(section.kind)}: ${item.name}`,
          article: item.article,
          quantity: 1,
          unitPrice: item.price,
          total: item.price,
          currency: item.currency,
        },
      ];
    }),
  ];

  if (lines.length === 0) return null;
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  return {
    key,
    title,
    note,
    lines,
    total,
    currency: lines[0]?.currency ?? "руб.",
  };
}

function buildMaintenanceMessage(result: VinLookupResult, offers: MaintenanceOffer[]): string {
  const oilInfo = result.oilInfo;
  const header = [
    "Добрый день! Рассчитали варианты ТО по VIN.",
    "",
    `Автомобиль: ${getVehicleSummary(result)}`,
    `VIN: ${result.vin}`,
  ];

  if (
    hasText(oilInfo?.approval) ||
    (oilInfo?.acea?.length ?? 0) > 0 ||
    (oilInfo?.api?.length ?? 0) > 0 ||
    hasText(oilInfo?.fillVolumeLiters) ||
    (oilInfo?.sae?.length ?? 0) > 0
  ) {
    header.push(
      [
        hasText(oilInfo?.approval)
          ? `допуск ${oilInfo?.approval}`
          : (oilInfo?.acea?.length ?? 0) > 0
            ? `ACEA ${oilInfo!.acea!.join(", ")}`
            : (oilInfo?.api?.length ?? 0) > 0
              ? `API ${oilInfo!.api!.join(", ")}`
              : null,
        hasText(oilInfo?.fillVolumeLiters) ? `объем масла ${oilInfo?.fillVolumeLiters}` : null,
        oilInfo?.sae?.length ? `SAE ${oilInfo.sae.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(", ")
    );
  }

  const body = offers.flatMap((offer, index) => [
    "",
    `Вариант ${index + 1}: ${offer.title}`,
    offer.note,
    ...offer.lines.map((line) => {
      return `${line.name} — ${line.quantity} шт. x ${formatMoney(line.unitPrice, line.currency)} = ${formatMoney(line.total, line.currency)}`;
    }),
    `Итого по запчастям: ${formatMoney(offer.total, offer.currency)}`,
  ]);

  return [...header, ...body, "", "Цены актуальны на момент расчета, наличие лучше подтвердить перед заказом."].join("\n");
}

type NewShipmentFormProps = {
  demandId?: string;
  copied?: boolean;
};

function NewShipmentForm({ demandId, copied = false }: NewShipmentFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillCounterparty = searchParams.get("counterparty")?.trim() ?? "";
  const prefillPhone = searchParams.get("phone")?.trim() ?? "";
  const prefillComment = searchParams.get("comment")?.trim() ?? "";
  const prefillVin = searchParams.get("vin")?.trim() ?? "";
  const prefillVehicle = searchParams.get("vehicle")?.trim() ?? "";
  const prefillPlate = searchParams.get("plate")?.trim() ?? "";
  const isExistingDraft = Boolean(demandId);

  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingStores, setLoadingStores] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);

  const [agentSearch, setAgentSearch] = useState("");
  const [agentOptions, setAgentOptions] = useState<Counterparty[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentSearchError, setAgentSearchError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Counterparty | null>(null);

  const [showCreateAgentForm, setShowCreateAgentForm] = useState(false);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentCompanyType, setNewAgentCompanyType] = useState<"legal" | "entrepreneur" | "individual">("legal");
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const [newAgentPhone, setNewAgentPhone] = useState("");
  const [newAgentLegalTitle, setNewAgentLegalTitle] = useState("");
  const [createAgentLoading, setCreateAgentLoading] = useState(false);
  const [createAgentError, setCreateAgentError] = useState<string | null>(null);

  const [attributes, setAttributes] = useState<ShipmentAttribute[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(true);
  const [attributesError, setAttributesError] = useState<string | null>(null);
  const [vin, setVin] = useState("");
  const [description, setDescription] = useState("");
  const [applicable, setApplicable] = useState(false);

  const [positions, setPositions] = useState<Position[]>([]);
  const [stockByAssortment, setStockByAssortment] = useState<
    Record<string, { quantity: number; reserve?: number; available?: number; slotName?: string; cost?: number }>
  >({});
  const [cellByAssortment, setCellByAssortment] = useState<Record<string, number | string>>({});
  const [productSearch, setProductSearch] = useState("");
  const [productOem, setProductOem] = useState("");
  const [productMannName, setProductMannName] = useState("");
  const [productParams, setProductParams] = useState("");
  const [productSearchMode, setProductSearchMode] = useState<ProductSearchMode>("all");
  const [productOptions, setProductOptions] = useState<Product[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [productSearchError, setProductSearchError] = useState<string | null>(null);

  const [submitLoading, setSubmitLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [momentStr, setMomentStr] = useState("");
  const [vinLookupLoading, setVinLookupLoading] = useState(false);
  const [vinLookupResult, setVinLookupResult] = useState<VinLookupResult | null>(null);
  const [vinResultTab, setVinResultTab] = useState<"recommendations" | "oils" | "filters" | "other">("recommendations");
  const [showAllOilGroups, setShowAllOilGroups] = useState(false);
  const [maintenanceCopyStatus, setMaintenanceCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [manualEngineVolume, setManualEngineVolume] = useState("");
  const [manualEnginePower, setManualEnginePower] = useState("");
  const [showVehicleOverrideDialog, setShowVehicleOverrideDialog] = useState(false);
  const [vehicleOverridePromptVin, setVehicleOverridePromptVin] = useState("");

  const [demandIdLocal, setDemandIdLocal] = useState<string | null>(null);
  const [existingDemandName, setExistingDemandName] = useState<string | null>(null);
  const [existingDemandLoading, setExistingDemandLoading] = useState(Boolean(demandId));
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saved" | "error">("idle");
  const [copyNotice, setCopyNotice] = useState(copied);
  const [diagnosticModalOpen, setDiagnosticModalOpen] = useState(false);
  const [diagnosticRowId, setDiagnosticRowId] = useState<string | null>(null);
  const [summarySheetOpen, setSummarySheetOpen] = useState(false);

  const markDraftDirty = useCallback(() => {
    if (isExistingDraft) setSaveState("dirty");
  }, [isExistingDraft]);

  useEffect(() => {
    if (prefillApplied) return;
    if (prefillCounterparty) {
      setAgentSearch(prefillCounterparty);
      setNewAgentName(prefillCounterparty);
    }
    if (prefillPhone) setNewAgentPhone(prefillPhone);
    if (!isExistingDraft) {
      const descriptionLines = [
        prefillComment,
        prefillVehicle ? `Автомобиль: ${prefillVehicle}` : "",
        prefillPlate ? `Госномер: ${prefillPlate}` : "",
        prefillVin ? `VIN: ${prefillVin}` : "",
      ].filter(Boolean);
      if (descriptionLines.length > 0) setDescription(descriptionLines.join("\n"));
      if (prefillVin) setVin(prefillVin);
    }
    setPrefillApplied(true);
  }, [isExistingDraft, prefillApplied, prefillComment, prefillCounterparty, prefillPhone, prefillPlate, prefillVehicle, prefillVin]);

  useEffect(() => {
    if (!prefillCounterparty || selectedAgent || agentOptions.length === 0) return;
    const expected = prefillCounterparty.trim().toLowerCase();
    const exact = agentOptions.find((item) => item.name.trim().toLowerCase() === expected);
    if (!exact) return;
    setSelectedAgent(exact);
    setAgentSearch(exact.name);
    setAgentOptions([]);
  }, [agentOptions, prefillCounterparty, selectedAgent]);

  useEffect(() => {
    setMomentStr(toServiceMomentString());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((r) => safeJson<SessionJson>(r, {}))
      .then(async (data) => {
        if (cancelled) return;
        if (!data?.user) {
          router.push("/login?from=/shipment/new");
          return;
        }
        if (data.user.role === "admin" || data.user.role === "master") {
          const shift = await fetch("/api/shifts/current").then((r) => (r.ok ? safeJson<{ shift?: unknown } | null>(r, null) : null));
          if (cancelled) return;
          if (!shift) {
            router.push(data.user.role === "admin" ? "/cash?needShift=1" : "/?needShift=1");
            return;
          }
          if (data.user.role === "admin") {
            const cash = await fetch("/api/cash").then((r) => (r.ok ? safeJson<{ shift?: unknown } | null>(r, null) : null));
            if (cancelled) return;
            if (!cash?.shift) {
              router.push("/cash?needShift=1");
              return;
            }
          }
        }
        setAuthChecked(true);
      })
      .catch(() => {
        if (!cancelled) router.push("/login?from=/shipment/new");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadOrganizations = useCallback(async () => {
    setLoadingOrgs(true);
    try {
      const res = await fetch("/api/moysklad/organizations");
      if (res.status === 401) {
        router.push("/login?from=/shipment/new");
        return;
      }
      const data = await safeJson<OrganizationsJson>(res, {});
      if (res.ok && data.organizations) {
        setOrganizations(data.organizations);
        if (!selectedOrg && data.organizations.length > 0) setSelectedOrg(data.organizations[0]);
      }
    } catch {
      setOrganizations([]);
    } finally {
      setLoadingOrgs(false);
    }
  }, [router, selectedOrg]);

  const loadStores = useCallback(async () => {
    setLoadingStores(true);
    try {
      const res = await fetch("/api/moysklad/stores");
      if (res.status === 401) {
        router.push("/login?from=/shipment/new");
        return;
      }
      const data = await safeJson<StoresJson>(res, {});
      if (res.ok && data.stores) {
        setStores(data.stores);
        if (!selectedStore && data.stores.length > 0) {
          const main = data.stores.find((s: Store) => s.isMain || (s.name ?? "").toLowerCase().includes("основной"));
          setSelectedStore(main ?? data.stores[0]);
        }
      }
    } catch {
      setStores([]);
    } finally {
      setLoadingStores(false);
    }
  }, [router, selectedStore]);

  const loadAttributeMetadata = useCallback(async () => {
    setAttributesLoading(true);
    setAttributesError(null);
    try {
      const res = await fetch("/api/demands/metadata");
      const data = await safeJson<AttributesJson>(res, {});
      if (!res.ok || data.error) {
        setAttributesError(data.error ?? "Не удалось загрузить дополнительные поля");
        return;
      }
      if (data.attributes) {
        const nextAttributes = data.attributes.map((attribute: ShipmentAttribute) => {
          const name = String(attribute.name ?? "").toLowerCase();
          if (prefillVin && /vin/i.test(name)) return { ...attribute, value: prefillVin };
          if (prefillPlate && /гос|номер|plate/i.test(name)) return { ...attribute, value: prefillPlate };
          if (prefillVehicle && /модель|авто|vehicle|car/i.test(name)) return { ...attribute, value: prefillVehicle };
          return attribute;
        });
        setAttributes(nextAttributes);
        const vinIdx = nextAttributes.findIndex((a: { name: string }) => /vin/i.test(a.name ?? ""));
        if (vinIdx >= 0) setVin((prev) => prev || String(nextAttributes[vinIdx]?.value ?? ""));
      }
    } catch (error) {
      setAttributesError(error instanceof Error ? error.message : "Не удалось загрузить дополнительные поля");
    } finally {
      setAttributesLoading(false);
    }
  }, [prefillPlate, prefillVehicle, prefillVin]);

  useEffect(() => {
    if (!authChecked) return;
    loadOrganizations();
    loadStores();
  }, [authChecked, loadOrganizations, loadStores]);

  useEffect(() => {
    if (!selectedOrg || organizations.length === 0) return;
    if (organizations.some((org) => org.id === selectedOrg.id)) return;
    const matched = organizations.find((org) => org.name === selectedOrg.name);
    if (matched) setSelectedOrg(matched);
  }, [organizations, selectedOrg]);

  useEffect(() => {
    if (!selectedStore || stores.length === 0) return;
    if (stores.some((store) => store.id === selectedStore.id)) return;
    const matched = stores.find((store) => store.name === selectedStore.name);
    if (matched) setSelectedStore(matched);
  }, [stores, selectedStore]);

  useEffect(() => {
    if (!authChecked || !demandId) {
      if (!demandId) setExistingDemandLoading(false);
      return;
    }
    const existingId = demandId;
    let cancelled = false;
    async function loadExistingDemand() {
      setExistingDemandLoading(true);
      setSubmitError(null);
      try {
        const res = await fetch(`/api/demands/${encodeURIComponent(existingId)}`, { cache: "no-store" });
        const json = await safeJson<DemandDetailJson>(res, {});
        if (!res.ok || !json.header) {
          setSubmitError(json.error ?? "Ошибка загрузки отгрузки");
          return;
        }
        if (cancelled) return;
        if (json.header.applicable) {
          router.replace(`/shipment/${encodeURIComponent(existingId)}`);
          return;
        }
        setDemandIdLocal(json.header.id);
        setExistingDemandName(json.header.name);
        setDescription(json.header.description ?? "");
        setApplicable(Boolean(json.header.applicable));
        setMomentStr(json.header.moment ? toServiceMomentString(json.header.moment) : toServiceMomentString());
        const atts = Array.isArray(json.attributes) ? json.attributes : [];
        setAttributes(atts);
        setAttributesError(null);
        setAttributesLoading(false);
        const vinAttr = atts.find((a) => typeof a.name === "string" && /vin/i.test(a.name));
        setVin(typeof vinAttr?.value === "string" ? vinAttr.value : vinAttr?.value != null ? String(vinAttr.value) : "");
        setPositions(
          (json.positions ?? []).map((p) => {
            const priceRub = (Number(p.price) || 0) / 100;
            const discount = typeof p.discount === "number" ? p.discount : 0;
            const lineBase = (Number(p.quantity) || 0) * priceRub;
            return {
              ...p,
              price: priceRub,
              discount,
              discountMode: "percent",
              discountAmount: lineBase * (discount / 100),
            };
          })
        );
        const rawAgent = json.raw?.agent;
        if (rawAgent?.meta) {
          setSelectedAgent({
            id: rawAgent.id ?? localEntityIdFromMeta(rawAgent.meta),
            name: rawAgent.name ?? json.header.agentName ?? "Контрагент",
            meta: rawAgent.meta,
          });
          setAgentSearch(rawAgent.name ?? json.header.agentName ?? "");
          setAgentOptions([]);
        }
        const rawStore = json.raw?.store;
        if (rawStore?.meta) {
          setSelectedStore({
            id: rawStore.id ?? localEntityIdFromMeta(rawStore.meta),
            name: rawStore.name ?? json.header.storeName ?? "Склад",
            meta: rawStore.meta,
            isMain: rawStore.isMain,
          });
        }
        const rawOrganization = json.raw?.organization;
        if (rawOrganization?.meta) {
          setSelectedOrg({
            id: rawOrganization.id ?? localEntityIdFromMeta(rawOrganization.meta),
            name: rawOrganization.name ?? json.header.organizationName ?? "Организация",
            meta: rawOrganization.meta,
          });
        }
        setSaveState("saved");
      } catch (e) {
        if (!cancelled) {
          setSubmitError(e instanceof Error ? e.message : "Ошибка загрузки отгрузки");
          setSaveState("error");
        }
      } finally {
        if (!cancelled) {
          setExistingDemandLoading(false);
          setAttributesLoading(false);
        }
      }
    }
    void loadExistingDemand();
    return () => {
      cancelled = true;
    };
  }, [authChecked, demandId, router]);

  const positionAssortmentKey = positions.map((p) => p.assortmentMeta?.href ?? "").sort().join(",");
  useEffect(() => {
    if (!selectedStore || positions.length === 0) {
      setStockByAssortment({});
      return;
    }
    const hrefs = positions.map((p) => p.assortmentMeta?.href).filter(Boolean) as string[];
    if (hrefs.length === 0) {
      setStockByAssortment({});
      return;
    }
    let cancelled = false;
    const storeId = selectedStore.id ? `&storeId=${encodeURIComponent(selectedStore.id)}` : "";
    fetch(
      `/api/stock?storeName=${encodeURIComponent(selectedStore.name)}&assortmentHrefs=${encodeURIComponent(hrefs.join(","))}${storeId}`
    )
      .then((r) => safeJson<StockJson>(r, {}))
      .then((data) => {
        if (!cancelled && data.stockByAssortment) setStockByAssortment(data.stockByAssortment);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedStore, positionAssortmentKey]);

  useEffect(() => {
    if (!authChecked) return;
    if (positions.length === 0) {
      setCellByAssortment({});
      return;
    }
    const hrefs = positions.map((p) => p.assortmentMeta?.href).filter(Boolean) as string[];
    if (hrefs.length === 0) {
      setCellByAssortment({});
      return;
    }
    let cancelled = false;
    fetch(`/api/moysklad/product-cells?hrefs=${encodeURIComponent(hrefs.join(","))}`)
      .then((r) => safeJson<Record<string, number | string>>(r, {}))
      .then((data) => {
        if (!cancelled && typeof data === "object" && data !== null) setCellByAssortment(data as Record<string, number | string>);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authChecked, positionAssortmentKey]);

  useEffect(() => {
    if (!authChecked) return;
    if (demandId) return;
    void loadAttributeMetadata();
  }, [authChecked, demandId, loadAttributeMetadata]);

  useEffect(() => {
    if (!authChecked || selectedAgent || !agentSearch.trim()) {
      if (!agentSearch.trim()) {
        setAgentSearchError(null);
        setAgentLoading(false);
      }
      return;
    }
    let cancelled = false;
    setAgentLoading(true);
    setAgentSearchError(null);
    const t = setTimeout(() => {
      fetch(`/api/moysklad/counterparties?search=${encodeURIComponent(agentSearch)}&limit=20`)
        .then(async (r) => {
          const data = await safeJson<CounterpartiesJson>(r, {});
          if (!r.ok) throw new Error(data.error ?? "Не удалось загрузить контрагентов");
          return data;
        })
        .then((data) => {
          if (cancelled) return;
          setAgentOptions(data.counterparties ?? []);
        })
        .catch((error) => {
          if (cancelled) return;
          setAgentOptions([]);
          setAgentSearchError(error instanceof Error ? error.message : "Не удалось загрузить контрагентов");
        })
        .finally(() => {
          if (!cancelled) setAgentLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [authChecked, selectedAgent, agentSearch]);

  const loadInitialCounterparties = useCallback(() => {
    if (!authChecked || selectedAgent || agentSearch.trim()) return;
    setAgentLoading(true);
    setAgentSearchError(null);
    fetch("/api/moysklad/counterparties?limit=30")
      .then(async (r) => {
        const data = await safeJson<CounterpartiesJson>(r, {});
        if (!r.ok) throw new Error(data.error ?? "Не удалось загрузить контрагентов");
        return data;
      })
      .then((data) => {
        setAgentOptions(data.counterparties ?? []);
      })
      .catch((error) => {
        setAgentOptions([]);
        setAgentSearchError(error instanceof Error ? error.message : "Не удалось загрузить контрагентов");
      })
      .finally(() => setAgentLoading(false));
  }, [authChecked, selectedAgent, agentSearch]);

  useEffect(() => {
    const hasQuery = productSearchMode === "service" || [productSearch.trim(), productOem.trim(), productMannName.trim(), productParams.trim()].some(Boolean);
    if (!hasQuery) {
      setProductOptions([]);
      setProductSearchError(null);
      setProductSearchLoading(false);
      return;
    }
    let cancelled = false;
    setProductSearchLoading(true);
    setProductSearchError(null);
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (productSearch.trim()) params.set("search", productSearch.trim());
      if (productOem.trim()) params.set("oem", productOem.trim());
      if (productMannName.trim()) params.set("mannName", productMannName.trim());
      if (productParams.trim()) params.set("params", productParams.trim());
      if (productSearchMode !== "all") params.set("entityType", productSearchMode);
      if (selectedStore?.id) params.set("storeId", selectedStore.id);
      if (selectedStore?.name) params.set("storeName", selectedStore.name);
      params.set("limit", "50");
      fetch(`/api/moysklad/products?${params.toString()}`)
        .then(async (r) => {
          const data = await safeJson<ProductsJson>(r, {});
          if (!r.ok) {
            throw new Error(
              data.error ??
                (productSearchMode === "service"
                  ? "Не удалось загрузить услуги"
                  : productSearchMode === "product"
                    ? "Не удалось загрузить товары"
                    : "Не удалось загрузить позиции")
            );
          }
          return data;
        })
        .then((data) => {
          if (cancelled) return;
          setProductOptions(data.products ?? []);
        })
        .catch((error) => {
          if (cancelled) return;
          setProductOptions([]);
          setProductSearchError(
            error instanceof Error
              ? error.message
              : productSearchMode === "service"
                ? "Не удалось загрузить услуги"
                : productSearchMode === "product"
                  ? "Не удалось загрузить товары"
                  : "Не удалось загрузить позиции"
          );
        })
        .finally(() => {
          if (!cancelled) setProductSearchLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [productSearch, productOem, productMannName, productParams, productSearchMode, selectedStore?.id, selectedStore?.name]);

  const openCreateAgentForm = () => {
    setNewAgentName(agentSearch.trim() || "");
    setNewAgentEmail("");
    setNewAgentPhone("");
    setNewAgentLegalTitle("");
    setNewAgentCompanyType("legal");
    setCreateAgentError(null);
    setShowCreateAgentForm(true);
  };

  const handleCreateAgent = async () => {
    const name = newAgentName.trim();
    if (!name) {
      setCreateAgentError("Введите наименование");
      return;
    }
    setCreateAgentError(null);
    setCreateAgentLoading(true);
    try {
      const res = await fetch("/api/moysklad/counterparties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          companyType: newAgentCompanyType,
          email: newAgentEmail.trim() || undefined,
          phone: newAgentPhone.trim() || undefined,
          legalTitle: newAgentLegalTitle.trim() || undefined,
        }),
      });
      const data = await safeJson<AgentCreateJson>(res, {});
      if (!res.ok) {
        setCreateAgentError(data.error ?? "Ошибка создания");
        return;
      }
      if (!data.id || !data.name || !data.meta) {
        setCreateAgentError("Сервер не вернул созданного клиента");
        return;
      }
      setSelectedAgent({ id: data.id, name: data.name, meta: data.meta });
      setAgentSearch(data.name);
      setAgentOptions([]);
      setShowCreateAgentForm(false);
    } catch (e) {
      setCreateAgentError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setCreateAgentLoading(false);
    }
  };

  const addPosition = (p: Product) => {
    if (positions.some((r) => r.assortmentMeta?.href === p.meta.href)) return;
    setPositions((prev) => [
      ...prev,
      {
        name: p.name,
        quantity: 1,
        price: p.price,
        discount: 0,
        discountMode: "percent",
        discountAmount: 0,
        assortmentMeta: p.meta,
        cell: p.cell ?? undefined,
        slotName: p.slotName ?? p.cell ?? undefined,
        stock: {
          cost: p.cost,
          quantity: p.stockQuantity,
          reserve: p.reserveQuantity,
          available: p.availableQuantity,
        },
      },
    ]);
    setProductSearch("");
    setProductOptions([]);
    markDraftDirty();
  };

  const focusProductSearch = () => {
    window.requestAnimationFrame(() => document.getElementById("shipment-product-search")?.focus());
  };

  const openProductSearch = () => {
    setProductSearchMode("product");
    focusProductSearch();
  };

  const openServiceSearch = () => {
    setProductSearchMode("service");
    setProductOem("");
    setProductMannName("");
    setProductParams("");
    focusProductSearch();
  };

  const runVinLookup = useCallback(async (vehicleOverrides?: { displacementL?: string; enginePowerPS?: string }) => {
    const vinClean = vin.replace(/\s/g, "").toUpperCase();
    if (vinClean.length < 8) return;
    const hasOverrides = Boolean(vehicleOverrides?.displacementL?.trim() || vehicleOverrides?.enginePowerPS?.trim());
    setVinLookupLoading(true);
    setVinLookupResult(null);
    setVinResultTab("recommendations");
    setShowAllOilGroups(false);
    setMaintenanceCopyStatus("idle");
    setShowVehicleOverrideDialog(false);
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vin: vinClean,
          vehicleOverrides: hasOverrides ? vehicleOverrides : undefined,
        }),
      });
      const data = await safeJson<VinLookupResult>(res, {
        vin: vinClean,
        decoded: null,
        moySkladItems: [],
        decodeError: "Пустой ответ подбора",
      });
      setVinLookupResult(data as VinLookupResult);
      const decoded = (data as VinLookupResult).decoded;
      if (decoded?.displacementL) setManualEngineVolume(decoded.displacementL);
      if (typeof decoded?.enginePowerPS === "number" && decoded.enginePowerPS > 0) {
        setManualEnginePower(String(decoded.enginePowerPS));
      }
      const hasEngineIdentity = Boolean(
        decoded?.engineSeries?.trim() ||
          decoded?.displacementL?.trim() ||
          (typeof decoded?.enginePowerPS === "number" && decoded.enginePowerPS > 0)
      );
      if (decoded && !hasOverrides && !hasEngineIdentity) {
        setVehicleOverridePromptVin(vinClean);
        setManualEngineVolume(decoded.displacementL ?? "");
        setManualEnginePower(typeof decoded.enginePowerPS === "number" && decoded.enginePowerPS > 0 ? String(decoded.enginePowerPS) : "");
        setShowVehicleOverrideDialog(true);
      }
      if (decoded && (decoded.make || decoded.model || decoded.modelYear)) {
        setAttributes((prev) =>
          prev.map((a) => {
            const name = normalizeAttrName(a.name);
            if (name === "модель авто") {
              const val = [decoded.make, decoded.model].filter(Boolean).join(" ").trim();
              return { ...a, value: val || null };
            }
            if (name === "год") {
              const val = (decoded.modelYear ?? "").trim();
              return { ...a, value: val || null };
            }
            if (name === "объем") {
              const val = (data as VinLookupResult).oilInfo?.fillVolumeLiters?.trim();
              if (val && !String(a.value ?? "").trim()) return { ...a, value: val };
            }
            return a;
          })
        );
        markDraftDirty();
      }
    } catch {
      setVinLookupResult({
        vin: vinClean,
        decoded: null,
        moySkladItems: [],
        decodeError: "Ошибка запроса",
      });
    } finally {
      setVinLookupLoading(false);
    }
  }, [markDraftDirty, vin]);

  const addFromVinLookup = useCallback((items: VinLookupItem[], desiredByProductId?: Record<string, number>) => {
    setPositions((prev) => {
      const next = [...prev];
      const indexByHref = new Map(next.map((p, index) => [p.assortmentMeta?.href, index] as const));
      for (const it of items) {
        if (!it.productId) continue;
        const maxAvailable = Math.max(0, Math.floor(it.quantity || 0));
        const rawDesired = desiredByProductId?.[it.productId];
        const desiredQuantity =
          typeof rawDesired === "number" && Number.isFinite(rawDesired)
            ? Math.max(0, rawDesired)
            : rawDesired == null
              ? maxAvailable > 0
                ? 1
                : 0
              : 0;
        if (desiredQuantity <= 0) continue;
        const capped = maxAvailable > 0 ? Math.min(desiredQuantity, maxAvailable) : 0;
        if (capped <= 0) continue;
        const meta: Meta = {
          href: `local://product/${it.productId}`,
          type: "product",
          mediaType: "application/json",
        };
        const existingIndex = indexByHref.get(meta.href);
        if (existingIndex != null) {
          const existing = next[existingIndex];
          next[existingIndex] = {
            ...existing,
            quantity: (existing.quantity || 0) + capped,
          };
          continue;
        }
        next.push({
          name: it.name,
          quantity: capped,
          price: it.price,
          discount: 0,
          discountMode: "percent",
          discountAmount: 0,
          assortmentMeta: meta,
          cell: it.cell ?? undefined,
        });
        indexByHref.set(meta.href, next.length - 1);
      }
      return next;
    });
  }, []);

  const copyMaintenanceMessage = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMaintenanceCopyStatus("copied");
      window.setTimeout(() => setMaintenanceCopyStatus("idle"), 2500);
    } catch {
      setMaintenanceCopyStatus("error");
      window.setTimeout(() => setMaintenanceCopyStatus("idle"), 3500);
    }
  }, []);

  const removePosition = (index: number) => {
    const position = positions[index];
    if (position && !window.confirm(`Удалить позицию «${position.name}» из отгрузки?`)) return;
    setPositions((prev) => prev.filter((_, i) => i !== index));
    markDraftDirty();
  };

  const ensureDemandForDiagnostic = async (): Promise<string | null> => {
    if (demandIdLocal) return demandIdLocal;
    if (!selectedOrg || !selectedStore || !selectedAgent) {
      setSubmitError("Укажите организацию, склад и контрагента перед диагностикой");
      return null;
    }
    setSubmitError(null);
    setSubmitLoading(true);
    try {
      const atts = attributes.map((a) => {
        const name = normalizeAttrName(a.name);
        if (name.includes("vin")) return { ...a, value: vin };
        return a;
      });
      const body = {
        organization: { meta: selectedOrg.meta },
        agent: { meta: selectedAgent.meta },
        store: { meta: selectedStore.meta },
        description: description.trim() || undefined,
        applicable,
        moment: momentStr || toServiceMomentString(),
        attributes: atts,
        positions:
          positions.length > 0
            ? positions.map((p) => ({
                quantity: p.quantity,
                price: Number(p.price) || 0,
                discount: typeof p.discount === "number" ? p.discount : 0,
                assortment: p.assortmentMeta ? { meta: p.assortmentMeta } : undefined,
              }))
            : undefined,
      };
      const res = await fetch("/api/demands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeJson<DemandCreateJson>(res, {});
      if (!res.ok) {
        setSubmitError(data.error ?? "Ошибка создания отгрузки");
        return null;
      }
      if (!data.id) {
        setSubmitError("Локальная БД не вернула ID созданной отгрузки");
        return null;
      }
      return data.id as string;
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Ошибка сети");
      return null;
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleOpenDiagnostic = async () => {
    setSubmitError(null);
    try {
      const sid = demandIdLocal ?? (await ensureDemandForDiagnostic());
      if (!sid) return;
      setDemandIdLocal(sid);

      const attrVal = (needle: string) => getAttributeString(attributes, (name) => name.includes(needle));
      const modelCombined = attrVal("модель авто") || attrVal("модель");
      const modelParts = modelCombined.split(/\s+/).filter(Boolean);
      const yearStr = attrVal("год");
      const plateStr = attrVal("гос") || attrVal("номер");
      const mileageStr = attrVal("пробег");
      const dec = vinLookupResult?.decoded;
      const vehicleHints = inferDiagnosticVehicleHintsFromLookup(vinLookupResult);

      let diagId = diagnosticRowId;
      const existingRes = await fetch(`/api/diagnostics/for-shipment?shipmentId=${encodeURIComponent(sid)}`);
      const existingJson = await safeJson<DiagnosticExistingJson>(existingRes, {});
      if (!existingRes.ok) {
        setSubmitError(existingJson.error ?? "Не удалось проверить существующую диагностику");
        return;
      }
      if (existingJson.diagnostic?.id) {
        diagId = existingJson.diagnostic.id as string;
      } else {
        const createRes = await fetch("/api/diagnostics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipmentId: sid,
            clientId: selectedAgent?.id ?? null,
            clientName: selectedAgent?.name ?? null,
            vin: vin.replace(/\s/g, "").toUpperCase() || null,
            brand: dec?.make || modelParts[0] || null,
            model: dec?.model || modelParts.slice(1).join(" ") || null,
            year: yearStr ? parseInt(yearStr, 10) || null : dec?.modelYear ? parseInt(dec.modelYear, 10) || null : null,
            licensePlate: plateStr || null,
            mileage: mileageStr ? parseInt(mileageStr.replace(/\D/g, ""), 10) || null : null,
            vehicleHints,
          }),
        });
        const createJson = await safeJson<DiagnosticCreateJson>(createRes, {});
        if (!createRes.ok) {
          setSubmitError(createJson.error ?? "Не удалось создать диагностику");
          return;
        }
        diagId = createJson.diagnosticId as string;
      }

      setDiagnosticRowId(diagId);
      setDiagnosticModalOpen(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Не удалось открыть диагностику");
    }
  };

  const handleSubmit = async () => {
    if (!selectedOrg || !selectedStore || !selectedAgent) {
      setSubmitError("Укажите организацию, склад и контрагента");
      return;
    }
    setSubmitError(null);
    setSaveState("idle");
    setSubmitLoading(true);
    try {
      const atts = attributes.map((a) => {
        const name = normalizeAttrName(a.name);
        if (name.includes("vin")) return { ...a, value: vin };
        return a;
      });
      const body = {
        organization: { meta: selectedOrg.meta },
        agent: { meta: selectedAgent.meta },
        store: { meta: selectedStore.meta },
        description: description.trim() || undefined,
        applicable,
        moment: momentStr || toServiceMomentString(),
        attributes: atts,
        positions:
          positions.length > 0
            ? positions.map((p) => ({
                id: isExistingDraft ? p.id : undefined,
                quantity: p.quantity,
                price: isExistingDraft ? Math.round((Number(p.price) || 0) * 100) : Number(p.price) || 0,
                discount: typeof p.discount === "number" ? p.discount : 0,
                assortment: p.assortmentMeta ? { meta: p.assortmentMeta } : undefined,
              }))
            : undefined,
      };
      const endpoint = isExistingDraft && demandIdLocal ? `/api/demands/${encodeURIComponent(demandIdLocal)}` : "/api/demands";
      const res = await fetch(endpoint, {
        method: isExistingDraft && demandIdLocal ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeJson<DemandCreateJson>(res, {});
      if (!res.ok) {
        setSubmitError(data.error ?? (isExistingDraft ? "Ошибка сохранения отгрузки" : "Ошибка создания отгрузки"));
        setSaveState("error");
        return;
      }
      const nextId = data.id ?? demandIdLocal;
      if (!nextId) {
        setSubmitError("Локальная БД не вернула ID отгрузки");
        setSaveState("error");
        return;
      }
      setDemandIdLocal(nextId);
      if (data.name) setExistingDemandName(data.name);
      setSaveState("saved");
      if (applicable) {
        router.push(`/shipment/${nextId}`);
      } else if (!isExistingDraft) {
        router.push(`/shipment/${nextId}/edit`);
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Ошибка сети");
      setSaveState("error");
    } finally {
      setSubmitLoading(false);
    }
  };

  const saveDraftBeforeExternalAction = async (actionLabel: string, confirmMessage: string): Promise<boolean> => {
    if (!demandIdLocal) return false;
    if (!selectedOrg || !selectedStore || !selectedAgent) {
      const missingBeforePrint = [
        !selectedOrg ? "организация" : null,
        !selectedStore ? "склад" : null,
        !selectedAgent ? "клиент" : null,
      ].filter(Boolean);
      setSubmitError(`Перед ${actionLabel} нужно заполнить: ${missingBeforePrint.join(", ")}`);
      setSaveState("error");
      return false;
    }
    if (applicable) {
      const ok = window.confirm(confirmMessage);
      if (!ok) return false;
    }
    setSubmitError(null);
    setSubmitLoading(true);
    try {
      const atts = attributes.map((a) => {
        const name = normalizeAttrName(a.name);
        if (name.includes("vin")) return { ...a, value: vin };
        return a;
      });
      const res = await fetch(`/api/demands/${encodeURIComponent(demandIdLocal)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: { meta: selectedOrg.meta },
          agent: { meta: selectedAgent.meta },
          store: { meta: selectedStore.meta },
          description: description.trim() || undefined,
          applicable: false,
          moment: momentStr || toServiceMomentString(),
          attributes: atts,
          positions: positions.map((p) => ({
            id: p.id,
            quantity: p.quantity,
            price: Math.round((Number(p.price) || 0) * 100),
            discount: typeof p.discount === "number" ? p.discount : 0,
            assortment: p.assortmentMeta ? { meta: p.assortmentMeta } : undefined,
          })),
        }),
      });
      const data = await safeJson<DemandCreateJson>(res, {});
      if (!res.ok) {
        setSubmitError(data.error ?? `Не удалось сохранить черновик перед ${actionLabel}`);
        setSaveState("error");
        return false;
      }
      setApplicable(false);
      setSaveState("saved");
      return true;
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : `Ошибка сохранения перед ${actionLabel}`);
      setSaveState("error");
      return false;
    } finally {
      setSubmitLoading(false);
    }
  };

  const saveDraftBeforePrint = () =>
    saveDraftBeforeExternalAction(
      "печатью",
      "Печать не проводит документ. Сохранить текущие данные как черновик перед печатью?"
    );

  const handleOpenPrecheck = async () => {
    if (!demandIdLocal) {
      setSubmitError("Сначала сохраните отгрузку");
      return;
    }
    const precheckWindow = window.open("about:blank", "_blank");
    precheckWindow?.document.write("<!doctype html><title>Предчек</title><body>Открываем предчек...</body>");
    setPaying(true);
    try {
      const saved = await saveDraftBeforeExternalAction(
        "открытием предчека",
        "Предчек не проводит документ. Сохранить текущие данные как черновик перед открытием предчека?"
      );
      if (!saved) {
        precheckWindow?.close();
        return;
      }
      const url = `/shipment/${encodeURIComponent(demandIdLocal)}/precheck`;
      if (precheckWindow) precheckWindow.location.href = url;
      else router.push(url);
    } catch (e) {
      precheckWindow?.close();
      setSubmitError(e instanceof Error ? e.message : "Ошибка открытия предчека");
      setSaveState("error");
    } finally {
      setPaying(false);
    }
  };

  const vinAttrIndex = attributes.findIndex((a) => typeof a?.name === "string" && /vin/i.test(a.name));
  const editableAttributes = attributes
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => EDITABLE_ATTR_NAMES.includes(normalizeAttrName(a.name)));
  const getPositionStock = useCallback(
    (position: Position) => {
      const href = position.assortmentMeta?.href ?? "";
      return position.stock ?? stockByAssortment[href] ?? null;
    },
    [stockByAssortment]
  );
  const positionsQty = positions.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const positionsSubtotal = positions.reduce((sum, p) => sum + (p.quantity || 0) * (p.price || 0), 0);
  const positionsTotal = positions.reduce((sum, p) => {
    const base = (p.quantity || 0) * (p.price || 0);
    const disc = typeof p.discount === "number" ? p.discount : 0;
    return sum + base * (1 - disc / 100);
  }, 0);
  const indexedPositions = positions.map((position, index) => ({ position, index }));
  const positionGroups = [
    {
      key: "services",
      title: "Услуги",
      items: indexedPositions.filter(({ position }) => isServiceMeta(position.assortmentMeta)),
    },
    {
      key: "products",
      title: "Товары",
      items: indexedPositions.filter(({ position }) => !isServiceMeta(position.assortmentMeta)),
    },
  ].filter((group) => group.items.length > 0);
  const positionsDiscount = Math.max(0, positionsSubtotal - positionsTotal);
  const hasIncompleteCost = positions.some((p) => {
    const stock = getPositionStock(p);
    return typeof stock?.cost !== "number" || !Number.isFinite(stock.cost);
  });
  const positionsCost = hasIncompleteCost
    ? null
    : positions.reduce((sum, p) => sum + ((getPositionStock(p)?.cost ?? 0) * (p.quantity || 0)), 0);
  const positionsMargin = positionsCost == null ? null : positionsTotal - positionsCost;
  const positionsMarginPct = positionsMargin != null && positionsTotal > 0 ? Math.round((positionsMargin / positionsTotal) * 100) : null;
  const readinessItems = [
    { key: "organization", label: "Организация", ready: Boolean(selectedOrg) },
    { key: "store", label: "Склад", ready: Boolean(selectedStore) },
    { key: "client", label: "Клиент", ready: Boolean(selectedAgent) },
  ];
  const readinessMissing = readinessItems.filter((item) => !item.ready).map((item) => item.label.toLowerCase());
  const saveDisabledReason = readinessMissing.length > 0 ? `Не хватает: ${readinessMissing.join(", ")}` : "";
  const saveDisabled = submitLoading || readinessMissing.length > 0;
  const decodedVehicle = vinLookupResult?.decoded;
  const oilInfo = vinLookupResult?.oilInfo;
  const vehicleTitle =
    decodedVehicle
      ? [
          decodedVehicle.make,
          decodedVehicle.model,
          decodedVehicle.modification,
          decodedVehicle.modelYear,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  const vehicleSpecRows = [
    {
      label: "Двигатель",
      value:
        [
          decodedVehicle?.engineSeries,
          decodedVehicle?.displacementL ? `${decodedVehicle.displacementL} л` : null,
          decodedVehicle?.enginePowerPS ? `${decodedVehicle.enginePowerPS} л.с.` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
    },
    {
      label: "Коробка",
      value: oilInfo?.transmission?.gearbox ?? oilInfo?.transmission?.code ?? "—",
    },
    {
      label: "Заводская спец.",
      value: oilInfo?.approval ?? oilInfo?.acea?.join(", ") ?? oilInfo?.api?.join(", ") ?? "—",
    },
    {
      label: "Фильтр",
      value: oilInfo?.oilFilterMann ?? oilInfo?.oilFilterOem ?? "—",
      mono: true,
    },
    {
      label: "Интервал",
      value: "—",
    },
    {
      label: "Объём заливки",
      value: oilInfo?.fillVolumeLiters ? `${oilInfo.fillVolumeLiters} л` : "—",
    },
    {
      label: "Сливная пробка",
      value: oilInfo?.transmission?.fluid ?? "—",
      mono: true,
    },
  ];
  const hasProductSearchQuery = productSearchMode === "service" || [productSearch.trim(), productOem.trim(), productMannName.trim(), productParams.trim()].some(Boolean);
  const productSearchEntityLabel =
    productSearchMode === "service" ? "Услуга" : productSearchMode === "product" ? "Товар" : "Позиция";
  const productSearchLoadingLabel =
    productSearchMode === "service"
      ? "Ищем услуги в каталоге…"
      : productSearchMode === "product"
        ? "Ищем товары в каталоге…"
        : "Ищем товары и услуги в каталоге…";
  const productSearchErrorLabel =
    productSearchMode === "service"
      ? "Не удалось загрузить услуги"
      : productSearchMode === "product"
        ? "Не удалось загрузить товары"
        : "Не удалось загрузить позиции";
  const productSearchEmptyHint =
    productSearchMode === "service"
      ? "Попробуйте изменить запрос или найти услугу по другому названию."
      : productSearchMode === "product"
        ? "Попробуйте изменить запрос или воспользуйтесь расширенным поиском."
        : "Попробуйте изменить запрос или переключить поиск на услуги.";
  const showAgentSearchPanel =
    !selectedAgent && !showCreateAgentForm && (agentSearch.trim() || agentOptions.length > 0 || agentLoading || agentSearchError);
  const documentTitle = isExistingDraft ? `Отгрузка ${existingDemandName ?? demandIdLocal ?? demandId}` : "Новая отгрузка";
  const saveButtonLabel = submitLoading
    ? isExistingDraft
      ? "Сохранение..."
      : "Создание..."
    : isExistingDraft
      ? "Сохранить изменения"
      : "Сохранить отгрузку";
  const compactSaveButtonLabel = submitLoading ? (isExistingDraft ? "Сохранение..." : "Создание...") : "Сохранить";
  const statusText = applicable ? "проведена" : "черновик";

  if (existingDemandLoading) {
    return (
      <main className="eco-page eco-page--wide eco-shipment-new-page">
        <section className="eco-card eco-card--padded">
          <p className="eco-shipment-new-empty">Загрузка редактируемого черновика…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="eco-page eco-page--wide eco-shipment-new-page">
      {showVehicleOverrideDialog && (
        <div className="eco-shipment-new-modal fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="eco-card eco-card--padded w-full max-w-md text-sm">
            <div className="eco-shipment-new-modal-head">
              <div>
                <h2>Уточните данные двигателя</h2>
                <p className="eco-page-subtitle">
                  По VIN не удалось определить объём двигателя или мощность.
                </p>
              </div>
              <button type="button" className="eco-shipment-icon-btn" onClick={() => setShowVehicleOverrideDialog(false)} aria-label="Закрыть">
                <X className="eco-icon" aria-hidden />
              </button>
            </div>
            <div className="eco-shipment-new-modal-body">
              <div className="eco-shipment-new-modal-grid">
                <label className="eco-field">
                  <span>Объём двигателя, л</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualEngineVolume}
                    onChange={(e) => setManualEngineVolume(e.target.value)}
                    placeholder="Например: 1.8"
                    className="eco-input"
                  />
                </label>
                <label className="eco-field">
                  <span>Мощность, л.с.</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={manualEnginePower}
                    onChange={(e) => setManualEnginePower(e.target.value)}
                    placeholder="Например: 150"
                    className="eco-input"
                  />
                </label>
              </div>
              <div className="eco-actions eco-shipment-new-modal-actions">
                <EcoButton
                  type="button"
                  onClick={() => setShowVehicleOverrideDialog(false)}
                >
                  Продолжить без уточнения
                </EcoButton>
                <EcoButton
                  type="button"
                  disabled={!manualEngineVolume.trim() && !manualEnginePower.trim()}
                  onClick={() =>
                    runVinLookup({
                      displacementL: manualEngineVolume.trim() || undefined,
                      enginePowerPS: manualEnginePower.trim() || undefined,
                    })
                  }
                  variant="primary"
                >
                  <Sparkles className="eco-icon" aria-hidden />
                  Повторить подбор
                </EcoButton>
              </div>
              {vehicleOverridePromptVin && (
                <p className="eco-shipment-new-vin-note">VIN: {vehicleOverridePromptVin}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showCreateAgentForm && (
        <div className="eco-shipment-new-modal fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="eco-card eco-card--padded w-full max-w-lg text-sm">
            <div className="eco-shipment-card-head">
              <h2>Новый клиент</h2>
              <button type="button" className="eco-shipment-icon-btn" onClick={() => setShowCreateAgentForm(false)} aria-label="Закрыть">
                <X className="eco-icon" aria-hidden />
              </button>
            </div>
            <div className="eco-shipment-new-modal-body">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="eco-field sm:col-span-2">
                  <span>Наименование *</span>
                  <input
                    type="text"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    placeholder="ООО Компания или ФИО"
                    className="eco-input"
                  />
                </label>
                <label className="eco-field">
                  <span>Тип</span>
                  <select
                    value={newAgentCompanyType}
                    onChange={(e) => setNewAgentCompanyType(e.target.value as "legal" | "entrepreneur" | "individual")}
                    className="eco-input"
                  >
                    <option value="legal">Юридическое лицо</option>
                    <option value="entrepreneur">ИП</option>
                    <option value="individual">Физ. лицо</option>
                  </select>
                </label>
                <label className="eco-field">
                  <span>Телефон</span>
                  <input type="text" value={newAgentPhone} onChange={(e) => setNewAgentPhone(e.target.value)} className="eco-input" />
                </label>
                <label className="eco-field">
                  <span>Email</span>
                  <input type="email" value={newAgentEmail} onChange={(e) => setNewAgentEmail(e.target.value)} className="eco-input" />
                </label>
                <label className="eco-field">
                  <span>Юр. наименование</span>
                  <input
                    type="text"
                    value={newAgentLegalTitle}
                    onChange={(e) => setNewAgentLegalTitle(e.target.value)}
                    placeholder="если отличается"
                    className="eco-input"
                  />
                </label>
              </div>
              {createAgentError && <p className="eco-shipment-new-error mt-3">{createAgentError}</p>}
              <div className="eco-actions eco-shipment-new-modal-actions">
                <EcoButton type="button" onClick={() => setShowCreateAgentForm(false)}>
                  Отмена
                </EcoButton>
                <EcoButton type="button" onClick={handleCreateAgent} disabled={createAgentLoading} variant="primary">
                  <UserPlus className="eco-icon" aria-hidden />
                  {createAgentLoading ? "Создание..." : "Создать"}
                </EcoButton>
              </div>
            </div>
          </div>
        </div>
      )}

      <header className="eco-shipment-new-head">
        <div>
          <div className="eco-page-kicker">
            <Link href="/shipment">Операции / Отгрузки</Link>
            <span>{isExistingDraft ? " / Редактирование" : " / Новая"}</span>
          </div>
          <div className="eco-shipment-new-title-row">
            <h1 className="eco-page-title">{documentTitle}</h1>
            <EcoBadge tone={applicable ? "success" : "warning"} dot>
              {statusText}
            </EcoBadge>
          </div>
        </div>
        <div className="eco-actions">
          <Link href="/shipment" className="eco-btn eco-shipment-back-link">
            <ArrowLeft className="eco-icon" aria-hidden />
            К отгрузкам
          </Link>
        </div>
      </header>

      {copyNotice && (
        <div className="eco-shipment-copy-notice">
          <span>Отгрузка скопирована. Вы можете отредактировать черновик перед сохранением.</span>
          <button type="button" onClick={() => setCopyNotice(false)}>Закрыть</button>
        </div>
      )}

      {isExistingDraft && (saveState === "saved" || saveState === "dirty") && (
        <div className={`eco-shipment-save-state ${saveState === "dirty" ? "is-dirty" : ""}`}>
          {saveState === "dirty" ? "Есть несохранённые изменения" : "Сохранено"}
        </div>
      )}

      <section className="eco-shipment-step-strip" aria-label="Готовность отгрузки">
        <div className={selectedAgent ? "is-ready" : ""}>
          <span>01</span>
          <strong>Клиент</strong>
          <small>
            {selectedAgent ? (
              <Link href={counterpartyCatalogHref(selectedAgent)} className="eco-inline-entity-link">
                {selectedAgent.name}
              </Link>
            ) : (
              "Выберите или создайте клиента"
            )}
          </small>
        </div>
        <div className={vin.replace(/\s/g, "").length >= 8 ? "is-ready" : ""}>
          <span>02</span>
          <strong>Автомобиль</strong>
          <small>{vin.replace(/\s/g, "").length >= 8 ? vin : "VIN или данные для диагностики"}</small>
        </div>
        <div className={positions.length > 0 ? "is-ready" : ""}>
          <span>03</span>
          <strong>Позиции</strong>
          <small>{positions.length > 0 ? `${positions.length} строк · ${positionsQty} шт.` : "Добавьте товары или подбор ТО"}</small>
        </div>
        <div className={!saveDisabled ? "is-ready" : ""}>
          <span>04</span>
          <strong>Сохранение</strong>
          <small>{saveDisabledReason || "Можно сохранить отгрузку"}</small>
        </div>
      </section>

      <div className="eco-shipment-new-layout">
        <div className="eco-shipment-new-main">
      <section className="eco-card eco-card--padded eco-shipment-new-document">
        <div className="eco-shipment-card-head">
          <h2>Параметры документа</h2>
          <EcoBadge tone={selectedOrg && selectedStore ? "success" : "neutral"} dot>
            {selectedOrg && selectedStore ? "готово" : "частично"}
          </EcoBadge>
        </div>
        <div className="eco-shipment-new-document-grid">
          <label className="eco-field">
            <span>Организация</span>
            <select
              value={selectedOrg?.id ?? ""}
              onChange={(e) => setSelectedOrg(organizations.find((org) => org.id === e.target.value) ?? null)}
              disabled={loadingOrgs || organizations.length === 0}
              className="eco-input"
            >
              <option value="">{loadingOrgs ? "Загрузка..." : "Не выбрана"}</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            {!loadingOrgs && organizations.length === 0 && (
              <small className="eco-field-hint is-error">Нет локальных организаций. Запустите seed или импорт.</small>
            )}
          </label>
          <label className="eco-field">
            <span>Склад</span>
            <select
              value={selectedStore?.id ?? ""}
              onChange={(e) => setSelectedStore(stores.find((store) => store.id === e.target.value) ?? null)}
              disabled={loadingStores || stores.length === 0}
              className="eco-input"
            >
              <option value="">{loadingStores ? "Загрузка..." : "Не выбран"}</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                  {store.isMain ? " · основной" : ""}
                </option>
              ))}
            </select>
            {!loadingStores && stores.length === 0 && (
              <small className="eco-field-hint is-error">Нет локальных складов. Запустите seed или импорт.</small>
            )}
          </label>
          <label className="eco-field">
            <span>Дата</span>
            <input
              type="text"
              value={momentStr}
              onChange={(e) => setMomentStr(e.target.value)}
              placeholder="YYYY-MM-DD HH:mm:ss"
              className="eco-input"
            />
          </label>
        </div>
      </section>

      <section className="eco-card eco-shipment-new-client">
        <div className="eco-shipment-card-head">
          <h2>Клиент</h2>
          {selectedAgent && <EcoBadge tone="success" dot>выбран</EcoBadge>}
        </div>
        <div className="eco-shipment-card-body">
        <label className="eco-field eco-shipment-client-search">
          <span>Найти по имени / телефону / номеру</span>
        {agentLoading ? (
          <span className="eco-client-search-icon eco-search-spinner" aria-hidden />
        ) : (
          <Search className="eco-client-search-icon" aria-hidden />
        )}
        <input
          type="text"
          value={agentSearch}
          onChange={(e) => {
            setAgentSearch(e.target.value);
            setAgentSearchError(null);
            if (!e.target.value.trim()) setAgentOptions([]);
          }}
          onFocus={() => {
            if (selectedAgent) setAgentSearch(selectedAgent.name);
            else loadInitialCounterparties();
          }}
          placeholder="Например, +7 911..."
          className="eco-input"
        />
        </label>
        {!selectedAgent && !showCreateAgentForm && (
          <div className="eco-shipment-client-actions">
            <EcoButton type="button" onClick={openCreateAgentForm} variant="primary">
              <UserPlus className="eco-icon" aria-hidden />
              Новый клиент
            </EcoButton>
          </div>
        )}
        {selectedAgent && (
          <div className="eco-shipment-selected-client">
            <Link href={counterpartyCatalogHref(selectedAgent)} className="eco-linked-entity" title="Открыть контрагента">
              <strong>{selectedAgent.name}</strong>
              <ExternalLink className="eco-icon" aria-hidden />
            </Link>
            <button type="button" onClick={() => { setSelectedAgent(null); setAgentSearch(""); }}>
              <X className="eco-icon" aria-hidden />
              Сбросить
            </button>
          </div>
        )}
        {showAgentSearchPanel && (
          <div className="eco-counterparty-results" aria-live="polite">
            {agentLoading ? (
              <div className="eco-counterparty-results-state">
                <div className="eco-product-loading-copy">
                  <span className="eco-product-loading-spinner" aria-hidden />
                  <div>
                    <strong>Ищем контрагентов…</strong>
                    <span>Проверяем локальную базу клиентов.</span>
                  </div>
                </div>
                <div className="eco-product-skeleton-list" aria-hidden>
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="eco-counterparty-skeleton-row">
                      <div>
                        <span className="eco-skeleton-line is-title" />
                        <span className="eco-skeleton-line is-code" />
                      </div>
                      <span className="eco-skeleton-pill" />
                    </div>
                  ))}
                </div>
              </div>
            ) : agentSearchError ? (
              <div className="eco-counterparty-results-state is-error">
                <strong>Не удалось загрузить контрагентов</strong>
                <span>Повторите попытку.</span>
              </div>
            ) : agentOptions.length > 0 ? (
          <ul className="eco-counterparty-results-list">
            {agentOptions.map((a) => (
              <li key={a.id}>
                <div className="eco-counterparty-option-row">
                  <button
                    type="button"
                    className="eco-counterparty-option-main"
                    onClick={() => { setSelectedAgent(a); setAgentSearch(a.name); setAgentOptions([]); }}
                  >
                    {a.name}
                  </button>
                  <Link href={counterpartyCatalogHref(a)} className="eco-entity-open-link" title="Открыть контрагента">
                    <ExternalLink className="eco-icon" aria-hidden />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
            ) : (
              <div className="eco-counterparty-results-state">
                <strong>Ничего не найдено</strong>
                <span>Проверьте имя, телефон или номер клиента.</span>
              </div>
            )}
          </div>
        )}
        {false && showCreateAgentForm && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/10">
            <p className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">Новый контрагент</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-500">Наименование *</label>
                <input type="text" value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} placeholder="ООО Компания или ФИО" className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500">Тип</label>
                <select value={newAgentCompanyType} onChange={(e) => setNewAgentCompanyType(e.target.value as "legal" | "entrepreneur" | "individual")} className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800">
                  <option value="legal">Юридическое лицо</option>
                  <option value="entrepreneur">ИП</option>
                  <option value="individual">Физ. лицо</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-500">Email</label>
                <input type="email" value={newAgentEmail} onChange={(e) => setNewAgentEmail(e.target.value)} className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500">Телефон</label>
                <input type="text" value={newAgentPhone} onChange={(e) => setNewAgentPhone(e.target.value)} className="mt-0.5 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800" />
              </div>
              {createAgentError && <p className="text-sm text-red-600 dark:text-red-400">{createAgentError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={handleCreateAgent} disabled={createAgentLoading} className="rounded bg-amber-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-amber-600">
                  {createAgentLoading ? "Создание…" : "Создать"}
                </button>
                <button type="button" onClick={() => setShowCreateAgentForm(false)} className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400">
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </section>

      <section className="eco-card eco-shipment-new-vin">
          <div className="eco-shipment-card-head">
            <h2>
              Автомобиль · подбор по VIN
              {vinLookupResult && <EcoBadge tone="success" dot>Найдено</EcoBadge>}
            </h2>
            {vinLookupResult && <button type="button" className="eco-shipment-link-btn" onClick={() => setVinLookupResult(null)}>Изменить</button>}
          </div>
          <div className="eco-shipment-vin-body">
            <div className="eco-shipment-vin-input-pane">
              <label className="eco-field">
                <span>VIN</span>
          <input
            type="text"
            maxLength={17}
            value={vin}
            onChange={(e) => {
              const v = e.target.value.replace(/\s/g, "").toUpperCase().slice(0, 17);
              setVin(v);
              setManualEngineVolume("");
              setManualEnginePower("");
              setShowVehicleOverrideDialog(false);
              if (vinAttrIndex >= 0) {
                const next = [...attributes];
                next[vinAttrIndex] = { ...next[vinAttrIndex], value: v };
                setAttributes(next);
              }
              markDraftDirty();
            }}
            className="eco-input eco-shipment-new-vin-input"
            placeholder="Например: WBAXXXXX5JZ123456"
          />
                <small className="eco-field-hint">Для подбора достаточно 8 символов, максимум 17.</small>
              </label>
          <div className="eco-shipment-vin-actions">
            <p className="eco-shipment-vin-help">
              Подбор фильтров по VIN: введите номер выше и нажмите «Подобрать» — подберём масло и фильтры по локальному каталогу.
            </p>
            <button
              type="button"
              disabled={vin.replace(/\s/g, "").length < 8 || vinLookupLoading}
              onClick={() => runVinLookup()}
              className="eco-btn eco-btn--primary"
            >
              <Sparkles className="eco-icon" aria-hidden />
              {vinLookupLoading ? "Подбор…" : "Подобрать по VIN"}
            </button>
            {(() => {
              const hasVin = vin.replace(/\s/g, "").length >= 8;
              const modelCombined = getAttributeString(attributes, (name) => name === "модель авто");
              const mp = modelCombined.split(/\s+/).filter(Boolean);
              const dec = vinLookupResult?.decoded;
              const brandModelOk =
                mp.length >= 2 || Boolean((dec?.make ?? "").trim() && (dec?.model ?? "").trim());
              const diagDisabled = submitLoading || !(hasVin || brandModelOk);
              return (
                <button
                  type="button"
                  disabled={diagDisabled}
                  onClick={() => void handleOpenDiagnostic()}
                  className="eco-shipment-secondary-action"
                >
                  <Wrench className="eco-icon" aria-hidden />
                  Произвести диагностику
                </button>
              );
            })()}
          </div>
          {submitError && <p className="eco-shipment-new-error">{submitError}</p>}
            </div>
            {decodedVehicle && (
              <div className="eco-shipment-vin-spec-pane">
                <h3>{vehicleTitle}</h3>
                <div className="eco-shipment-vin-spec-grid">
                  {vehicleSpecRows.map((row) => (
                    <div key={row.label} className="eco-shipment-spec-row">
                      <span>{row.label}</span>
                      <strong className={row.mono ? "is-mono" : undefined}>{row.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {vinLookupResult && (
            <div className="eco-shipment-vin-result">
              {vinLookupResult.decodeError && (
                <p className="eco-vin-alert">{vinLookupResult.decodeError}</p>
              )}
              {vinLookupResult.openaiError && (
                <p className="eco-vin-alert">
                  {vinLookupResult.openaiError}
                </p>
              )}
              {vinLookupResult.decoded && (
                <p className="mb-1 text-zinc-700 dark:text-zinc-300">
                  {[vinLookupResult.decoded.make, vinLookupResult.decoded.model, vinLookupResult.decoded.modelYear].filter(Boolean).join(", ")}
                  {vinLookupResult.decoded.modification ? ` · ${vinLookupResult.decoded.modification}` : ""}
                  {vinLookupResult.decoded.engineSeries ? ` · ${vinLookupResult.decoded.engineSeries}` : ""}
                  {vinLookupResult.decoded.displacementL ? ` · ${vinLookupResult.decoded.displacementL} л` : ""}
                  {vinLookupResult.decoded.enginePowerPS ? ` · ${vinLookupResult.decoded.enginePowerPS} л.с.` : ""}
                </p>
              )}
              {vinLookupResult.oilInfo && (
                <div className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">
                  {(hasText(vinLookupResult.oilInfo.approval) ||
                    (vinLookupResult.oilInfo.acea?.length ?? 0) > 0 ||
                    (vinLookupResult.oilInfo.api?.length ?? 0) > 0 ||
                    hasText(vinLookupResult.oilInfo.fillVolumeLiters)) && (
                    <div>
                      <span className="font-medium text-zinc-700 dark:text-zinc-200">Допуск:</span>{" "}
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {hasText(vinLookupResult.oilInfo.approval)
                          ? vinLookupResult.oilInfo.approval
                          : (vinLookupResult.oilInfo.acea?.length ?? 0) > 0
                            ? `ACEA ${vinLookupResult.oilInfo.acea!.join(", ")}`
                            : (vinLookupResult.oilInfo.api?.length ?? 0) > 0
                              ? `API ${vinLookupResult.oilInfo.api!.join(", ")}`
                              : "—"}
                      </span>{" "}
                      · <span className="font-medium text-zinc-700 dark:text-zinc-200">Объём:</span>{" "}
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {hasText(vinLookupResult.oilInfo.fillVolumeLiters) ? vinLookupResult.oilInfo.fillVolumeLiters : "—"}
                      </span>{" "}
                      л
                    </div>
                  )}

                  {Array.isArray(vinLookupResult.oilInfo.sae) && vinLookupResult.oilInfo.sae.length > 0 && (
                    <div className="mt-1">
                      <span className="font-medium text-zinc-700 dark:text-zinc-200">SAE:</span>{" "}
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {vinLookupResult.oilInfo.sae.join(", ")}
                      </span>
                    </div>
                  )}

                  {[
                    vinLookupResult.oilInfo.oilFilterOem,
                    vinLookupResult.oilInfo.fuelFilterOem,
                    vinLookupResult.oilInfo.airFilterOem,
                    vinLookupResult.oilInfo.cabinFilterOem,
                  ].some(Boolean) && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">
                        OEM PARTS для фильтров
                      </summary>
                      <div className="mt-1 space-y-0.5">
                        <div>
                          масл.: {vinLookupResult.oilInfo.oilFilterOem ?? "—"}
                        </div>
                        <div>
                          топл.: {vinLookupResult.oilInfo.fuelFilterOem ?? "—"}
                        </div>
                        <div>
                          возд.: {vinLookupResult.oilInfo.airFilterOem ?? "—"}
                        </div>
                        <div>
                          салон: {vinLookupResult.oilInfo.cabinFilterOem ?? "—"}
                        </div>
                      </div>
                    </details>
                  )}

                  {vinLookupResult.oilInfo.transmission && (
                    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-xs dark:border-sky-800 dark:bg-sky-950/20">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                        АКПП {vinLookupResult.oilInfo.transmission.code}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-zinc-700 dark:text-zinc-200">Тип:</span>{" "}
                        {vinLookupResult.oilInfo.transmission.gearbox}
                      </div>
                      <div>
                        <span className="font-medium text-zinc-700 dark:text-zinc-200">Жидкость:</span>{" "}
                        {vinLookupResult.oilInfo.transmission.fluid}
                      </div>
                      <div>
                        <span className="font-medium text-zinc-700 dark:text-zinc-200">Частичная замена:</span>{" "}
                        {vinLookupResult.oilInfo.transmission.partialVolumeLiters ?? "—"} л
                        {" · "}
                        <span className="font-medium text-zinc-700 dark:text-zinc-200">Полная:</span>{" "}
                        {vinLookupResult.oilInfo.transmission.fullVolumeLiters ?? "—"} л
                      </div>
                      <div>
                        <span className="font-medium text-zinc-700 dark:text-zinc-200">Контроль уровня:</span>{" "}
                        {vinLookupResult.oilInfo.transmission.levelCheckTempC ?? "—"} °C
                      </div>
                      {vinLookupResult.oilInfo.transmission.note && (
                        <div className="mt-1 text-zinc-500 dark:text-zinc-400">
                          {vinLookupResult.oilInfo.transmission.note}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {vinLookupResult.moySkladError && (
                <p className="eco-vin-alert">{vinLookupResult.moySkladError}</p>
              )}
              {vinLookupResult.moySkladItems.length > 0 && (
                <>
                  {(() => {
                    const allItems = vinLookupResult.moySkladItems;
                    const inStockItems = allItems.filter((item) => item.quantity > 0);
                    const filterSections = (Object.keys(FILTER_SECTION_META) as FilterSectionKind[])
                      .map((kind) => ({
                        kind,
                        title: FILTER_SECTION_META[kind].title,
                        items: allItems.filter((item) => detectFilterKind(item) === kind),
                      }))
                      .filter((section) => section.items.length > 0);
                    const filters = filterSections.flatMap((section) => section.items);
                    const oils = allItems.filter(
                      (item) =>
                        item.lookupKind === "oil" ||
                        (!filters.includes(item) &&
                          /(масл|oil|atf)/i.test(item.name))
                    );
                    const others = allItems.filter(
                      (item) => !filters.includes(item) && !oils.includes(item)
                    );
                    if (allItems.length === 0) {
                      return (
                        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400">
                          В локальном каталоге по этому VIN позиции не подобраны (совпадений по OEM/допуску не найдено или нет остатков).
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-3">
                        <div className="eco-shipment-tabs" role="tablist" aria-label="Результаты VIN">
                          {[
                            ["recommendations", "Рекомендации ТО"],
                            ["oils", "Масла"],
                            ["filters", "Фильтры"],
                            ["other", "Прочее"],
                          ].map(([key, label]) => (
                            <button
                              key={key}
                              type="button"
                              role="tab"
                              aria-selected={vinResultTab === key}
                              className={vinResultTab === key ? "is-active" : undefined}
                              onClick={() => setVinResultTab(key as typeof vinResultTab)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {inStockItems.length === 0 && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                            Найдено {allItems.length} позиций, но на выбранном складе остаток 0 по всем строкам. Ниже показан полный список подбора, чтобы можно было проверить соответствие и заказать.
                          </div>
                        )}
                        {vinResultTab === "filters" && filterSections.length > 0 && (
                          <div>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="text-zinc-600 dark:text-zinc-400">
                                Фильтры: {filters.length}
                                {inStockItems.length > 0 ? ` · в наличии: ${filters.filter((i) => i.quantity > 0).length}` : ""}
                              </span>
                              <button
                                type="button"
                                disabled={filters.every((i) => i.quantity <= 0)}
                                onClick={() => addFromVinLookup(filters.filter((i) => i.quantity > 0))}
                                className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Добавить все фильтры
                              </button>
                            </div>
                            <div className="grid gap-3 lg:grid-cols-2">
                              {filterSections.map((section) => (
                                (() => {
                                  const availableItems = section.items.filter((item) => item.quantity > 0);
                                  const outOfStockItems = section.items.filter((item) => item.quantity <= 0);
                                  const renderFilterItem = (item: VinLookupItem, idx: number, keyPrefix: string) => (
                                    <div
                                      key={item.productId ?? `${section.kind}-${keyPrefix}-${idx}`}
                                      className={`rounded-lg border p-2.5 shadow-sm dark:border-zinc-700 ${
                                        item.quantity > 0
                                          ? "border-white/70 bg-white/90 dark:bg-zinc-900/50"
                                          : "border-zinc-200/80 bg-zinc-100/60 opacity-80 dark:border-zinc-700 dark:bg-zinc-950/40"
                                      }`}
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {item.name}
                                          </div>
                                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                            {item.article ? `Артикул: ${item.article}` : "Артикул не указан"}
                                            {item.cell ? ` · Ячейка ${item.cell}` : ""}
                                          </div>
                                          <div
                                            className={`mt-1 text-xs ${
                                              item.quantity > 0 ? "text-zinc-500 dark:text-zinc-400" : "text-amber-700 dark:text-amber-300"
                                            }`}
                                          >
                                            Остаток: {item.quantity} шт.
                                            {item.store && item.store !== "—" ? ` · ${item.store}` : ""}
                                          </div>
                                        </div>
                                        <div className="shrink-0 text-right">
                                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                            {formatMoney(item.price, item.currency)}
                                          </div>
                                          <button
                                            type="button"
                                            disabled={item.quantity <= 0}
                                            onClick={() => addFromVinLookup([item])}
                                            className="mt-2 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                                          >
                                            Добавить
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  );

                                  return (
                                    <div
                                      key={section.kind}
                                      className={`rounded-xl border p-3 ${getFilterSectionClasses(section.kind)}`}
                                    >
                                      <div className="mb-2 flex items-center justify-between gap-2">
                                        <div>
                                          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                            {section.title}
                                          </h3>
                                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                            Найдено: {section.items.length}
                                            {availableItems.length > 0 ? ` · в наличии: ${availableItems.length}` : ""}
                                          </p>
                                        </div>
                                        <button
                                          type="button"
                                          disabled={availableItems.length === 0}
                                          onClick={() => addFromVinLookup(availableItems)}
                                          className="rounded-lg border border-white/70 bg-white/80 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                                        >
                                          Добавить всё
                                        </button>
                                      </div>
                                      <div className="space-y-2">
                                        {availableItems.map((item, idx) => renderFilterItem(item, idx, "available"))}
                                        {outOfStockItems.length > 0 && (
                                          <details className="rounded-lg border border-zinc-200/80 bg-white/50 px-2.5 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-950/30">
                                            <summary className="cursor-pointer select-none font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
                                              Нет в наличии: {outOfStockItems.length}
                                            </summary>
                                            <div className="mt-2 space-y-2">
                                              {outOfStockItems.map((item, idx) => renderFilterItem(item, idx, "out"))}
                                            </div>
                                          </details>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()
                              ))}
                            </div>
                          </div>
                        )}
                        {(vinResultTab === "oils" || vinResultTab === "recommendations") && oils.length > 0 && (() => {
                          const targetLiters = parseFillVolume(vinLookupResult.oilInfo?.fillVolumeLiters);
                          const oilGroups = buildOilGroups(oils, targetLiters);
                          const getGroupComparePrice = (g: OilGroup): number => {
                            // Сравниваем "цену варианта" как стоимость лучшего комплекта под нужный объём,
                            // а если комплекта нет — берём базовую цену первой доступной фасовки.
                            return typeof g.bestTotalPrice === "number" ? g.bestTotalPrice : g.variants[0]?.price ?? Number.POSITIVE_INFINITY;
                          };

                          const hasBrand = (g: OilGroup, re: RegExp): boolean => g.variants.some((v) => re.test(v.name));

                          const brandPremium = /bardahl/i;
                          const brandStandard = /eurol/i;
                          const brandEconomy = /genesis/i;

                          const medianPrice = (() => {
                            const prices = oilGroups.map(getGroupComparePrice).filter((p) => Number.isFinite(p));
                            if (prices.length === 0) return undefined;
                            const sorted = [...prices].sort((a, b) => a - b);
                            return sorted[Math.floor((sorted.length - 1) / 2)];
                          })();

                          const pickMax = (candidates: OilGroup[]): OilGroup | undefined => {
                            if (candidates.length === 0) return undefined;
                            return candidates.reduce((best, g) => (getGroupComparePrice(g) > getGroupComparePrice(best) ? g : best), candidates[0]);
                          };
                          const pickMin = (candidates: OilGroup[]): OilGroup | undefined => {
                            if (candidates.length === 0) return undefined;
                            return candidates.reduce((best, g) => (getGroupComparePrice(g) < getGroupComparePrice(best) ? g : best), candidates[0]);
                          };
                          const pickClosestToMedian = (candidates: OilGroup[]): OilGroup | undefined => {
                            if (candidates.length === 0) return undefined;
                            if (medianPrice == null) return candidates[0];
                            return candidates.reduce((best, g) => {
                              const dBest = Math.abs(getGroupComparePrice(best) - medianPrice);
                              const dG = Math.abs(getGroupComparePrice(g) - medianPrice);
                              return dG < dBest ? g : best;
                            }, candidates[0]);
                          };

                          const completableOilGroups = oilGroups.filter((g) => g.bestBundle.length > 0);
                          const rankingPool = completableOilGroups.length > 0 ? completableOilGroups : oilGroups;

                          // Премиум: предпочтительно Bardahl, если нет — самый дорогой вариант.
                          const premiumCandidates = rankingPool.filter((g) => hasBrand(g, brandPremium));
                          const premiumGroup = pickMax(premiumCandidates.length ? premiumCandidates : rankingPool);

                          // Эконом: предпочтительно Genesis, если нет — самый дешёвый вариант.
                          const economyCandidates = rankingPool.filter((g) => hasBrand(g, brandEconomy));
                          const economyGroup = pickMin(economyCandidates.length ? economyCandidates : rankingPool);

                          // Стандарт: Eurol, если нет — вариант со средней ценой.
                          const standardCandidates = rankingPool.filter((g) => hasBrand(g, brandStandard));
                          const standardGroup = pickClosestToMedian(standardCandidates.length ? standardCandidates : rankingPool);

                          const maintenanceOffers = [
                            { key: "standard", title: "Оптимальный", note: "Сбалансированный вариант по цене и качеству.", group: standardGroup },
                            { key: "economy", title: "Эконом", note: "Более доступный вариант расходников.", group: economyGroup },
                            { key: "premium", title: "Премиум", note: "Вариант с более дорогим маслом.", group: premiumGroup },
                          ].flatMap((offer, _idx, list) => {
                            const firstSameOilIndex = list.findIndex((candidate) => candidate.group?.key === offer.group?.key);
                            if (firstSameOilIndex >= 0 && list[firstSameOilIndex]?.key !== offer.key) return [];
                            const built = buildMaintenanceOffer(offer.key, offer.title, offer.note, offer.group, filterSections);
                            return built ? [built] : [];
                          });
                          const maintenanceMessage = buildMaintenanceMessage(vinLookupResult, maintenanceOffers);

                          const rankedOilGroups = oilGroups
                            .map((g, idx) => ({
                              g,
                              idx,
                              hasBundle: g.bestBundle.length > 0 ? 1 : 0,
                              rank: g.key === premiumGroup?.key ? 0 : g.key === standardGroup?.key ? 1 : g.key === economyGroup?.key ? 2 : 3,
                            }))
                            .sort((a, b) => b.hasBundle - a.hasBundle || a.rank - b.rank || a.idx - b.idx)
                            .map((x) => x.g);

                          const visibleOilGroups = rankedOilGroups;
                          const hiddenOilGroupsCount = Math.max(0, oilGroups.length - visibleOilGroups.length);
                          const oilGroupsInStock = oilGroups.filter((g) => g.variants.some((v) => v.available > 0));
                          return oilGroups.length > 0 ? (
                            <div>
                              {vinResultTab === "recommendations" && maintenanceOffers.length > 0 && (
                                <div className="eco-maintenance-panel">
                                  <div className="eco-maintenance-panel-head">
                                    <div className="eco-maintenance-title-row">
                                      <h3>Подбор: эконом / оптимальный / премиум</h3>
                                      <span className="eco-ai-badge">OpenAI · локальный каталог</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => void runVinLookup()}
                                      className="eco-maintenance-recalc"
                                    >
                                      Пересчитать
                                    </button>
                                  </div>
                                  {maintenanceCopyStatus !== "idle" && (
                                    <p className={`eco-maintenance-copy-status ${maintenanceCopyStatus === "copied" ? "is-success" : "is-error"}`}>
                                      {maintenanceCopyStatus === "copied" ? "Текст скопирован." : "Не удалось скопировать автоматически."}
                                    </p>
                                  )}
                                  <div className="eco-maintenance-offers-grid">
                                    {maintenanceOffers.map((offer) => (
                                      <div key={offer.key} className={`eco-maintenance-offer-card ${offer.key === "standard" ? "is-recommended" : ""}`}>
                                        {offer.key === "standard" && <span className="eco-recommend-label">Рекомендуем</span>}
                                        <div className="eco-maintenance-offer-top">
                                          <div>
                                            <div className="eco-maintenance-offer-title">
                                              {offer.title}
                                            </div>
                                            <div className="eco-maintenance-offer-note">
                                              {offer.lines.length} поз. · {offer.note}
                                            </div>
                                          </div>
                                          <div className="eco-maintenance-offer-price">
                                            {formatMoney(offer.total, offer.currency).replace("руб.", "₽")}
                                          </div>
                                        </div>
                                        <ul className="eco-maintenance-offer-lines">
                                          {offer.lines.slice(0, 4).map((line) => (
                                            <li key={`${offer.key}-${line.name}-${line.article ?? ""}`} className="truncate">
                                              {line.quantity} x {line.name}
                                            </li>
                                          ))}
                                          {offer.lines.length > 4 && <li>+ еще {offer.lines.length - 4} поз.</li>}
                                        </ul>
                                        <button
                                          type="button"
                                          onClick={() => copyMaintenanceMessage(buildMaintenanceMessage(vinLookupResult, [offer]))}
                                          className="eco-maintenance-copy-button"
                                        >
                                          Скопировать вариант
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                  <details className="eco-maintenance-message">
                                    <summary>Готовый расчет ТО для клиента</summary>
                                    <textarea readOnly value={maintenanceMessage} />
                                    <button type="button" onClick={() => copyMaintenanceMessage(maintenanceMessage)}>
                                      Скопировать весь расчет
                                    </button>
                                  </details>
                                </div>
                              )}
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <span className="text-zinc-600 dark:text-zinc-400">
                                  Масла подобрано: {oilGroups.length}
                                  {oilGroupsInStock.length > 0 ? ` · в наличии: ${oilGroupsInStock.length}` : ""}
                                </span>
                                <div className="flex flex-wrap items-center gap-2">
                                  {premiumGroup?.bestBundle?.length ? (
                                    <button
                                      type="button"
                                      disabled={premiumGroup.bestBundle.every((line) => line.variant.available <= 0)}
                                      onClick={() =>
                                        addFromVinLookup(
                                          premiumGroup.bestBundle.flatMap((line) =>
                                            line.variant.sourceItems.filter((s) => s.quantity > 0).slice(0, 1)
                                          ),
                                          Object.fromEntries(
                                            premiumGroup.bestBundle
                                              .filter((line) => line.variant.productId && line.variant.available > 0)
                                              .map((line) => [line.variant.productId as string, line.quantity])
                                          )
                                        )
                                      }
                                      className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      Добавить премиум
                                    </button>
                                  ) : null}
                                  {standardGroup?.bestBundle?.length ? (
                                    <button
                                      type="button"
                                      disabled={standardGroup.bestBundle.every((line) => line.variant.available <= 0)}
                                      onClick={() =>
                                        addFromVinLookup(
                                          standardGroup.bestBundle.flatMap((line) =>
                                            line.variant.sourceItems.filter((s) => s.quantity > 0).slice(0, 1)
                                          ),
                                          Object.fromEntries(
                                            standardGroup.bestBundle
                                              .filter((line) => line.variant.productId && line.variant.available > 0)
                                              .map((line) => [line.variant.productId as string, line.quantity])
                                          )
                                        )
                                      }
                                      className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      Добавить стандарт
                                    </button>
                                  ) : null}
                                  {economyGroup?.bestBundle?.length ? (
                                    <button
                                      type="button"
                                      disabled={economyGroup.bestBundle.every((line) => line.variant.available <= 0)}
                                      onClick={() =>
                                        addFromVinLookup(
                                          economyGroup.bestBundle.flatMap((line) =>
                                            line.variant.sourceItems.filter((s) => s.quantity > 0).slice(0, 1)
                                          ),
                                          Object.fromEntries(
                                            economyGroup.bestBundle
                                              .filter((line) => line.variant.productId && line.variant.available > 0)
                                              .map((line) => [line.variant.productId as string, line.quantity])
                                          )
                                        )
                                      }
                                      className="rounded bg-zinc-600 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      Добавить эконом
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              <div className="space-y-2">
                                {visibleOilGroups.map((group) => {
                                  const imageUrl = getMoySkladImageUrl(group.variants[0]?.imageHref);
                                  const tierTag =
                                    group.key === premiumGroup?.key
                                      ? {
                                          label: "Премиум",
                                          classes: "bg-amber-500/15 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
                                          cardClasses: "border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-900/10",
                                        }
                                      : group.key === standardGroup?.key
                                        ? { label: "Стандарт", classes: "bg-sky-500/15 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300" }
                                        : group.key === economyGroup?.key
                                          ? { label: "Эконом", classes: "bg-zinc-500/15 text-zinc-700 dark:bg-zinc-400/10 dark:text-zinc-300", cardClasses: "border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/10" }
                                          : null;
                                  const cardClass =
                                    tierTag?.cardClasses ??
                                    "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900/30";
                                  return (
                                    <div
                                      key={group.key}
                                      className={`rounded-xl border p-3 ${tierTag ? cardClass : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900/30"}`}
                                    >
                                      <div className="flex gap-3">
                                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                                          {imageUrl ? (
                                            <img src={imageUrl} alt={group.baseName} className="h-full w-full object-cover" />
                                          ) : (
                                            <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-400">
                                              Нет фото
                                            </div>
                                          )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                              <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                  {group.baseName}
                                                </h3>
                                              {tierTag && (
                                                  <span
                                                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tierTag.classes}`}
                                                  >
                                                  {tierTag.label}
                                                  </span>
                                                )}
                                              </div>
                                              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                                {group.bestBundle.length > 0
                                                  ? `Комплект: ${describeBundle(group.bestBundle)}`
                                                  : `Фасовки: ${group.variants.map((variant) => formatVolume(variant.volumeLiters)).join(", ")}`}
                                              </div>
                                              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                                {targetLiters ? `Нужно ${formatVolume(targetLiters)}` : "Объем не указан"}
                                                {group.bestTotalLiters ? ` · подобрано ${formatVolume(group.bestTotalLiters)}` : ""}
                                                {typeof group.bestExcessLiters === "number" ? ` · остаток ${formatVolume(group.bestExcessLiters)}` : ""}
                                              </div>
                                            </div>
                                            <div className="text-left sm:text-right">
                                              <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                                {group.bestTotalPrice != null
                                                  ? formatMoney(group.bestTotalPrice, group.variants[0]?.currency)
                                                  : formatMoney(group.variants[0]?.price ?? 0, group.variants[0]?.currency)}
                                              </div>
                                              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                                от {formatMoney(group.variants[0]?.price ?? 0, group.variants[0]?.currency)}
                                              </div>
                                            </div>
                                          </div>

                                          <div className="mt-3 flex flex-wrap gap-2">
                                            {group.bestBundle.length > 0 && (
                                              <button
                                                type="button"
                                                disabled={group.bestBundle.every((line) => line.variant.available <= 0)}
                                                onClick={() =>
                                                  addFromVinLookup(
                                                    group.bestBundle.flatMap((line) =>
                                                      line.variant.sourceItems.filter((s) => s.quantity > 0).slice(0, 1)
                                                    ),
                                                    Object.fromEntries(
                                                      group.bestBundle
                                                        .filter((line) => line.variant.productId && line.variant.available > 0)
                                                        .map((line) => [line.variant.productId as string, line.quantity])
                                                    )
                                                  )
                                                }
                                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                                              >
                                                Добавить комплект
                                              </button>
                                            )}
                                            {group.variants.map((variant) => (
                                              <button
                                                key={variant.key}
                                                type="button"
                                                disabled={variant.available <= 0}
                                                onClick={() =>
                                                  addFromVinLookup(
                                                    variant.sourceItems.filter((s) => s.quantity > 0).slice(0, 1)
                                                  )
                                                }
                                                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-left text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:hover:bg-zinc-700"
                                              >
                                                {formatVolume(variant.volumeLiters)} · {formatMoney(variant.price, variant.currency)} · {variant.available} шт.
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              {hiddenOilGroupsCount > 0 && (
                                <div className="mt-2">
                                  <button
                                    type="button"
                                    onClick={() => setShowAllOilGroups((prev) => !prev)}
                                    className="text-xs text-amber-600 hover:underline dark:text-amber-400"
                                  >
                                    {showAllOilGroups ? "Скрыть лишние масла" : `Показать еще ${hiddenOilGroupsCount}`}
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400">
                              Подходящих масел по допуску не найдено в локальном каталоге.
                            </div>
                          );
                        })()}
                        {vinResultTab === "recommendations" && oils.length === 0 &&
                          filterSections.length > 0 &&
                          (() => {
                            const filterOnlyOffers = (() => {
                              const built = buildMaintenanceOffer(
                                "filters",
                                "Фильтры по OEM",
                                "Масло в каталоге не сопоставилось; в расчёт включены только подобранные фильтры (остатки на складе уточняйте).",
                                undefined,
                                filterSections
                              );
                              return built ? [built] : [];
                            })();
                            const filterOnlyMessage = buildMaintenanceMessage(vinLookupResult, filterOnlyOffers);
                            if (filterOnlyOffers.length === 0) return null;
                            return (
                              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div>
                                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                      Готовый расчет ТО для клиента
                                    </h3>
                                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                                      Масло по допуску не найдено в каталоге; в текст включены фильтры с подбором по OEM (при нулевом остатке указаны цены для ориентира).
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => copyMaintenanceMessage(filterOnlyMessage)}
                                    className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                                  >
                                    Скопировать расчет
                                  </button>
                                </div>
                                {maintenanceCopyStatus !== "idle" && (
                                  <p
                                    className={`mt-2 text-xs ${maintenanceCopyStatus === "copied" ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}
                                  >
                                    {maintenanceCopyStatus === "copied" ? "Текст скопирован." : "Не удалось скопировать автоматически."}
                                  </p>
                                )}
                                <textarea
                                  readOnly
                                  value={filterOnlyMessage}
                                  className="mt-3 h-44 w-full rounded-lg border border-emerald-200 bg-white/80 p-2 text-xs text-zinc-700 dark:border-emerald-800 dark:bg-zinc-950/60 dark:text-zinc-300"
                                />
                              </div>
                            );
                          })()}
                        {vinResultTab === "other" && others.length > 0 && (
                          <div>
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-zinc-600 dark:text-zinc-400">
                                Прочее: {others.length}
                                {others.some((i) => i.quantity > 0) ? ` · в наличии: ${others.filter((i) => i.quantity > 0).length}` : ""}
                              </span>
                              <button
                                type="button"
                                disabled={others.every((i) => i.quantity <= 0)}
                                onClick={() => addFromVinLookup(others.filter((i) => i.quantity > 0))}
                                className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Добавить всё
                              </button>
                            </div>
                            <ul className="max-h-32 overflow-auto rounded border border-zinc-200 dark:border-zinc-600">
                              {others.map((item, idx) => (
                                <li
                                  key={item.productId ?? `x-${idx}`}
                                  className="flex items-center justify-between gap-2 border-b border-zinc-100 px-2 py-1.5 last:border-0 dark:border-zinc-600"
                                >
                                  <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">
                                    {item.name}
                                  </span>
                                  <span className="text-zinc-500">
                                    {item.price.toFixed(2)} {item.currency}
                                  </span>
                                  <span className="text-zinc-500">
                                    {item.quantity} шт.
                                  </span>
                                  <button
                                    type="button"
                                    disabled={item.quantity <= 0}
                                    onClick={() => addFromVinLookup([item])}
                                    className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:hover:bg-zinc-700"
                                  >
                                    Добавить
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}
      </section>

        <section className="eco-card eco-card--padded eco-shipment-new-attributes">
          <div className="eco-card__head">
            <div>
              <div className="eco-page-kicker">Локальная БД</div>
              <h2>Дополнительные поля</h2>
            </div>
          </div>
          {attributesLoading ? (
            <p className="eco-shipment-new-empty">Загружаем дополнительные поля…</p>
          ) : attributesError ? (
            <div className="eco-shipment-new-empty">
              <strong>Не удалось загрузить дополнительные поля</strong>
              <span>{attributesError}</span>
              <button type="button" onClick={() => void loadAttributeMetadata()}>
                Повторить
              </button>
            </div>
          ) : editableAttributes.length > 0 ? (
          <dl className="grid gap-2 sm:grid-cols-2">
            {editableAttributes.map(({ a, index }) => (
              <div key={a.id ?? a.name ?? index}>
                <dt className="text-xs text-zinc-500">{a.name ?? a.id}</dt>
                <dd className="mt-0.5">
                  <input
                    type="text"
                    value={a.value == null ? "" : String(a.value)}
                    onChange={(e) => {
                      const next = [...attributes];
                      next[index] = { ...a, value: e.target.value };
                      setAttributes(next);
                      markDraftDirty();
                    }}
                    className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-mono dark:border-zinc-600 dark:bg-zinc-900"
                  />
                </dd>
              </div>
            ))}
          </dl>
          ) : (
            <p className="eco-shipment-new-empty">Дополнительные поля не настроены.</p>
          )}
        </section>

      <section className="eco-card eco-card--padded eco-shipment-new-add">
        <div className="eco-card__head">
          <div>
            <div className="eco-page-kicker">Каталог</div>
            <h2><PackagePlus className="eco-icon" aria-hidden /> Добавить позицию</h2>
          </div>
          <EcoBadge tone="neutral" dot>Локальный каталог</EcoBadge>
        </div>
        <div className="space-y-2">
          <div>
            <label className="eco-field">
              <span>Наименование, код или артикул</span>
              {productSearchLoading ? (
                <span className="eco-shipment-new-search-icon eco-search-spinner" aria-hidden />
              ) : (
                <Search className="eco-shipment-new-search-icon" aria-hidden />
              )}
	            <input
	              id="shipment-product-search"
	              type="text"
	              value={productSearch}
	              onChange={(e) => setProductSearch(e.target.value)}
	              placeholder={
                  productSearchMode === "service"
                    ? "Поиск услуги по названию..."
                    : productSearchMode === "product"
                      ? "Поиск товара по названию или артикулу..."
                      : "Поиск товара, услуги или артикула..."
                }
	              className="eco-input"
	            />
            </label>
          </div>
          <details className="eco-shipment-advanced-search">
            <summary>Расширенный поиск</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div>
              <label className="eco-field">
                <span>OEM PARTS</span>
              <input
                type="text"
                value={productOem}
                onChange={(e) => setProductOem(e.target.value)}
                placeholder="Фильтр по OEM"
                className="eco-input"
              />
              </label>
            </div>
            <div>
              <label className="eco-field">
                <span>Наименование по Mann</span>
              <input
                type="text"
                value={productMannName}
                onChange={(e) => setProductMannName(e.target.value)}
                placeholder="Фильтр по Mann"
                className="eco-input"
              />
              </label>
            </div>
            <div>
              <label className="eco-field">
                <span>Параметры</span>
              <input
                type="text"
                value={productParams}
                onChange={(e) => setProductParams(e.target.value)}
                placeholder="Фильтр по параметрам"
                className="eco-input"
              />
              </label>
            </div>
          </div>
          </details>
        </div>
        {hasProductSearchQuery && (
            <div className="eco-product-results" aria-live="polite">
              {!productSearchLoading && !productSearchError && productOptions.length > 0 && (
                <div className="eco-product-results-head border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-600">
	                  <span>{productSearchEntityLabel}</span>
                  <span>Доступно</span>
                  <span>Ячейка</span>
                  <span>Цена</span>
                  <span />
                </div>
              )}
              {productSearchLoading ? (
                <div className="eco-product-results-state">
                  <div className="eco-product-loading-copy">
                    <span className="eco-product-loading-spinner" aria-hidden />
                    <div>
	                      <strong>{productSearchLoadingLabel}</strong>
	                      <span>Обычно это занимает пару секунд.</span>
                    </div>
                  </div>
                  <div className="eco-product-skeleton-list" aria-hidden>
                    {[0, 1, 2, 3].map((item) => (
                      <div key={item} className="eco-product-skeleton-row">
                        <div>
                          <span className="eco-skeleton-line is-title" />
                          <span className="eco-skeleton-line is-code" />
                        </div>
                        <span className="eco-skeleton-pill" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : productSearchError ? (
                <div className="eco-product-results-state is-error">
	                  <strong>{productSearchErrorLabel}</strong>
                  <span>Повторите попытку.</span>
                </div>
              ) : productOptions.length > 0 ? (
              <ul className="eco-product-results-list">
              {productOptions.map((p) => {
                const isService = isServiceMeta(p.meta);
                return (
                <li key={p.id}>
                  <div className="eco-product-result-row px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <Link href={productCatalogHref(p)} className="eco-product-result-title" title={isService ? "Открыть услугу" : "Открыть товар"}>
                        <span className="truncate">{p.name}</span>
                        <ExternalLink className="eco-icon" aria-hidden />
                      </Link>
                      <span className="block truncate text-xs text-zinc-500">
                        {isService ? "локальная услуга" : `Артикул: ${p.article || "не указан"}`}
                      </span>
                    </span>
                    <span className={`shrink-0 w-14 text-right tabular-nums ${isService ? "text-zinc-400" : getStockToneClass(p.availableQuantity ?? p.stockQuantity)}`}>
                      {isService ? "—" : (p.availableQuantity ?? p.stockQuantity ?? 0)}
                    </span>
                    <span className="shrink-0 w-12 text-right text-zinc-500 tabular-nums">
                      {isService ? "—" : (p.cell ?? p.slotName ?? "")}
                    </span>
                    <span className="shrink-0 text-zinc-500">{p.price.toFixed(2)} {p.currency}</span>
                    <button
                      type="button"
                      onClick={() => addPosition(p)}
                      className="eco-product-result-add"
                    >
                      Добавить
                    </button>
                  </div>
                </li>
                );
              })}
              </ul>
              ) : (
                <div className="eco-product-results-state">
                  <strong>Ничего не найдено</strong>
                  <span>{productSearchEmptyHint}</span>
                </div>
              )}
            </div>
        )}
      </section>

      {positions.length === 0 && (
        <section className="eco-card eco-card--padded eco-shipment-new-positions">
          <div className="eco-card__head">
            <div className="eco-position-title-stack">
              <div className="eco-page-kicker">Документ</div>
              <div className="eco-position-title-row">
                <h2>Позиции отгрузки</h2>
                <EcoBadge tone="neutral">0</EcoBadge>
              </div>
            </div>
            <div className="eco-position-head-actions">
	              <button type="button" onClick={openProductSearch} className={productSearchMode === "product" ? "is-active" : undefined}>
	                <Search className="eco-icon" aria-hidden />
	                Найти товар
	              </button>
	              <button type="button" onClick={openServiceSearch} className={productSearchMode === "service" ? "is-active" : undefined}>
	                <Plus className="eco-icon" aria-hidden />
	                Услугу
              </button>
            </div>
          </div>
          <div className="eco-shipment-empty-state">
            <strong>В отгрузке пока нет позиций</strong>
            <span>Найдите товар или добавьте услугу.</span>
          </div>
        </section>
      )}

      {positions.length > 0 && (
        <section className="eco-card eco-shipment-new-positions">
          <div className="eco-card__head">
            <div className="eco-position-title-stack">
              <div className="eco-page-kicker">Документ</div>
              <div className="eco-position-title-row">
                <h2>Позиции отгрузки</h2>
                <EcoBadge tone="rust">{positions.length}</EcoBadge>
              </div>
            </div>
            <div className="eco-position-head-actions">
	              <button type="button" onClick={openProductSearch} className={productSearchMode === "product" ? "is-active" : undefined}>
	                <Search className="eco-icon" aria-hidden />
	                Найти товар
	              </button>
	              <button type="button" onClick={openServiceSearch} className={productSearchMode === "service" ? "is-active" : undefined}>
	                <Plus className="eco-icon" aria-hidden />
	                Услугу
              </button>
            </div>
          </div>
          <div className="eco-position-cards">
            {positionGroups.map((group) => (
              <Fragment key={group.key}>
                <div className="eco-position-card-group-title">
                  <span>{group.title}</span>
                  <b>{group.items.length}</b>
                </div>
	            {group.items.map(({ position: p, index }) => {
	              const isService = isServiceMeta(p.assortmentMeta);
	              const stock = getPositionStock(p);
	              const available = isService ? undefined : stock?.available;
	              const overAvailable = typeof available === "number" && (p.quantity || 0) > available;
	              const lineTotal = p.quantity * (p.price || 0) * (1 - (typeof p.discount === "number" ? p.discount : 0) / 100);
	              const slot = isService ? undefined : p.cell ?? cellByAssortment[p.assortmentMeta?.href ?? ""] ?? stock?.slotName;
	              const availabilityDetails = isService
	                ? []
	                : [
	                    slot ? `Ячейка ${slot}` : null,
	                    typeof stock?.quantity === "number" ? `Остаток ${stock.quantity}` : null,
	                    typeof available === "number" ? `Доступно ${available}` : null,
	                  ].filter(Boolean);
              return (
                <article key={p.assortmentMeta?.href ?? index} className={`eco-position-card ${overAvailable ? "is-warning" : ""}`}>
                  <div className="eco-position-card-head">
                    <div>
	                      <Link href={positionProductHref(p)} className="eco-linked-entity" title={isService ? "Открыть услугу" : "Открыть товар"}>
                        <strong>{p.name}</strong>
                        <ExternalLink className="eco-icon" aria-hidden />
                      </Link>
	                      <span>{isService ? "локальная услуга" : p.assortmentMeta?.href ? "локальная позиция" : "ручная позиция"}</span>
                    </div>
                    <button type="button" onClick={() => removePosition(index)} aria-label="Удалить позицию" title="Удалить позицию">
                      <Trash2 className="eco-icon" aria-hidden />
                    </button>
                  </div>
                  <div className="eco-position-card-availability">{availabilityDetails.length > 0 ? availabilityDetails.join(" · ") : "Наличие: —"}</div>
                  {overAvailable && <p className="eco-position-warning">Количество больше доступного остатка.</p>}
                  <div className="eco-position-card-controls">
                    <label>
                      <span>Скидка</span>
                      <div className="eco-position-discount">
                        {p.discountMode === "amount" ? (
                          <MoneyInput
                            value={p.discountAmount ?? 0}
                            onValueChange={(val) => {
                              const lineBase = (p.quantity || 0) * (p.price || 0);
                              const percent = lineBase > 0 ? Math.min(100, (val / lineBase) * 100) : 0;
                              const next = [...positions];
                              next[index] = { ...p, discountMode: "amount", discountAmount: val, discount: percent };
                              setPositions(next);
                              markDraftDirty();
                            }}
                            className="eco-position-edit-input is-discount"
                          />
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            inputMode="decimal"
                            value={p.discount ?? 0}
                            onChange={(e) => {
                              const percent = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                              const lineBase = (p.quantity || 0) * (p.price || 0);
                              const amount = lineBase * (percent / 100);
                              const next = [...positions];
                              next[index] = { ...p, discountMode: "percent", discount: percent, discountAmount: amount };
                              setPositions(next);
                              markDraftDirty();
                            }}
                            className="eco-position-edit-input is-discount"
                          />
                        )}
                        <select
                          value={p.discountMode ?? "percent"}
                          onChange={(e) => {
                            const next = [...positions];
                            next[index] = { ...p, discountMode: e.target.value as "percent" | "amount" };
                            setPositions(next);
                            markDraftDirty();
                          }}
                          aria-label="Тип скидки"
                        >
                          <option value="percent">%</option>
                          <option value="amount">₽</option>
                        </select>
                      </div>
                    </label>
                    <label>
                      <span>Кол-во</span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        inputMode="decimal"
                        value={p.quantity}
                        onChange={(e) => {
                          const next = [...positions];
                          next[index] = { ...p, quantity: parseDecimalInput(e.target.value) };
                          setPositions(next);
                          markDraftDirty();
                        }}
                        className="eco-position-edit-input is-qty"
                      />
                    </label>
                    <label>
                      <span>Цена ₽</span>
                      <MoneyInput
                        value={p.price}
                        onValueChange={(price) => {
                          const next = [...positions];
                          next[index] = { ...p, price };
                          setPositions(next);
                          markDraftDirty();
                        }}
                        className="eco-position-edit-input is-price"
                      />
                    </label>
                  </div>
                  <div className="eco-position-card-total">
                    <span>Сумма</span>
                    <strong>{lineTotal.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</strong>
                  </div>
                </article>
              );
            })}
              </Fragment>
            ))}
          </div>
          <div className="eco-table-wrap">
            <table className="eco-table eco-shipment-new-table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Товар</th>
                  <th>Наличие</th>
                  <th className="is-num">Скидка</th>
                  <th className="is-num">Кол-во</th>
                  <th className="is-num">Цена</th>
                  <th className="is-num">Сумма</th>
                  <th className="is-action">Действия</th>
                </tr>
              </thead>
              <tbody>
                {positionGroups.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="eco-position-group-row">
                      <td colSpan={8}>
                        <div className="eco-position-group-label">
                          <span>{group.title}</span>
                          <b>{group.items.length}</b>
                        </div>
                      </td>
                    </tr>
	                {group.items.map(({ position: p, index }, groupRowIndex) => {
	                  const isService = isServiceMeta(p.assortmentMeta);
	                  const stock = getPositionStock(p);
	                  const available = isService ? undefined : stock?.available;
	                  const overAvailable = typeof available === "number" && (p.quantity || 0) > available;
	                  const slot = isService ? undefined : p.cell ?? cellByAssortment[p.assortmentMeta?.href ?? ""] ?? stock?.slotName;
	                  const availabilityDetails = isService
	                    ? []
	                    : [
	                        slot ? <strong key="slot">{slot}</strong> : null,
	                        typeof stock?.quantity === "number" ? <span key="qty">Остаток: {stock.quantity}</span> : null,
	                        typeof stock?.reserve === "number" ? <span key="reserve">Резерв: {stock.reserve}</span> : null,
	                        typeof available === "number" ? <span key="available">Доступно: {available}</span> : null,
	                      ].filter(Boolean);
                  const lineTotal = p.quantity * (p.price || 0) * (1 - (typeof p.discount === "number" ? p.discount : 0) / 100);
                  return (
                  <tr key={p.assortmentMeta?.href ?? index} className={overAvailable ? "is-warning" : ""}>
                    <td className="eco-position-row-number">{String(groupRowIndex + 1).padStart(2, "0")}</td>
                    <td className="eco-position-product-cell" title={p.name}>
	                      <Link href={positionProductHref(p)} className="eco-position-product-name eco-position-product-link" title={isService ? "Открыть услугу" : "Открыть товар"}>
                        <span>{p.name}</span>
                        <ExternalLink className="eco-icon" aria-hidden />
                      </Link>
                      <span className="eco-position-product-code">
	                        {isService ? "локальная услуга" : p.assortmentMeta?.href ? "локальная позиция" : "ручная позиция"}
                      </span>
                    </td>
                    <td>
                      <div className="eco-position-availability">
                        {availabilityDetails.length > 0 ? availabilityDetails : <span>—</span>}
                      </div>
                    </td>
                    <td className="is-num">
                      <div className="eco-position-discount">
                        {p.discountMode === "amount" ? (
                          <MoneyInput
                            value={p.discountAmount ?? 0}
                            onValueChange={(val) => {
                              const lineBase = (p.quantity || 0) * (p.price || 0);
                              const percent = lineBase > 0 ? Math.min(100, (val / lineBase) * 100) : 0;
                              const next = [...positions];
                              next[index] = { ...p, discountMode: "amount", discountAmount: val, discount: percent };
                              setPositions(next);
                              markDraftDirty();
                            }}
                            className="eco-position-edit-input is-discount"
                          />
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={p.discount ?? 0}
                            onChange={(e) => {
                              const percent = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                              const lineBase = (p.quantity || 0) * (p.price || 0);
                              const amount = lineBase * (percent / 100);
                              const next = [...positions];
                              next[index] = { ...p, discountMode: "percent", discount: percent, discountAmount: amount };
                              setPositions(next);
                              markDraftDirty();
                            }}
                            className="eco-position-edit-input is-discount"
                          />
                        )}
                        <select
                          value={p.discountMode ?? "percent"}
                          onChange={(e) => {
                            const mode = e.target.value as "percent" | "amount";
                            const next = [...positions];
                            next[index] = { ...p, discountMode: mode };
                            setPositions(next);
                            markDraftDirty();
                          }}
                          aria-label="Тип скидки"
                        >
                          <option value="percent">%</option>
                          <option value="amount">₽</option>
                        </select>
                      </div>
                    </td>
                    <td className="is-num">
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        inputMode="decimal"
                        value={p.quantity}
                        onChange={(e) => {
                          const next = [...positions];
                          next[index] = { ...p, quantity: parseDecimalInput(e.target.value) };
                          setPositions(next);
                          markDraftDirty();
                        }}
                        className="eco-position-edit-input is-qty"
                      />
                    </td>
                    <td className="is-num">
                      <MoneyInput
                        value={p.price}
                        onValueChange={(price) => {
                          const next = [...positions];
                          next[index] = { ...p, price };
                          setPositions(next);
                          markDraftDirty();
                        }}
                        className="eco-position-edit-input is-price"
                      />
                    </td>
                    <td className="is-num">
                      <strong className="eco-position-line-total">{lineTotal.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</strong>
                    </td>
                    <td className="is-action">
                      <button
                        type="button"
                        onClick={() => removePosition(index)}
                        className="eco-position-row-action"
                        aria-label="Удалить позицию"
                        title="Удалить позицию"
                      >
                        <Trash2 className="eco-icon" aria-hidden />
                      </button>
                    </td>
                  </tr>
                  );
                })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="eco-shipment-new-table-foot">
            <span>Позиций: {positions.length}</span>
            <span>Кол-во всего: {positionsQty}</span>
            <strong>
              Итого: {positionsTotal.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
            </strong>
          </div>
        </section>
      )}

        </div>

        <aside className="eco-shipment-new-aside">
      <section className="eco-card eco-shipment-new-total-card">
        <div className="eco-shipment-card-head">
          <h2>Итого</h2>
          <span className="eco-shipment-draft-badge">{statusText}</span>
        </div>
        <div className="eco-shipment-new-total-body">
          <div className="eco-shipment-new-total-line">
            <span>Подытог</span>
            <strong>{positionsSubtotal.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽</strong>
          </div>
          <div className="eco-shipment-new-total-line">
            <span>Скидка</span>
            <strong>
              {positionsDiscount > 0
                ? `− ${positionsDiscount.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`
                : "0%"}
            </strong>
          </div>
          <div className="eco-shipment-new-total-main">
            <span>К оплате</span>
            <strong>{positionsTotal.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽</strong>
          </div>
          <div className="eco-shipment-new-total-line is-muted">
            <span>Себестоимость</span>
            <strong>
              {positionsCost == null ? "—" : `${positionsCost.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`}
            </strong>
          </div>
          <div className="eco-shipment-new-total-line is-success">
            <span>Маржа {hasIncompleteCost ? <em>оценочно</em> : null}</span>
            <strong>
              {positionsMargin == null || positionsMarginPct == null
                ? "—"
                : `${positionsMargin.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽ · ${positionsMarginPct}%`}
            </strong>
          </div>
          <label className="eco-field">
            <span>Комментарий</span>
            <textarea rows={3} value={description} onChange={(e) => { setDescription(e.target.value); markDraftDirty(); }} className="eco-input eco-shipment-new-comment" />
          </label>
          <label className="eco-shipment-new-check">
            <input id="applicable" type="checkbox" checked={applicable} onChange={(e) => { setApplicable(e.target.checked); markDraftDirty(); }} />
            <span>Проведён. Списывает остатки локального склада.</span>
          </label>
          <div className="eco-readiness-list">
            {readinessItems.map((item) => (
              <span key={item.key} className={item.ready ? "is-ready" : ""}>
                {item.ready ? "✓" : "•"} {item.label}
              </span>
            ))}
          </div>
          {submitError && <p className="eco-shipment-new-error">{submitError}</p>}
          <EcoButton
            type="button"
            onClick={handleSubmit}
            disabled={saveDisabled}
            title={saveDisabledReason}
            variant="primary"
            className="eco-shipment-new-submit"
          >
            <Receipt className="eco-icon" aria-hidden />
            {saveButtonLabel}
          </EcoButton>
          <div className="eco-shipment-print-actions">
            <ShipmentPrintMenu
              shipmentId={demandIdLocal}
              disabled={!demandIdLocal || submitLoading || paying}
              disabledReason="Сначала сохраните отгрузку"
              onBeforePrint={saveDraftBeforePrint}
            />
            <button
              type="button"
              className="eco-shipment-precheck-action"
              onClick={() => void handleOpenPrecheck()}
              disabled={!demandIdLocal || submitLoading || paying}
              title={!demandIdLocal ? "Сначала сохраните отгрузку" : undefined}
            >
              <CreditCard className="eco-icon" aria-hidden />
              {paying ? "Открываем…" : "Открыть предчек"}
            </button>
          </div>
        </div>
      </section>

      <section className="eco-card eco-shipment-new-side-context">
        <div className="eco-shipment-card-head">
          <h2>Контекст</h2>
        </div>
        <div className="eco-shipment-new-side-context-body">
        <div className="eco-shipment-new-side-row">
          <span>Дата</span>
          <strong>{momentStr ? formatServiceDateTime(momentStr) : formatServiceDateTime(new Date())}</strong>
        </div>
        <div className="eco-shipment-new-side-row">
          <span>Клиент</span>
          <strong>
            {selectedAgent ? (
              <Link href={counterpartyCatalogHref(selectedAgent)} className="eco-side-entity-link" title="Открыть контрагента">
                {selectedAgent.name}
              </Link>
            ) : (
              "не выбран"
            )}
          </strong>
        </div>
        <div className="eco-shipment-new-side-row">
          <span>Организация</span>
          <strong>{loadingOrgs ? "загрузка" : selectedOrg?.name ?? "не выбрана"}</strong>
        </div>
        <div className="eco-shipment-new-side-row">
          <span>Склад</span>
          <strong>{loadingStores ? "загрузка" : selectedStore?.name ?? "не выбран"}</strong>
        </div>
        <div className="eco-shipment-new-side-row">
          <span>VIN</span>
          <strong>{vin || "не указан"}</strong>
        </div>
        <div className="eco-shipment-new-side-row">
          <span>Статус</span>
          <strong>{statusText}</strong>
        </div>
        </div>
      </section>
        </aside>
      </div>

      {submitError && (
        <div className="eco-toast" role="alert">
          {submitError}
        </div>
      )}

      <div className="eco-shipment-bottom-bar">
        <button type="button" className="eco-shipment-bottom-total" onClick={() => setSummarySheetOpen(true)}>
          <span>К оплате</span>
          <strong>{positionsTotal.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽</strong>
        </button>
        <EcoButton type="button" onClick={handleSubmit} disabled={saveDisabled} title={saveDisabledReason} variant="primary">
          {compactSaveButtonLabel}
        </EcoButton>
      </div>

      {summarySheetOpen && (
        <div className="eco-bottom-sheet-backdrop" onClick={() => setSummarySheetOpen(false)}>
          <div className="eco-bottom-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="eco-shipment-card-head">
              <h2>Итого</h2>
              <button type="button" className="eco-shipment-link-btn" onClick={() => setSummarySheetOpen(false)}>
                Закрыть
              </button>
            </div>
            <div className="eco-shipment-new-total-body">
              <div className="eco-shipment-new-total-line">
                <span>Подытог</span>
                <strong>{positionsSubtotal.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽</strong>
              </div>
              <div className="eco-shipment-new-total-line">
                <span>Скидка</span>
                <strong>{positionsDiscount.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽</strong>
              </div>
              <div className="eco-shipment-new-total-main">
                <span>К оплате</span>
                <strong>{positionsTotal.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽</strong>
              </div>
              <label className="eco-field">
                <span>Комментарий</span>
                <textarea rows={3} value={description} onChange={(e) => { setDescription(e.target.value); markDraftDirty(); }} className="eco-input eco-shipment-new-comment" />
              </label>
              <label className="eco-shipment-new-check">
                <input type="checkbox" checked={applicable} onChange={(e) => { setApplicable(e.target.checked); markDraftDirty(); }} />
                <span>Проведён. Списывает остатки локального склада.</span>
              </label>
              <div className="eco-readiness-list">
                {readinessItems.map((item) => (
                  <span key={item.key} className={item.ready ? "is-ready" : ""}>
                    {item.ready ? "✓" : "•"} {item.label}
                  </span>
                ))}
              </div>
              {submitError && <p className="eco-shipment-new-error">{submitError}</p>}
              <EcoButton type="button" onClick={handleSubmit} disabled={saveDisabled} title={saveDisabledReason} variant="primary" className="eco-shipment-new-submit">
                {saveButtonLabel}
              </EcoButton>
              <div className="eco-shipment-print-actions">
                <ShipmentPrintMenu
                  shipmentId={demandIdLocal}
                  disabled={!demandIdLocal || submitLoading || paying}
                  disabledReason="Сначала сохраните отгрузку"
                  onBeforePrint={saveDraftBeforePrint}
                />
                <button
                  type="button"
                  className="eco-shipment-precheck-action"
                  onClick={() => void handleOpenPrecheck()}
                  disabled={!demandIdLocal || submitLoading || paying}
                  title={!demandIdLocal ? "Сначала сохраните отгрузку" : undefined}
                >
                  <CreditCard className="eco-icon" aria-hidden />
                  {paying ? "Открываем…" : "Открыть предчек"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DiagnosticMapModal
        open={diagnosticModalOpen}
        onClose={() => setDiagnosticModalOpen(false)}
        diagnosticId={diagnosticRowId}
        shipmentId={demandIdLocal}
        headerDraft={{
          vin,
          brand:
            vinLookupResult?.decoded?.make ??
            getAttributeString(attributes, (name) => name === "модель авто").split(/\s+/)[0] ??
            "",
          model:
            vinLookupResult?.decoded?.model ??
            getAttributeString(attributes, (name) => name === "модель авто")
              .split(/\s+/)
              .slice(1)
              .join(" ") ??
            "",
          year:
            vinLookupResult?.decoded?.modelYear ??
            getAttributeString(attributes, (name) => name === "год") ??
            "",
          licensePlate: getAttributeString(attributes, (name) => /гос|номер/i.test(name)),
          mileage: getAttributeString(attributes, (name) => /пробег/i.test(name)),
          clientName: selectedAgent?.name ?? "",
          vehicleHints: inferDiagnosticVehicleHintsFromLookup(vinLookupResult),
        }}
        onDiagnosticCreated={(id) => setDiagnosticRowId(id)}
        onDiagnosticUpdated={(diagnostic) => setDiagnosticRowId(diagnostic.id)}
        onAddedToShipment={() => router.refresh()}
      />
    </main>
  );
}

export function NewShipmentPageClient(props: NewShipmentFormProps) {
  return <NewShipmentForm {...props} />;
}
