"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { DiagnosticModal } from "@/components/diagnostic/DiagnosticModal";
import MoneyInput from "@/components/MoneyInput";
import { getOilLineBaseName } from "@/lib/oil-pack-volume";

type Meta = { href: string; type: string; mediaType: string };

type Header = {
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
  storeId?: string;
  ecoUserName?: string;
};

type Position = {
  id?: string;
  name: string;
  quantity: number;
  price: number;
  assortmentMeta?: Meta;
  slotName?: string;
  stock?: {
    cost?: number;
    quantity?: number;
    reserve?: number;
    intransit?: number;
    available?: number;
  };
  discount?: number; // %
  discountMode?: "percent" | "amount";
  discountAmount?: number; // ₽ по строке
};

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

type DemandAttribute = {
  id?: string;
  name?: string;
  type?: string;
  meta?: Meta;
  value?: unknown;
};

type DetailResponse = {
  header: Header;
  attributes: DemandAttribute[];
  positions: Position[];
  raw?: unknown;
  rawPositions?: unknown;
};

const EDITABLE_ATTR_NAMES = ["vin номер", "модель авто", "год", "гос. номер", "пробег", "объем", "моторное масло"];
const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";

const FILTER_SECTION_META = {
  "oil-filter": { title: "Масляные фильтры", accent: "amber" },
  "air-filter": { title: "Воздушные фильтры", accent: "sky" },
  "cabin-filter": { title: "Салонные фильтры", accent: "violet" },
  "fuel-filter": { title: "Топливные фильтры", accent: "emerald" },
} as const;

type FilterSectionKind = keyof typeof FILTER_SECTION_META;

function normalizeAttrName(value?: string): string {
  return (value ?? "").toString().trim().toLowerCase().replace(/ё/g, "е");
}

function hasText(value?: string): boolean {
  return Boolean(value && value.trim().length > 0);
}

function getStockToneClass(value?: number): string {
  const qty = Math.max(0, Math.floor(value ?? 0));
  if (qty <= 0) return "text-red-600 dark:text-red-400";
  if (qty <= 2) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function productIdFromMeta(meta?: Meta): string {
  const href = meta?.href?.trim() ?? "";
  if (!href) return "";
  const localMatch = href.match(/^local:\/\/[^/]+\/([^/?#]+)/i);
  if (localMatch?.[1]) return localMatch[1];
  const entityMatch = href.match(/\/entity\/(?:product|variant|service)\/([^/?#]+)/i);
  return entityMatch?.[1] ?? "";
}

function localProductHref(position: Position): string {
  const productId = productIdFromMeta(position.assortmentMeta);
  if (productId) return `/inventory/products?product=${encodeURIComponent(productId)}`;
  return `/inventory/products?search=${encodeURIComponent(position.name)}`;
}

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

export default function ShipmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [applicable, setApplicable] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [attributes, setAttributes] = useState<DemandAttribute[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [vin, setVin] = useState("");
  const [vinLookupLoading, setVinLookupLoading] = useState(false);
  const [vinLookupResult, setVinLookupResult] = useState<VinLookupResult | null>(null);
  const [showAllOilGroups, setShowAllOilGroups] = useState(false);
  const [maintenanceCopyStatus, setMaintenanceCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [activeDetailTab, setActiveDetailTab] = useState<"positions" | "vin" | "history" | "precheck">("positions");
  const [vehicleEditing, setVehicleEditing] = useState(false);
  const [manualEngineVolume, setManualEngineVolume] = useState("");
  const [manualEnginePower, setManualEnginePower] = useState("");
  const [showVehicleOverrideDialog, setShowVehicleOverrideDialog] = useState(false);
  const [vehicleOverridePromptVin, setVehicleOverridePromptVin] = useState("");
  const [printTemplate, setPrintTemplate] = useState<
    | "default"
    | "birka_own"
    | "birka_box"
    | "job_order"
    | "eco_poster"
    | "eco_poster_akpp_partial"
    | "eco_poster_akpp_full"
    | "under_hood_tags"
    | "under_hood_tags_akpp_partial"
    | "under_hood_tags_akpp_full"
  >("eco_poster");
  const [productSearch, setProductSearch] = useState("");
  const [productOem, setProductOem] = useState("");
  const [productMannName, setProductMannName] = useState("");
  const [productParams, setProductParams] = useState("");
  const [productOptions, setProductOptions] = useState<
    {
      id: string;
      name: string;
      price: number;
      currency: string;
      meta: Meta;
      cell?: string;
      stockQuantity?: number;
      reserveQuantity?: number;
      availableQuantity?: number;
      slotName?: string;
    }[]
  >([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);

  const [diagnosticModalOpen, setDiagnosticModalOpen] = useState(false);
  const [diagnosticRowId, setDiagnosticRowId] = useState<string | null>(null);
  const [diagnosticRemote, setDiagnosticRemote] = useState<{
    id: string;
    status: string;
    summaryGreen: number;
    summaryYellow: number;
    summaryRed: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const sess = await fetch("/api/auth/session").then((r) => r.json());
        if (!sess?.user) {
          router.push(`/login?from=/shipment/${id}`);
          return;
        }
        if (sess.user.role === "admin" || sess.user.role === "master") {
          const shift = await fetch("/api/shifts/current").then((r) => (r.ok ? r.json() : null));
          if (!shift) {
            router.push(sess.user.role === "admin" ? "/cash?needShift=1" : "/?needShift=1");
            return;
          }
          if (sess.user.role === "admin") {
            const cash = await fetch("/api/cash").then((r) => (r.ok ? r.json() : null));
            if (!cash?.shift) {
              router.push("/cash?needShift=1");
              return;
            }
          }
        }
        const res = await fetch(`/api/demands/${id}`);
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Ошибка загрузки отгрузки");
          return;
        }
        if (cancelled) return;
        setData(json);
        setDescription(json.header.description ?? "");
        setApplicable(Boolean(json.header.applicable));
        const atts = Array.isArray(json.attributes) ? (json.attributes as DemandAttribute[]) : [];
        setAttributes(atts);
        // VIN из доп. полей (по имени атрибута, содержащему "vin")
        const vinIndex = atts.findIndex(
          (a) => typeof a?.name === "string" && /vin/i.test(a.name)
        );
        if (vinIndex >= 0) {
          const v = atts[vinIndex]?.value;
          setVin(typeof v === "string" ? v : v != null ? String(v) : "");
        } else {
          setVin("");
        }
        setPositions(
          (json.positions ?? []).map((p: Position) => {
            const priceRub = (p.price || 0) / 100;
            const discount = typeof p.discount === "number" ? p.discount : 0;
            const lineBase = (p.quantity || 0) * priceRub;
            const discountAmount = lineBase * (discount / 100);
            return {
              ...p,
              price: priceRub,
              discount,
              discountMode: "percent",
              discountAmount,
            };
          })
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Ошибка сети");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (id) load();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/diagnostic/for-shipment?shipmentId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.diagnostic?.id) {
          setDiagnosticRemote(j.diagnostic);
          setDiagnosticRowId(j.diagnostic.id);
        } else {
          setDiagnosticRemote(null);
          setDiagnosticRowId(null);
        }
      })
      .catch(() => {});
  }, [id]);

  const handleOpenDiagnosticDetail = useCallback(async () => {
    if (!id) return;
    let diagId = diagnosticRowId;
    if (!diagId) {
      const attrModel = String(
        attributes.find((a) => (a.name ?? "").toLowerCase() === "модель авто")?.value ?? ""
      ).trim();
      const mp = attrModel.split(/\s+/).filter(Boolean);
      const yearStr = String(attributes.find((a) => (a.name ?? "").toLowerCase() === "год")?.value ?? "").trim();
      const plateStr = String(
        attributes.find((a) => /гос|номер/i.test(a.name ?? ""))?.value ?? ""
      ).trim();
      const mileageStr = String(
        attributes.find((a) => /пробег/i.test(a.name ?? ""))?.value ?? ""
      ).trim();
      const dec = vinLookupResult?.decoded;
      const rawAgentId =
        data?.raw && typeof data.raw === "object" && data.raw !== null && "agent" in data.raw
          ? (data.raw as { agent?: { id?: string } }).agent?.id
          : undefined;
      const cr = await fetch("/api/diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentMoySkladId: id,
          agentMoySkladId: rawAgentId ?? null,
          vin: vin.replace(/\s/g, "").toUpperCase() || null,
          brand: dec?.make || mp[0] || null,
          model: dec?.model || mp.slice(1).join(" ") || null,
          year: yearStr ? parseInt(yearStr, 10) || null : dec?.modelYear ? parseInt(dec.modelYear, 10) || null : null,
          licensePlate: plateStr || null,
          mileage: mileageStr ? parseInt(mileageStr.replace(/\D/g, ""), 10) || null : null,
        }),
      });
      const cj = await cr.json();
      if (!cr.ok) {
        setError(cj.error ?? "Не удалось создать диагностику");
        return;
      }
      diagId = cj.diagnosticId as string;
      setDiagnosticRowId(diagId);
      setDiagnosticRemote({
        id: diagId,
        status: "IN_PROGRESS",
        summaryGreen: 0,
        summaryYellow: 0,
        summaryRed: 0,
      });
    }
    setDiagnosticModalOpen(true);
  }, [
    id,
    diagnosticRowId,
    attributes,
    vin,
    data?.raw,
    vinLookupResult?.decoded,
  ]);

  useEffect(() => {
    const hasQuery = [productSearch.trim(), productOem.trim(), productMannName.trim(), productParams.trim()].some(Boolean);
    if (!hasQuery) {
      setProductOptions([]);
      return;
    }
    const t = setTimeout(() => {
      setProductSearchLoading(true);
      const params = new URLSearchParams();
      if (productSearch.trim()) params.set("search", productSearch.trim());
      if (productOem.trim()) params.set("oem", productOem.trim());
      if (productMannName.trim()) params.set("mannName", productMannName.trim());
      if (productParams.trim()) params.set("params", productParams.trim());
      if (data?.header.storeId) params.set("storeId", data.header.storeId);
      if (data?.header.storeName) params.set("storeName", data.header.storeName);
      params.set("limit", "15");
      fetch(`/api/moysklad/products?${params.toString()}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.products) setProductOptions(data.products);
        })
        .finally(() => setProductSearchLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch, productOem, productMannName, productParams, data?.header.storeId, data?.header.storeName]);

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
          href: `${MOYSKLAD_BASE}/entity/product/${it.productId}`,
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
          slotName: it.cell,
        });
        indexByHref.set(meta.href, next.length - 1);
      }
      return next;
    });
  }, []);

  const runVinLookup = useCallback(async (vehicleOverrides?: { displacementL?: string; enginePowerPS?: string }) => {
    const vinClean = vin.replace(/\s/g, "").toUpperCase();
    if (vinClean.length < 8) return;
    const hasOverrides = Boolean(vehicleOverrides?.displacementL?.trim() || vehicleOverrides?.enginePowerPS?.trim());
    setVinLookupLoading(true);
    setVinLookupResult(null);
    setShowAllOilGroups(false);
    setMaintenanceCopyStatus("idle");
    setShowVehicleOverrideDialog(false);
    setError(null);
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vin: vinClean,
          vehicleOverrides: hasOverrides ? vehicleOverrides : undefined,
        }),
      });
      const data = await res.json();
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
            if (decoded && name === "модель авто") {
              const val = [decoded.make, decoded.model].filter(Boolean).join(" ").trim();
              return { ...a, value: val || null };
            }
            if (decoded && name === "год") {
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
      }
    } catch (e) {
      setVinLookupResult({
        vin: vinClean,
        decoded: null,
        moySkladItems: [],
        decodeError: e instanceof Error ? e.message : "Ошибка запроса",
      });
    } finally {
      setVinLookupLoading(false);
    }
  }, [vin]);

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

  async function saveShipment(): Promise<boolean> {
    setSaving(true);
    setError(null);
    setPaymentInfo(null);
    try {
      const res = await fetch(`/api/demands/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          applicable,
          attributes,
          positions: positions.map((p) => ({
            id: p.id,
            quantity: p.quantity,
            // обратно в копейки для API МойСклад
            price: Math.round((p.price || 0) * 100),
            discount: typeof p.discount === "number" ? p.discount : 0,
            assortment: p.assortmentMeta ? { meta: p.assortmentMeta } : undefined,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Ошибка сохранения");
        return false;
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              header: {
                ...prev.header,
                description: json.description,
                applicable: json.applicable,
              },
            }
          : prev
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    await saveShipment();
  }

  async function handleDuplicate() {
    if (!id) return;
    setDuplicating(true);
    setError(null);
    setPaymentInfo(null);
    try {
      const res = await fetch(`/api/demands/${encodeURIComponent(id)}/copy`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Не удалось скопировать отгрузку");
        return;
      }
      if (json.id) router.push(`/shipment/${json.id}`);
      else setError("МойСклад не вернул id новой отгрузки");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setDuplicating(false);
    }
  }

  async function handleDeleteShipment() {
    if (!id) return;
    if (!window.confirm("Удалить отгрузку в МойСклад? Действие необратимо.")) return;
    setRemoving(true);
    setError(null);
    setPaymentInfo(null);
    try {
      const res = await fetch(`/api/demands/${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Не удалось удалить отгрузку");
        return;
      }
      router.push("/shipment");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setRemoving(false);
    }
  }

  async function handlePayment() {
    const precheckWindow = window.open("about:blank", "_blank");
    precheckWindow?.document.write("<!doctype html><title>Предчек</title><body>Открываем предчек...</body>");
    setPaying(true);
    setError(null);
    setPaymentInfo(null);
    try {
      const saved = await saveShipment();
      if (!saved) {
        precheckWindow?.close();
        return;
      }

      const url = `/shipment/${encodeURIComponent(id)}/precheck`;
      if (precheckWindow) precheckWindow.location.href = url;
      else router.push(url);
    } catch (e) {
      precheckWindow?.close();
      setError(e instanceof Error ? e.message : "Ошибка открытия предчека");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="eco-page">
        <p className="text-sm text-[var(--eco-muted)]">Загрузка отгрузки...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="eco-page">
        <p className="text-sm text-red-600 dark:text-red-400">{error ?? "Отгрузка не найдена"}</p>
        <p className="mt-2">
          <Link href="/shipment" className="text-sm text-amber-600 hover:underline dark:text-amber-400">
            ← К списку отгрузок
          </Link>
        </p>
      </div>
    );
  }

  const vinAttrIndex = attributes.findIndex(
    (a) => typeof a?.name === "string" && /vin/i.test(a.name)
  );
  const getAttrValue = (matcher: RegExp) => {
    const attr = attributes.find((a) => matcher.test(normalizeAttrName(a.name)));
    const value = attr?.value;
    if (value == null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  };
  const updateAttrValue = (matcher: RegExp, value: string) => {
    setAttributes((prev) =>
      prev.map((attr) => (matcher.test(normalizeAttrName(attr.name)) ? { ...attr, value } : attr))
    );
  };
  const addProductOption = (p: {
    id: string;
    name: string;
    price: number;
    currency: string;
    meta: Meta;
    cell?: string;
    stockQuantity?: number;
    reserveQuantity?: number;
    availableQuantity?: number;
    slotName?: string;
  }) => {
    setPositions((prev) => [
      ...prev,
      {
        id: undefined,
        name: p.name,
        quantity: 1,
        price: p.price,
        discount: 0,
        discountMode: "percent",
        discountAmount: 0,
        assortmentMeta: p.meta,
        slotName: p.cell ?? p.slotName,
        stock: {
          quantity: p.stockQuantity,
          reserve: p.reserveQuantity,
          available: p.availableQuantity,
        },
      },
    ]);
    setProductSearch("");
    setProductOem("");
    setProductMannName("");
    setProductParams("");
    setProductOptions([]);
  };
  const agentName = data.header.agentName || "Клиент не выбран";
  const agentInitials = agentName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "К";
  const vehicleModel =
    getAttrValue(/^модель авто$/i) ||
    [vinLookupResult?.decoded?.make, vinLookupResult?.decoded?.model].filter(Boolean).join(" ");
  const vehicleYear = getAttrValue(/^год$/i) || vinLookupResult?.decoded?.modelYear || "";
  const vehiclePlate = getAttrValue(/гос.*номер|номер/i);
  const vehicleMileage = getAttrValue(/пробег/i);
  const vehicleVolume = getAttrValue(/^объем$/i);
  const vehicleOil = getAttrValue(/моторное масло/i);
  const documentVin = vin || getAttrValue(/vin/i);
  const positionsSubtotal = positions.reduce((sum, p) => sum + (p.quantity || 0) * (p.price || 0), 0);
  const positionsDiscount = positions.reduce((sum, p) => {
    const base = (p.quantity || 0) * (p.price || 0);
    const discount = typeof p.discount === "number" ? p.discount : 0;
    return sum + base * (discount / 100);
  }, 0);
  const positionsTotal = Math.max(0, positionsSubtotal - positionsDiscount);
  const positionsCost = positions.reduce((sum, p) => {
    const cost = typeof p.stock?.cost === "number" ? p.stock.cost / 100 : 0;
    return sum + cost * (p.quantity || 0);
  }, 0);
  const positionsMargin = positionsTotal - positionsCost;
  const positionsMarginPct = positionsTotal > 0 ? Math.round((positionsMargin / positionsTotal) * 100) : 0;
  const documentStatus = applicable ? "Проведена" : "Черновик";

  return (
    <main className="eco-page eco-shipment-detail-page">
      <div className="eco-shipment-detail-head">
        <div>
          <div className="eco-shipment-detail-crumbs">
            <Link href="/">Главная</Link>
            <span>/</span>
            <Link href="/shipment">Отгрузки</Link>
            <span>/</span>
            <b>{data.header.name}</b>
          </div>
          <div className="eco-shipment-detail-title-row">
            <h1>Отгрузка {data.header.name}</h1>
            <span className="eco-shipment-detail-badge is-draft">{documentStatus}</span>
            {paymentInfo ? <span className="eco-shipment-detail-badge is-paid">Оплачено</span> : null}
          </div>
        </div>
        <div className="eco-shipment-detail-actions">
          <button
            type="button"
            onClick={() => void handleDuplicate()}
            disabled={saving || printing || paying || duplicating || removing}
            className="eco-shipment-detail-link-action"
          >
            {duplicating ? "Копирование…" : "Копировать"}
          </button>
          <a href={`/api/demands/${data.header.id}/job-order`} className="eco-shipment-detail-action">
            Заказ-наряд
          </a>
          <button
            type="button"
            onClick={async () => {
              setPrinting(true);
              setError(null);
              try {
                const saved = await saveShipment();
                if (saved) window.open(`/shipment/${data.header.id}/tags?autoprint=1`, "_blank");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Ошибка печати");
              } finally {
                setPrinting(false);
              }
            }}
            disabled={saving || printing || paying || duplicating || removing}
            className="eco-shipment-detail-action"
          >
            Наклейка
          </button>
          <button
            type="button"
            onClick={handlePayment}
            disabled={saving || printing || paying || duplicating || removing}
            className="eco-shipment-detail-action is-primary"
          >
            {paying ? "Открываем…" : "Открыть предчек"}
          </button>
        </div>
      </div>

      {showVehicleOverrideDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Уточните данные двигателя
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              По VIN не удалось определить объём двигателя или мощность. Если знаете эти данные, укажите их — подбор масла будет точнее.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-zinc-500">Объём двигателя, л</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualEngineVolume}
                  onChange={(e) => setManualEngineVolume(e.target.value)}
                  placeholder="Например: 1.8"
                  className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500">Мощность, л.с.</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={manualEnginePower}
                  onChange={(e) => setManualEnginePower(e.target.value)}
                  placeholder="Например: 150"
                  className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950"
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowVehicleOverrideDialog(false)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Продолжить без уточнения
              </button>
              <button
                type="button"
                disabled={!manualEngineVolume.trim() && !manualEnginePower.trim()}
                onClick={() =>
                  runVinLookup({
                    displacementL: manualEngineVolume.trim() || undefined,
                    enginePowerPS: manualEnginePower.trim() || undefined,
                  })
                }
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
              >
                Повторить подбор
              </button>
            </div>
            {vehicleOverridePromptVin && (
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">VIN: {vehicleOverridePromptVin}</p>
            )}
          </div>
        </div>
      )}

      <div className="eco-shipment-detail-layout">
        <div className="eco-shipment-detail-main">
          <section className="eco-shipment-detail-party-card">
            <div className="eco-shipment-detail-party is-client">
              <div className="eco-shipment-detail-kicker">Клиент</div>
              <div className="eco-shipment-detail-client-row">
                <div className="eco-shipment-detail-avatar">{agentInitials}</div>
                <div>
                  <h2>{agentName}</h2>
                  <p>{data.header.ecoUserName?.trim() || "Эко-платформа"} · {data.header.organizationName || "организация не указана"}</p>
                </div>
              </div>
            </div>
            <div className="eco-shipment-detail-party is-car">
              <div className="eco-shipment-detail-section-head">
                <div className="eco-shipment-detail-kicker">Автомобиль</div>
                <button
                  type="button"
                  className="eco-shipment-detail-icon-btn"
                  onClick={() => setVehicleEditing((value) => !value)}
                  aria-label={vehicleEditing ? "Закрыть редактирование автомобиля" : "Редактировать автомобиль"}
                  title={vehicleEditing ? "Закрыть" : "Редактировать"}
                >
                  <Pencil aria-hidden />
                </button>
              </div>
              {vehicleEditing ? (
                <div className="eco-shipment-detail-car-edit">
                  <label>
                    <span>Модель авто</span>
                    <input
                      type="text"
                      value={vehicleModel}
                      onChange={(e) => updateAttrValue(/^модель авто$/i, e.target.value)}
                      placeholder="AUDI q5"
                    />
                  </label>
                  <label>
                    <span>VIN</span>
                    <input
                      type="text"
                      value={documentVin}
                      onChange={(e) => {
                        const value = e.target.value;
                        setVin(value);
                        updateAttrValue(/vin/i, value);
                      }}
                      placeholder="WAUZZZ..."
                    />
                  </label>
                  <label>
                    <span>Гос. номер</span>
                    <input
                      type="text"
                      value={vehiclePlate}
                      onChange={(e) => updateAttrValue(/гос.*номер|номер/i, e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Год</span>
                    <input
                      type="text"
                      value={vehicleYear}
                      onChange={(e) => updateAttrValue(/^год$/i, e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Пробег</span>
                    <input
                      type="text"
                      value={vehicleMileage}
                      onChange={(e) => updateAttrValue(/пробег/i, e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Объём</span>
                    <input
                      type="text"
                      value={vehicleVolume}
                      onChange={(e) => updateAttrValue(/^объем$/i, e.target.value)}
                    />
                  </label>
                  <label className="is-wide">
                    <span>Моторное масло</span>
                    <input
                      type="text"
                      value={vehicleOil}
                      onChange={(e) => updateAttrValue(/моторное масло/i, e.target.value)}
                    />
                  </label>
                  <div className="eco-shipment-detail-car-edit-actions">
                    <button
                      type="button"
                      disabled={documentVin.replace(/\s/g, "").length < 8 || vinLookupLoading}
                      onClick={() => {
                        setActiveDetailTab("vin");
                        void runVinLookup();
                      }}
                    >
                      {vinLookupLoading ? "Подбор..." : "Подобрать по VIN"}
                    </button>
                    <button type="button" onClick={() => void handleOpenDiagnosticDetail()}>
                      {diagnosticRemote ? "Открыть диагностику" : "Произвести диагностику"}
                    </button>
                    <button type="button" className="is-primary" onClick={() => setVehicleEditing(false)}>
                      Готово
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h2>{vehicleModel || "Автомобиль не указан"}</h2>
                  <p>
                    {vehiclePlate || "номер не указан"}
                    {documentVin ? ` · VIN ${documentVin}` : " · VIN не указан"}
                  </p>
                  <p>
                    {vehicleMileage ? `Пробег ${vehicleMileage}` : "Пробег не указан"}
                    {vehicleYear ? ` · Год ${vehicleYear}` : ""}
                    {vehicleVolume ? ` · Объём ${vehicleVolume}` : ""}
                    {vehicleOil ? ` · ${vehicleOil}` : ""}
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="eco-shipment-detail-tabs">
            <button
              type="button"
              className={activeDetailTab === "positions" ? "is-active" : undefined}
              onClick={() => setActiveDetailTab("positions")}
            >
              Позиции <span>{positions.length}</span>
            </button>
            <button
              type="button"
              className={activeDetailTab === "vin" ? "is-active" : undefined}
              onClick={() => setActiveDetailTab("vin")}
            >
              VIN-подбор <span>{vinLookupResult?.moySkladItems.length ?? 0}</span>
            </button>
            <button
              type="button"
              className={activeDetailTab === "history" ? "is-active" : undefined}
              onClick={() => setActiveDetailTab("history")}
            >
              Поля <span>{attributes.length}</span>
            </button>
            <button
              type="button"
              className={activeDetailTab === "precheck" ? "is-active" : undefined}
              onClick={() => setActiveDetailTab("precheck")}
            >
              Предчек
            </button>
          </section>

          <section className="eco-shipment-detail-table-card">
            {activeDetailTab === "positions" && (
              <div className="eco-shipment-detail-tab-panel">
                <div className="eco-shipment-detail-product-search">
                  <label className="eco-shipment-detail-search-main">
                    <span>Добавить товар</span>
                    <Search aria-hidden />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Наименование, код или артикул"
                    />
                  </label>
                  <div className="eco-shipment-detail-search-filters">
                    <input
                      type="text"
                      value={productOem}
                      onChange={(e) => setProductOem(e.target.value)}
                      placeholder="OEM"
                    />
                    <input
                      type="text"
                      value={productMannName}
                      onChange={(e) => setProductMannName(e.target.value)}
                      placeholder="Mann"
                    />
                    <input
                      type="text"
                      value={productParams}
                      onChange={(e) => setProductParams(e.target.value)}
                      placeholder="Параметры"
                    />
                  </div>
                  {(productSearch.trim() || productOem.trim() || productMannName.trim() || productParams.trim()) && (
                    <div className="eco-shipment-detail-product-results">
                      {productSearchLoading ? (
                        <div className="eco-shipment-detail-empty is-compact">Ищем товары...</div>
                      ) : productOptions.length > 0 ? (
                        productOptions.map((p) => (
                          <button type="button" key={p.id} onClick={() => addProductOption(p)}>
                            <span>
                              <strong>{p.name}</strong>
                              <small>
                                Доступно: {p.availableQuantity ?? p.stockQuantity ?? 0}
                                {p.cell ?? p.slotName ? ` · Ячейка ${p.cell ?? p.slotName}` : ""}
                              </small>
                            </span>
                            <b>{p.price.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} {p.currency}</b>
                            <Plus aria-hidden />
                          </button>
                        ))
                      ) : (
                        <div className="eco-shipment-detail-empty is-compact">Ничего не найдено.</div>
                      )}
                    </div>
                  )}
                </div>

                {positions.length > 0 ? (
                  <div className="eco-shipment-detail-table-wrap">
                    <table className="eco-shipment-detail-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Артикул / название</th>
                          <th>Ячейка</th>
                          <th>Тип</th>
                          <th className="is-num">Кол.</th>
                          <th className="is-num">Цена</th>
                          <th className="is-num">Сумма</th>
                          <th className="is-num">Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((p, index) => {
                          const discount = typeof p.discount === "number" ? p.discount : 0;
                          const lineTotal = (p.quantity || 0) * (p.price || 0) * (1 - discount / 100);
                          const type = p.assortmentMeta?.type === "service" ? "услуга" : "товар";
                          const productHref = localProductHref(p);
                          const sourceProductId = productIdFromMeta(p.assortmentMeta);
                          return (
                            <tr key={p.id ?? `summary-${index}`}>
                              <td className="is-mono">{String(index + 1).padStart(2, "0")}</td>
                              <td>
                                {productHref ? (
                                  <Link className="eco-shipment-detail-product-link" href={productHref}>
                                    <strong>{p.name}</strong>
                                    <ExternalLink aria-hidden />
                                  </Link>
                                ) : (
                                  <strong>{p.name}</strong>
                                )}
                                <span>{sourceProductId || "локальная карточка"}</span>
                              </td>
                              <td className="is-mono">{p.slotName || "—"}</td>
                              <td><span className="eco-shipment-detail-type">{type}</span></td>
                              <td className="is-num">
                                <input
                                  type="number"
                                  min={0}
                                  step={0.1}
                                  inputMode="decimal"
                                  value={p.quantity}
                                  onChange={(e) => {
                                    const q = parseDecimalInput(e.target.value);
                                    const next = [...positions];
                                    next[index] = { ...p, quantity: q };
                                    setPositions(next);
                                  }}
                                  className="eco-shipment-detail-qty-input"
                                />
                              </td>
                              <td className="is-num">
                                <MoneyInput
                                  value={p.price}
                                  onValueChange={(val) => {
                                    const next = [...positions];
                                    next[index] = { ...p, price: val };
                                    setPositions(next);
                                  }}
                                  className="eco-shipment-detail-money-input"
                                />
                              </td>
                              <td className="is-num is-mono">{lineTotal.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽</td>
                              <td className="is-num">
                                <button
                                  type="button"
                                  className="eco-shipment-detail-delete-btn"
                                  onClick={() => setPositions((prev) => prev.filter((_, i) => i !== index))}
                                  aria-label={`Удалить ${p.name}`}
                                  title="Удалить"
                                >
                                  <Trash2 aria-hidden />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="eco-shipment-detail-empty">В отгрузке пока нет позиций. Найдите товар выше и добавьте его в документ.</div>
                )}
              </div>
            )}

            {activeDetailTab === "vin" && (
              <div className="eco-shipment-detail-tab-panel">
                <div className="eco-shipment-detail-vin-panel">
                  <div className="eco-shipment-detail-vin-form">
                    <label>
                      <span>VIN · 17 знаков</span>
                      <input
                        type="text"
                        value={vin}
                        onChange={(e) => {
                          const v = e.target.value;
                          setVin(v);
                          setManualEngineVolume("");
                          setManualEnginePower("");
                          setShowVehicleOverrideDialog(false);
                          updateAttrValue(/vin/i, v);
                        }}
                        placeholder="Например: WBAXXXXX5JZ123456"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={vin.replace(/\s/g, "").length < 8 || vinLookupLoading}
                      onClick={() => void runVinLookup()}
                    >
                      {vinLookupLoading ? "Подбор..." : "Подобрать по VIN"}
                    </button>
                    <button type="button" onClick={() => void handleOpenDiagnosticDetail()}>
                      {diagnosticRemote ? "Открыть диагностику" : "Произвести диагностику"}
                    </button>
                  </div>

                  {vinLookupResult ? (
                    <div className="eco-shipment-detail-vin-result">
                      {vinLookupResult.decodeError ? <p className="is-warning">{vinLookupResult.decodeError}</p> : null}
                      {vinLookupResult.decoded ? (
                        <div className="eco-shipment-detail-vin-summary">
                          <strong>
                            {[vinLookupResult.decoded.make, vinLookupResult.decoded.model, vinLookupResult.decoded.modelYear].filter(Boolean).join(" · ") || "Автомобиль определён"}
                          </strong>
                          <span>
                            {[
                              vinLookupResult.decoded.modification,
                              vinLookupResult.decoded.engineSeries,
                              vinLookupResult.decoded.displacementL ? `${vinLookupResult.decoded.displacementL} л` : "",
                              vinLookupResult.decoded.enginePowerPS ? `${vinLookupResult.decoded.enginePowerPS} л.с.` : "",
                            ].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                      ) : null}
                      {vinLookupResult.oilInfo ? (
                        <div className="eco-shipment-detail-vin-specs">
                          <span>Допуск: <b>{vinLookupResult.oilInfo.approval || vinLookupResult.oilInfo.acea?.join(", ") || vinLookupResult.oilInfo.api?.join(", ") || "не указан"}</b></span>
                          <span>Объём: <b>{vinLookupResult.oilInfo.fillVolumeLiters || "не указан"}</b></span>
                          <span>SAE: <b>{vinLookupResult.oilInfo.sae?.join(", ") || "не указан"}</b></span>
                        </div>
                      ) : null}
                      {vinLookupResult.moySkladError ? <p className="is-warning">{vinLookupResult.moySkladError}</p> : null}
                      {vinLookupResult.moySkladItems.length > 0 ? (
                        <div className="eco-shipment-detail-vin-items">
                          <div className="eco-shipment-detail-vin-items-head">
                            <strong>Найдено в МойСклад: {vinLookupResult.moySkladItems.length}</strong>
                            <button
                              type="button"
                              onClick={() => addFromVinLookup(vinLookupResult.moySkladItems.filter((item) => item.quantity > 0))}
                              disabled={vinLookupResult.moySkladItems.every((item) => item.quantity <= 0)}
                            >
                              Добавить всё в наличии
                            </button>
                          </div>
                          {vinLookupResult.moySkladItems.map((item, index) => (
                            <div className="eco-shipment-detail-vin-item" key={item.productId ?? `${item.name}-${index}`}>
                              <span>
                                <strong>{item.name}</strong>
                                <small>
                                  {item.article ? `Артикул ${item.article}` : "Артикул не указан"}
                                  {item.cell ? ` · Ячейка ${item.cell}` : ""}
                                  {` · Остаток ${item.quantity}`}
                                </small>
                              </span>
                              <b>{formatMoney(item.price, item.currency)}</b>
                              <button type="button" disabled={item.quantity <= 0} onClick={() => addFromVinLookup([item])}>
                                <Plus aria-hidden />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="eco-shipment-detail-empty is-compact">Пока нет найденных товаров. Запустите подбор по VIN.</div>
                      )}
                    </div>
                  ) : (
                    <div className="eco-shipment-detail-empty">Введите VIN и запустите подбор, чтобы добавить масло и фильтры в эту отгрузку.</div>
                  )}
                </div>
              </div>
            )}

            {activeDetailTab === "history" && (
              <div className="eco-shipment-detail-tab-panel">
                <div className="eco-shipment-detail-fields-grid">
                  {attributes
                    .map((a, index) => ({ a, index }))
                    .filter(({ a }) => EDITABLE_ATTR_NAMES.includes(normalizeAttrName(a.name)))
                    .map(({ a, index }) => (
                      <label key={a.id ?? a.name ?? index}>
                        <span>{a.name ?? a.id}</span>
                        <input
                          type="text"
                          value={typeof a.value === "object" ? JSON.stringify(a.value) : String(a.value ?? "")}
                          onChange={(e) => {
                            const next = [...attributes];
                            next[index] = { ...a, value: e.target.value };
                            setAttributes(next);
                          }}
                        />
                      </label>
                    ))}
                </div>
                {data.raw ? (
                  <div className="eco-shipment-detail-raw">
                    <button type="button" onClick={() => setShowRaw((v) => !v)}>
                      {showRaw ? "Скрыть все поля МойСклад" : "Показать все поля МойСклад (JSON)"}
                    </button>
                    {showRaw ? <pre>{JSON.stringify(data.raw, null, 2)}</pre> : null}
                  </div>
                ) : null}
              </div>
            )}

            {activeDetailTab === "precheck" && (
              <div className="eco-shipment-detail-tab-panel">
                <div className="eco-shipment-detail-precheck">
                  <label className="is-wide">
                    <span>Комментарий</span>
                    <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
                  </label>
                  <label className="eco-shipment-detail-checkbox">
                    <input
                      id="applicable-detail"
                      type="checkbox"
                      checked={applicable}
                      onChange={(e) => setApplicable(e.target.checked)}
                    />
                    <span>Проведён</span>
                  </label>
                  <label>
                    <span>Шаблон печати</span>
                    <select
                      value={printTemplate}
                      onChange={(e) =>
                        setPrintTemplate(
                          e.target.value as
                            | "default"
                            | "birka_own"
                            | "birka_box"
                            | "job_order"
                            | "eco_poster"
                            | "eco_poster_akpp_partial"
                            | "eco_poster_akpp_full"
                            | "under_hood_tags"
                            | "under_hood_tags_akpp_partial"
                            | "under_hood_tags_akpp_full"
                        )
                      }
                    >
                      <optgroup label="Печать из CRM">
                        <option value="eco_poster">Заказ-наряд — постер Эко (А4)</option>
                        <option value="eco_poster_akpp_partial">Заказ-наряд — постер · АКПП частичная (+20 тыс. км)</option>
                        <option value="eco_poster_akpp_full">Заказ-наряд — постер · АКПП полная (+60 тыс. км)</option>
                        <option value="under_hood_tags">Бирка под капот</option>
                        <option value="under_hood_tags_akpp_partial">Бирка под капот · АКПП частичная</option>
                        <option value="under_hood_tags_akpp_full">Бирка под капот · АКПП полная</option>
                      </optgroup>
                      <optgroup label="Шаблоны МойСклад">
                        <option value="default">Основной</option>
                        <option value="birka_own">Бирка со своим</option>
                        <option value="birka_box">Бирка коробка</option>
                        <option value="job_order">Заказ-наряд (файл из МС)</option>
                      </optgroup>
                    </select>
                  </label>
                  {error ? <p className="is-error">{error}</p> : null}
                  {paymentInfo ? <p className="is-success">{paymentInfo}</p> : null}
                  <div className="eco-shipment-detail-precheck-actions">
                    <button type="button" onClick={handleSave} disabled={saving || printing || paying || duplicating || removing}>
                      {saving ? "Сохранение..." : "Сохранить"}
                    </button>
                    <button type="button" onClick={handlePayment} disabled={saving || printing || paying || duplicating || removing}>
                      {paying ? "Открытие..." : "Предчек / оплата"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setPrinting(true);
                        setError(null);
                        try {
                          const saved = await saveShipment();
                          if (!saved) return;
                          const crmVariant = (tpl: string): string | null => {
                            if (tpl.endsWith("_akpp_partial")) return "akpp_partial";
                            if (tpl.endsWith("_akpp_full")) return "akpp_full";
                            return null;
                          };
                          const crmPrintQuery = (tpl: string) => {
                            const v = crmVariant(tpl);
                            const parts = ["autoprint=1"];
                            if (v) parts.unshift(`variant=${encodeURIComponent(v)}`);
                            return `?${parts.join("&")}`;
                          };
                          if (printTemplate.startsWith("eco_poster")) {
                            window.open(`/shipment/${data.header.id}/poster${crmPrintQuery(printTemplate)}`, "_blank");
                            return;
                          }
                          if (printTemplate.startsWith("under_hood_tags")) {
                            window.open(`/shipment/${data.header.id}/tags${crmPrintQuery(printTemplate)}`, "_blank");
                            return;
                          }
                          const res = await fetch(`/api/demands/${data.header.id}/print`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ templateKey: printTemplate }),
                          });
                          const json = await res.json();
                          if (!res.ok) {
                            setError(json.error ?? "Ошибка печати");
                            return;
                          }
                          if (json.location) {
                            window.open(json.location, "_blank");
                          } else {
                            setError("МойСклад не вернул ссылку на файл печати.");
                          }
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Ошибка печати");
                        } finally {
                          setPrinting(false);
                        }
                      }}
                      disabled={printing || saving || paying || duplicating || removing}
                    >
                      {printing ? "Печать..." : "Печать"}
                    </button>
                    <a href={`/api/demands/${data.header.id}/job-order`}>Заказ-наряд Excel</a>
                    {data.header.href ? <a href={data.header.href} target="_blank" rel="noreferrer">МойСклад</a> : null}
                    <button type="button" className="is-danger" onClick={() => void handleDeleteShipment()} disabled={saving || printing || paying || duplicating || removing}>
                      {removing ? "Удаление..." : "Удалить"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="eco-shipment-detail-aside">
          <section className="eco-shipment-detail-side-card">
            <div className="eco-shipment-detail-side-head">
              <h2>Сумма</h2>
              {paymentInfo ? <span className="eco-shipment-detail-badge is-paid">оплачено</span> : null}
            </div>
            <div className="eco-shipment-detail-side-body">
              <div className="eco-shipment-detail-money-row">
                <span>Подытог</span>
                <strong>{positionsSubtotal.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽</strong>
              </div>
              <div className="eco-shipment-detail-money-row">
                <span>Скидка</span>
                <strong>{positionsDiscount > 0 ? `${positionsDiscount.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽` : "0%"}</strong>
              </div>
              <div className="eco-shipment-detail-total-row">
                <span>Итого</span>
                <strong>{positionsTotal.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽</strong>
              </div>
              <div className="eco-shipment-detail-money-row is-muted">
                <span>Себестоимость</span>
                <strong>{positionsCost.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽</strong>
              </div>
              <div className="eco-shipment-detail-money-row is-success">
                <span>Маржа</span>
                <strong>{positionsMargin.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽ · {positionsMarginPct}%</strong>
              </div>
              {paymentInfo ? <p className="eco-shipment-detail-payment-note">{paymentInfo}</p> : null}
            </div>
          </section>

          <section className="eco-shipment-detail-side-card">
            <div className="eco-shipment-detail-side-head">
              <h2>Связи</h2>
            </div>
            <div className="eco-shipment-detail-links">
              <div>
                <strong>Документ</strong>
                <span>{data.header.name} · {documentStatus.toLowerCase()}</span>
              </div>
              <div>
                <strong>Склад</strong>
                <span>{data.header.storeName || "не указан"}</span>
              </div>
              <div>
                <strong>Диагностика</strong>
                <span>{diagnosticRemote ? `${diagnosticRemote.status} · 🟢${diagnosticRemote.summaryGreen} 🟡${diagnosticRemote.summaryYellow} 🔴${diagnosticRemote.summaryRed}` : "не создана"}</span>
              </div>
              <div>
                <strong>МойСклад</strong>
                {data.header.href ? (
                  <a href={data.header.href} target="_blank" rel="noreferrer">открыть документ →</a>
                ) : (
                  <span>ссылка не указана</span>
                )}
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div hidden className="eco-shipment-detail-legacy-workbench">
      <div className="eco-shipment-detail-workbench-title">
        <span>Рабочие поля</span>
        <strong>VIN, дополнительные поля, добавление позиций и сохранение</strong>
      </div>

      {vinAttrIndex >= 0 && (
        <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">VIN номер</h2>
            {diagnosticRemote && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                Диагностика: {diagnosticRemote.status}{" "}
                🟢{diagnosticRemote.summaryGreen} 🟡{diagnosticRemote.summaryYellow} 🔴
                {diagnosticRemote.summaryRed}
              </span>
            )}
          </div>
          <input
            type="text"
            value={vin}
            onChange={(e) => {
              const v = e.target.value;
              setVin(v);
              setManualEngineVolume("");
              setManualEnginePower("");
              setShowVehicleOverrideDialog(false);
              if (vinAttrIndex >= 0) {
                const next = [...attributes];
                next[vinAttrIndex] = { ...next[vinAttrIndex], value: v };
                setAttributes(next);
              }
            }}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-mono tracking-widest dark:border-zinc-600 dark:bg-zinc-900"
            placeholder="Например: WBAXXXXX5JZ123456"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="mb-2 w-full text-xs text-zinc-500">
              Подбор фильтров по VIN: введите номер выше и нажмите «Подобрать» — подберём масло и фильтры, найдём товары в МойСклад.
            </p>
            <button
              type="button"
              disabled={vin.replace(/\s/g, "").length < 8 || vinLookupLoading}
              onClick={() => void runVinLookup()}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
            >
              {vinLookupLoading ? "Подбор…" : "Подобрать по VIN"}
            </button>
            {(() => {
              const hasVin = vin.replace(/\s/g, "").length >= 8;
              const modelCombined = String(
                attributes.find((a) => (a.name ?? "").toLowerCase() === "модель авто")?.value ?? ""
              ).trim();
              const mp = modelCombined.split(/\s+/).filter(Boolean);
              const dec = vinLookupResult?.decoded;
              const brandModelOk =
                mp.length >= 2 || Boolean((dec?.make ?? "").trim() && (dec?.model ?? "").trim());
              const diagDisabled = !(hasVin || brandModelOk);
              return (
                <button
                  type="button"
                  disabled={diagDisabled}
                  onClick={() => void handleOpenDiagnosticDetail()}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 disabled:opacity-50 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  {diagnosticRemote ? "Открыть диагностику" : "Произвести диагностику"}
                </button>
              );
            })()}
          </div>
          {vinLookupResult && (
            <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-600 dark:bg-zinc-800/50">
              {vinLookupResult.decodeError && (
                <p className="mb-2 text-amber-700 dark:text-amber-400">{vinLookupResult.decodeError}</p>
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
                <p className="mb-2 text-amber-700 dark:text-amber-400">{vinLookupResult.moySkladError}</p>
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
                          В МойСклад по этому VIN позиции не подобраны (совпадений по OEM/допуску не найдено или нет доступа к складу).
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-3">
                        {inStockItems.length === 0 && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                            Найдено {allItems.length} позиций, но на выбранном складе остаток 0 по всем строкам. Ниже показан полный список подбора, чтобы можно было проверить соответствие и заказать.
                          </div>
                        )}
                        {filterSections.length > 0 && (
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
                        {oils.length > 0 && (() => {
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
                              {maintenanceOffers.length > 0 && (
                                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                        Готовый расчет ТО для клиента
                                      </h3>
                                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                                        Система собрала варианты из подобранного масла и фильтров (при наличии остатков — берутся самые дешёвые варианты).
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => copyMaintenanceMessage(maintenanceMessage)}
                                      className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                                    >
                                      Скопировать весь расчет
                                    </button>
                                  </div>
                                  {maintenanceCopyStatus !== "idle" && (
                                    <p className={`mt-2 text-xs ${maintenanceCopyStatus === "copied" ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}>
                                      {maintenanceCopyStatus === "copied" ? "Текст скопирован." : "Не удалось скопировать автоматически."}
                                    </p>
                                  )}
                                  <div className="mt-3 grid gap-2 lg:grid-cols-3">
                                    {maintenanceOffers.map((offer) => (
                                      <div key={offer.key} className="rounded-lg border border-white/70 bg-white/90 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                                        <div className="flex items-start justify-between gap-2">
                                          <div>
                                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                                              {offer.title}
                                            </div>
                                            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                              {offer.lines.length} поз. · {offer.note}
                                            </div>
                                          </div>
                                          <div className="text-right text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                            {formatMoney(offer.total, offer.currency)}
                                          </div>
                                        </div>
                                        <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
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
                                          className="mt-3 rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950"
                                        >
                                          Скопировать вариант
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                  <textarea
                                    readOnly
                                    value={maintenanceMessage}
                                    className="mt-3 h-44 w-full rounded-lg border border-emerald-200 bg-white/80 p-2 text-xs text-zinc-700 dark:border-emerald-800 dark:bg-zinc-950/60 dark:text-zinc-300"
                                  />
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
                              Подходящих масел по допуску не найдено в каталоге МойСклад.
                            </div>
                          );
                        })()}
                        {oils.length === 0 &&
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
                        {others.length > 0 && (
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
        </div>
      )}

      {attributes.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Дополнительные поля МойСклад
          </h2>
          <dl className="grid gap-2 sm:grid-cols-2">
            {attributes
              .map((a, index) => ({ a, index }))
              .filter(({ a }) => {
                return EDITABLE_ATTR_NAMES.includes(normalizeAttrName(a.name));
              })
              .map(({ a, index }) => (
                <div key={a.id ?? a.name ?? index}>
                  <dt className="text-xs text-zinc-500">{a.name ?? a.id}</dt>
                  <dd className="mt-0.5">
                    <input
                      type="text"
                      value={
                        typeof a.value === "object"
                          ? JSON.stringify(a.value)
                          : String(a.value ?? "")
                      }
                      onChange={(e) => {
                        const next = [...attributes];
                        next[index] = { ...a, value: e.target.value };
                        setAttributes(next);
                      }}
                      className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-mono dark:border-zinc-600 dark:bg-zinc-900"
                    />
                  </dd>
                </div>
              ))}
          </dl>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          Добавить позицию
        </h2>
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-zinc-500">Наименование, код или артикул</label>
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Поиск по названию или артикулу..."
              className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-zinc-500">OEM PARTS</label>
              <input
                type="text"
                value={productOem}
                onChange={(e) => setProductOem(e.target.value)}
                placeholder="Фильтр по OEM"
                className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500">Наименование по Mann</label>
              <input
                type="text"
                value={productMannName}
                onChange={(e) => setProductMannName(e.target.value)}
                placeholder="Фильтр по Mann"
                className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500">Параметры</label>
              <input
                type="text"
                value={productParams}
                onChange={(e) => setProductParams(e.target.value)}
                placeholder="Фильтр по параметрам"
                className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
          </div>
        </div>
        {(productSearch.trim() || productOem.trim() || productMannName.trim() || productParams.trim()) && (
            <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              {!productSearchLoading && productOptions.length > 0 && (
                <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-600">
                  <span className="flex-1">Товар</span>
                  <span className="w-14 text-right">Доступно</span>
                  <span className="w-12 text-right">Ячейка</span>
                  <span className="shrink-0">Цена</span>
                </div>
              )}
            <ul>
              {productSearchLoading && (
                <li className="px-3 py-2 text-sm text-zinc-500">Загрузка…</li>
              )}
              {!productSearchLoading &&
                productOptions.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      onClick={() => {
                        setPositions((prev) => [
                          ...prev,
                          {
                            id: undefined,
                            name: p.name,
                            quantity: 1,
                            price: p.price,
                            discount: 0,
                            discountMode: "percent",
                            discountAmount: 0,
                            assortmentMeta: p.meta,
                            slotName: p.slotName,
                          },
                        ]);
                        setProductSearch("");
                        setProductOem("");
                        setProductMannName("");
                        setProductParams("");
                        setProductOptions([]);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className={`shrink-0 w-14 text-right tabular-nums ${getStockToneClass(p.availableQuantity ?? p.stockQuantity)}`}>
                        {p.availableQuantity ?? p.stockQuantity ?? 0}
                      </span>
                      <span className="shrink-0 w-12 text-right text-zinc-500 tabular-nums">
                        {p.cell ?? p.slotName ?? ""}
                      </span>
                      <span className="text-zinc-500">
                        {p.price.toFixed(2)} {p.currency}
                      </span>
                    </button>
                </li>
              ))}
            </ul>
            </div>
        )}
      </div>

      {positions.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Позиции
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
                  <th className="px-2 py-2 font-medium text-zinc-500">Товар</th>
                  <th className="px-2 py-2 font-medium text-zinc-500">Ячейка</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Остаток</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Резерв</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Доступно</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Скидка</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Кол-во</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Цена, ₽</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Сумма, ₽</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Действия</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, index) => (
                  <tr
                    key={p.id ?? `new-${index}`}
                    className="border-b border-zinc-100 dark:border-zinc-700"
                  >
                    <td className="px-2 py-2">{p.name}</td>
                    <td className="px-2 py-2">{p.slotName ?? ""}</td>
                    <td className="px-2 py-2 text-right">
                      {p.stock?.quantity ?? ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {p.stock?.reserve ?? ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {p.stock?.available ?? ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <select
                          value={p.discountMode ?? "percent"}
                          onChange={(e) => {
                            const mode = e.target.value as "percent" | "amount";
                            const next = [...positions];
                            next[index] = { ...p, discountMode: mode };
                            setPositions(next);
                          }}
                          className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-900"
                        >
                          <option value="percent">%</option>
                          <option value="amount">₽</option>
                        </select>
                        {p.discountMode === "amount" ? (
                          <MoneyInput
                            value={p.discountAmount ?? 0}
                            onValueChange={(val) => {
                              const lineBase = (p.quantity || 0) * (p.price || 0);
                              const percent =
                                lineBase > 0 ? Math.min(100, (val / lineBase) * 100) : 0;
                              const next = [...positions];
                              next[index] = {
                                ...p,
                                discountMode: "amount",
                                discountAmount: val,
                                discount: percent,
                              };
                              setPositions(next);
                            }}
                            className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900"
                          />
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={p.discount ?? 0}
                            onChange={(e) => {
                              const percent = Number(e.target.value) || 0;
                              const clamped = Math.max(0, Math.min(100, percent));
                              const lineBase = (p.quantity || 0) * (p.price || 0);
                              const amount = lineBase * (clamped / 100);
                              const next = [...positions];
                              next[index] = {
                                ...p,
                                discountMode: "percent",
                                discount: clamped,
                                discountAmount: amount,
                              };
                              setPositions(next);
                            }}
                            className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900"
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        inputMode="decimal"
                        value={p.quantity}
                        onChange={(e) => {
                          const q = parseDecimalInput(e.target.value);
                          const next = [...positions];
                          next[index] = { ...p, quantity: q };
                          setPositions(next);
                        }}
                        className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <MoneyInput
                        value={p.price}
                        onValueChange={(val) => {
                          const next = [...positions];
                          next[index] = { ...p, price: val };
                          setPositions(next);
                        }}
                        className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      {(p.quantity *
                        (p.price || 0) *
                        (1 - (typeof p.discount === "number" ? p.discount : 0) / 100)
                      ).toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setPositions((prev) =>
                            prev.filter((_, i) => i !== index)
                          )
                        }
                        className="text-xs text-red-600 hover:underline dark:text-red-400"
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end text-sm text-zinc-700 dark:text-zinc-200">
            {(() => {
              const totalQty = positions.reduce((sum, p) => sum + (p.quantity || 0), 0);
              const totalSum = positions.reduce((sum, p) => {
                const base = (p.quantity || 0) * (p.price || 0);
                const disc = typeof p.discount === "number" ? p.discount : 0;
                return sum + base * (1 - disc / 100);
              }, 0);
              return (
                <div className="text-right">
                  <div>Кол-во всего: {totalQty}</div>
                  <div>
                    Сумма всего:{" "}
                    {totalSum.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    ₽
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <div className="mt-6 space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Комментарий
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="applicable"
            type="checkbox"
            checked={applicable}
            onChange={(e) => setApplicable(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
          />
          <label htmlFor="applicable" className="text-sm text-zinc-700 dark:text-zinc-300">
            Проведён (applicable)
          </label>
        </div>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {paymentInfo && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            {paymentInfo}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || printing || paying || duplicating || removing}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={handlePayment}
            disabled={saving || printing || paying || duplicating || removing}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
          >
            {paying ? "Открытие предчека…" : "Предчек / оплата"}
          </button>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Шаблон</label>
            <select
              value={printTemplate}
              onChange={(e) =>
                setPrintTemplate(
                  e.target.value as
                    | "eco_poster"
                    | "eco_poster_akpp_partial"
                    | "eco_poster_akpp_full"
                    | "under_hood_tags"
                    | "under_hood_tags_akpp_partial"
                    | "under_hood_tags_akpp_full"
                )
              }
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900"
            >
              <option value="eco_poster">Заказ-наряд — постер Эко (А4)</option>
              <option value="eco_poster_akpp_partial">Заказ-наряд — постер · АКПП частичная (+20 тыс. км)</option>
              <option value="eco_poster_akpp_full">Заказ-наряд — постер · АКПП полная (+60 тыс. км)</option>
              <option value="under_hood_tags">Бирка под капот (интервал из настроек)</option>
              <option value="under_hood_tags_akpp_partial">Бирка под капот · АКПП частичная (+20 тыс. км)</option>
              <option value="under_hood_tags_akpp_full">Бирка под капот · АКПП полная (+60 тыс. км)</option>
            </select>
          </div>
          <button
            type="button"
            onClick={async () => {
              setPrinting(true);
              setError(null);
              try {
                const saved = await saveShipment();
                if (!saved) return;

                const crmVariant = (tpl: string): string | null => {
                  if (tpl.endsWith("_akpp_partial")) return "akpp_partial";
                  if (tpl.endsWith("_akpp_full")) return "akpp_full";
                  return null;
                };
                const crmPrintQuery = (tpl: string) => {
                  const v = crmVariant(tpl);
                  const parts = ["autoprint=1"];
                  if (v) parts.unshift(`variant=${encodeURIComponent(v)}`);
                  return `?${parts.join("&")}`;
                };
                if (printTemplate.startsWith("eco_poster")) {
                  window.open(`/shipment/${data.header.id}/poster${crmPrintQuery(printTemplate)}`, "_blank");
                  return;
                }
                if (printTemplate.startsWith("under_hood_tags")) {
                  window.open(`/shipment/${data.header.id}/tags${crmPrintQuery(printTemplate)}`, "_blank");
                  return;
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : "Ошибка печати");
              } finally {
                setPrinting(false);
              }
            }}
            disabled={printing || saving || paying || duplicating || removing}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {printing ? "Печать…" : "Печать"}
          </button>
          <a
            href={`/api/demands/${data.header.id}/job-order`}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Заказ-наряд (Excel)
          </a>
          {data.header.href && (
            <a
              href={data.header.href}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
            >
              Открыть в МойСклад →
            </a>
          )}
          <button
            type="button"
            onClick={() => void handleDeleteShipment()}
            disabled={saving || printing || paying || duplicating || removing}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            {removing ? "Удаление…" : "Удалить"}
          </button>
        </div>
      </div>

      {data.raw ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="mb-3 text-sm font-medium text-zinc-700 hover:underline dark:text-zinc-200"
          >
            {showRaw ? "Скрыть все поля МойСклад" : "Показать все поля МойСклад (JSON)"}
          </button>
          {showRaw && (
            <div className="max-h-96 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 text-xs font-mono text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100">
              <pre>{JSON.stringify(data.raw, null, 2)}</pre>
            </div>
          )}
        </div>
      ) : null}

      </div>

      <DiagnosticModal
        open={diagnosticModalOpen}
        onClose={() => setDiagnosticModalOpen(false)}
        diagnosticId={diagnosticRowId}
        shipmentMoySkladId={id ?? null}
        headerDraft={{
          vin,
          brand: String(
            attributes.find((a) => (a.name ?? "").toLowerCase() === "модель авто")?.value ?? ""
          )
            .trim()
            .split(/\s+/)[0] ?? "",
          model: String(
            attributes.find((a) => (a.name ?? "").toLowerCase() === "модель авто")?.value ?? ""
          )
            .trim()
            .split(/\s+/)
            .slice(1)
            .join(" "),
          year: String(attributes.find((a) => (a.name ?? "").toLowerCase() === "год")?.value ?? ""),
          licensePlate: String(
            attributes.find((a) => /гос|номер/i.test(a.name ?? ""))?.value ?? ""
          ),
          mileage: String(attributes.find((a) => /пробег/i.test(a.name ?? ""))?.value ?? ""),
          agentMoySkladId:
            data?.raw && typeof data.raw === "object" && data.raw !== null && "agent" in data.raw
              ? (data.raw as { agent?: { id?: string } }).agent?.id ?? null
              : null,
        }}
        onDiagnosticCreated={(nid) => {
          setDiagnosticRowId(nid);
          setDiagnosticRemote({
            id: nid,
            status: "IN_PROGRESS",
            summaryGreen: 0,
            summaryYellow: 0,
            summaryRed: 0,
          });
        }}
        onAddedToShipment={() => window.location.reload()}
      />
    </main>
  );
}
