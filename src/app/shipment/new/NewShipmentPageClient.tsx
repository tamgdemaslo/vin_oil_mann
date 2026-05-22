"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getOilLineBaseName } from "@/lib/oil-pack-volume";
import { DiagnosticModal } from "@/components/diagnostic/DiagnosticModal";

type Meta = { href: string; type: string; mediaType: string };

type Org = { id: string; name: string; meta: Meta };
type Store = { id: string; name: string; meta: Meta };
type Counterparty = { id: string; name: string; meta: Meta };
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
  };
  discount?: number;
  discountMode?: "percent" | "amount";
  discountAmount?: number;
};

type ShipmentAttribute = { id: string; name: string; type: string; meta: Meta; value: string | null };

const EDITABLE_ATTR_NAMES = ["vin номер", "модель авто", "год", "гос. номер", "пробег", "объем", "моторное масло"];

const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";

function formatLocalMoyskladMoment(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

function NewShipmentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillCounterparty = searchParams.get("counterparty")?.trim() ?? "";
  const prefillPhone = searchParams.get("phone")?.trim() ?? "";

  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingStores, setLoadingStores] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);

  const [agentSearch, setAgentSearch] = useState("");
  const [agentOptions, setAgentOptions] = useState<Counterparty[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Counterparty | null>(null);

  const [showCreateAgentForm, setShowCreateAgentForm] = useState(false);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentCompanyType, setNewAgentCompanyType] = useState<"legal" | "entrepreneur" | "individual">("legal");
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const [newAgentPhone, setNewAgentPhone] = useState("");
  const [createAgentLoading, setCreateAgentLoading] = useState(false);
  const [createAgentError, setCreateAgentError] = useState<string | null>(null);

  const [attributes, setAttributes] = useState<ShipmentAttribute[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(true);
  const [vin, setVin] = useState("");
  const [description, setDescription] = useState("");
  const [applicable, setApplicable] = useState(false);

  const [positions, setPositions] = useState<Position[]>([]);
  const [stockByAssortment, setStockByAssortment] = useState<
    Record<string, { quantity: number; reserve?: number; available?: number; slotName?: string }>
  >({});
  const [cellByAssortment, setCellByAssortment] = useState<Record<string, number | string>>({});
  const [productSearch, setProductSearch] = useState("");
  const [productOem, setProductOem] = useState("");
  const [productMannName, setProductMannName] = useState("");
  const [productParams, setProductParams] = useState("");
  const [productOptions, setProductOptions] = useState<Product[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);

  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [momentStr, setMomentStr] = useState("");
  const [vinLookupLoading, setVinLookupLoading] = useState(false);
  const [vinLookupResult, setVinLookupResult] = useState<VinLookupResult | null>(null);
  const [showAllOilGroups, setShowAllOilGroups] = useState(false);
  const [maintenanceCopyStatus, setMaintenanceCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [manualEngineVolume, setManualEngineVolume] = useState("");
  const [manualEnginePower, setManualEnginePower] = useState("");
  const [showVehicleOverrideDialog, setShowVehicleOverrideDialog] = useState(false);
  const [vehicleOverridePromptVin, setVehicleOverridePromptVin] = useState("");

  const [demandIdLocal, setDemandIdLocal] = useState<string | null>(null);
  const [diagnosticModalOpen, setDiagnosticModalOpen] = useState(false);
  const [diagnosticRowId, setDiagnosticRowId] = useState<string | null>(null);

  useEffect(() => {
    if (prefillApplied) return;
    if (prefillCounterparty) {
      setAgentSearch(prefillCounterparty);
      setNewAgentName(prefillCounterparty);
    }
    if (prefillPhone) setNewAgentPhone(prefillPhone);
    setPrefillApplied(true);
  }, [prefillApplied, prefillCounterparty, prefillPhone]);

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
    setMomentStr(formatLocalMoyskladMoment());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then(async (data) => {
        if (cancelled) return;
        if (!data?.user) {
          router.push("/login?from=/shipment/new");
          return;
        }
        if (data.user.role === "admin" || data.user.role === "master") {
          const shift = await fetch("/api/shifts/current").then((r) => (r.ok ? r.json() : null));
          if (cancelled) return;
          if (!shift) {
            router.push(data.user.role === "admin" ? "/cash?needShift=1" : "/?needShift=1");
            return;
          }
          if (data.user.role === "admin") {
            const cash = await fetch("/api/cash").then((r) => (r.ok ? r.json() : null));
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
      const data = await res.json();
      if (res.ok && data.organizations) {
        setOrganizations(data.organizations);
        if (!selectedOrg && data.organizations.length > 0) setSelectedOrg(data.organizations[0]);
      }
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
      const data = await res.json();
      if (res.ok && data.stores) {
        setStores(data.stores);
        if (!selectedStore && data.stores.length > 0) {
          const main = data.stores.find((s: Store) => (s.name ?? "").toLowerCase().includes("основной"));
          setSelectedStore(main ?? data.stores[0]);
        }
      }
    } finally {
      setLoadingStores(false);
    }
  }, [router, selectedStore]);

  useEffect(() => {
    if (!authChecked) return;
    loadOrganizations();
    loadStores();
  }, [authChecked, loadOrganizations, loadStores]);

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
      .then((r) => r.json())
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
      .then((r) => r.json())
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
    setAttributesLoading(true);
    fetch("/api/demands/metadata")
      .then((r) => r.json())
      .then((data) => {
        if (data.attributes) {
          setAttributes(data.attributes);
          const vinIdx = data.attributes.findIndex((a: { name: string }) => /vin/i.test(a.name ?? ""));
          if (vinIdx >= 0) setVin(String(data.attributes[vinIdx]?.value ?? ""));
        }
      })
      .finally(() => setAttributesLoading(false));
  }, [authChecked]);

  useEffect(() => {
    if (!authChecked || !agentSearch.trim()) return;
    const t = setTimeout(() => {
      setAgentLoading(true);
      fetch(`/api/moysklad/counterparties?search=${encodeURIComponent(agentSearch)}&limit=20`)
        .then((r) => r.json())
        .then((data) => {
          if (data.counterparties) setAgentOptions(data.counterparties);
        })
        .finally(() => setAgentLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [authChecked, agentSearch]);

  const loadInitialCounterparties = useCallback(() => {
    if (!authChecked || selectedAgent || agentSearch.trim()) return;
    setAgentLoading(true);
    fetch("/api/moysklad/counterparties?limit=30")
      .then((r) => r.json())
      .then((data) => {
        if (data.counterparties) setAgentOptions(data.counterparties);
      })
      .finally(() => setAgentLoading(false));
  }, [authChecked, selectedAgent, agentSearch]);

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
      if (selectedStore?.id) params.set("storeId", selectedStore.id);
      if (selectedStore?.name) params.set("storeName", selectedStore.name);
      params.set("limit", "15");
      fetch(`/api/moysklad/products?${params.toString()}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.products) setProductOptions(data.products);
        })
        .finally(() => setProductSearchLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch, productOem, productMannName, productParams, selectedStore?.id, selectedStore?.name]);

  const openCreateAgentForm = () => {
    setNewAgentName(agentSearch.trim() || "");
    setNewAgentEmail("");
    setNewAgentPhone("");
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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateAgentError(data.error ?? "Ошибка создания");
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
      },
    ]);
    setProductSearch("");
    setProductOptions([]);
  };

  const runVinLookup = useCallback(async (vehicleOverrides?: { displacementL?: string; enginePowerPS?: string }) => {
    const vinClean = vin.replace(/\s/g, "").toUpperCase();
    if (vinClean.length < 8) return;
    const hasOverrides = Boolean(vehicleOverrides?.displacementL?.trim() || vehicleOverrides?.enginePowerPS?.trim());
    setVinLookupLoading(true);
    setVinLookupResult(null);
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
  }, [vin]);

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
    setPositions((prev) => prev.filter((_, i) => i !== index));
  };

  const ensureDemandForDiagnostic = async (): Promise<string | null> => {
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
        moment: formatLocalMoyskladMoment(),
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
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Ошибка создания отгрузки");
        return null;
      }
      if (!data.id) {
        setSubmitError("От МойСклад не пришёл ID созданной отгрузки");
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

      let diagId = diagnosticRowId;
      const existingRes = await fetch(`/api/diagnostic/for-shipment?shipmentId=${encodeURIComponent(sid)}`);
      const existingJson = await existingRes.json().catch(() => ({}));
      if (!existingRes.ok) {
        setSubmitError(existingJson.error ?? "Не удалось проверить существующую диагностику");
        return;
      }
      if (existingJson.diagnostic?.id) {
        diagId = existingJson.diagnostic.id as string;
      } else {
        const createRes = await fetch("/api/diagnostic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipmentMoySkladId: sid,
            agentMoySkladId: selectedAgent?.id ?? null,
            vin: vin.replace(/\s/g, "").toUpperCase() || null,
            brand: dec?.make || modelParts[0] || null,
            model: dec?.model || modelParts.slice(1).join(" ") || null,
            year: yearStr ? parseInt(yearStr, 10) || null : dec?.modelYear ? parseInt(dec.modelYear, 10) || null : null,
            licensePlate: plateStr || null,
            mileage: mileageStr ? parseInt(mileageStr.replace(/\D/g, ""), 10) || null : null,
          }),
        });
        const createJson = await createRes.json().catch(() => ({}));
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
        moment: formatLocalMoyskladMoment(),
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
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Ошибка создания отгрузки");
        return;
      }
      if (data.id) router.push(`/shipment/${data.id}`);
      else setSubmitError("От МойСклад не пришёл ID созданной отгрузки");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setSubmitLoading(false);
    }
  };

  const vinAttrIndex = attributes.findIndex((a) => typeof a?.name === "string" && /vin/i.test(a.name));
  const editableAttributes = attributes
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => EDITABLE_ATTR_NAMES.includes(normalizeAttrName(a.name)));

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/shipment" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← Отгрузки
        </Link>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Новая отгрузка</h1>
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

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div>
          <span className="text-xs text-zinc-500">Дата</span>
          <div className="text-sm">{momentStr || "—"}</div>
        </div>
        <div>
          <span className="text-xs text-zinc-500">Контрагент</span>
          <div className="text-sm">{selectedAgent?.name ?? "—"}</div>
        </div>
        <div>
          <span className="text-xs text-zinc-500">Организация</span>
          <div className="text-sm">{loadingOrgs ? "Загрузка…" : selectedOrg?.name ?? "—"}</div>
        </div>
        <div>
          <span className="text-xs text-zinc-500">Склад</span>
          <div className="text-sm">{loadingStores ? "Загрузка…" : selectedStore?.name ?? "—"}</div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Контрагент (покупатель) *</label>
        <input
          type="text"
          value={agentSearch}
          onChange={(e) => {
            setAgentSearch(e.target.value);
            if (!e.target.value.trim()) setAgentOptions([]);
          }}
          onFocus={() => {
            if (selectedAgent) setAgentSearch(selectedAgent.name);
            else loadInitialCounterparties();
          }}
          placeholder="Поиск или выберите из списка..."
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-900"
        />
        {selectedAgent && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Выбран: <strong>{selectedAgent.name}</strong>
            <button type="button" onClick={() => { setSelectedAgent(null); setAgentSearch(""); }} className="ml-2 text-amber-600 hover:underline dark:text-amber-400">
              сбросить
            </button>
          </p>
        )}
        {!selectedAgent && !showCreateAgentForm && (agentSearch.trim() || agentOptions.length > 0) && (
          <ul className="mt-1 max-h-48 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-600">
            {agentLoading && <li className="px-3 py-2 text-sm text-zinc-500">Загрузка…</li>}
            {!agentLoading && agentOptions.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  onClick={() => { setSelectedAgent(a); setAgentSearch(a.name); setAgentOptions([]); }}
                >
                  {a.name}
                </button>
              </li>
            ))}
            {!agentLoading && agentSearch && agentOptions.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">Ничего не найдено</li>}
          </ul>
        )}
        {agentSearch.trim() && !selectedAgent && !showCreateAgentForm && (
          <p className="mt-2">
            <button type="button" onClick={openCreateAgentForm} className="text-sm text-amber-600 hover:underline dark:text-amber-400">
              + Создать контрагента «{agentSearch.trim()}»
            </button>
          </p>
        )}
        {!selectedAgent && !showCreateAgentForm && !agentSearch.trim() && (
          <p className="mt-2">
            <button type="button" onClick={openCreateAgentForm} className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400">
              + Создать нового контрагента
            </button>
          </p>
        )}
        {showCreateAgentForm && (
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

      <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">VIN номер</h2>
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
              onClick={() => runVinLookup()}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
            >
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
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 disabled:opacity-50 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Произвести диагностику
                </button>
              );
            })()}
          </div>
          {submitError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{submitError}</p>}
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

      {!attributesLoading && editableAttributes.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Дополнительные поля МойСклад</h2>
          <dl className="grid gap-2 sm:grid-cols-2">
            {editableAttributes.map(({ a, index }) => (
              <div key={a.id ?? a.name ?? index}>
                <dt className="text-xs text-zinc-500">{a.name ?? a.id}</dt>
                <dd className="mt-0.5">
                  <input
                    type="text"
                    value={typeof a.value === "string" ? a.value : ""}
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
        <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Добавить позицию</h2>
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
            <div className="mt-1 max-h-48 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              {!productSearchLoading && productOptions.length > 0 && (
                <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-600">
                  <span className="flex-1">Товар</span>
                  <span className="w-14 text-right">Доступно</span>
                  <span className="w-12 text-right">Ячейка</span>
                  <span className="shrink-0">Цена</span>
                </div>
              )}
              <ul>
              {productSearchLoading && <li className="px-3 py-2 text-sm text-zinc-500">Загрузка…</li>}
              {!productSearchLoading && productOptions.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    onClick={() => addPosition(p)}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className={`shrink-0 w-14 text-right tabular-nums ${getStockToneClass(p.availableQuantity ?? p.stockQuantity)}`}>
                      {p.availableQuantity ?? p.stockQuantity ?? 0}
                    </span>
                    <span className="shrink-0 w-12 text-right text-zinc-500 tabular-nums">
                      {p.cell ?? p.slotName ?? ""}
                    </span>
                    <span className="shrink-0 text-zinc-500">{p.price.toFixed(2)} {p.currency}</span>
                  </button>
                </li>
              ))}
              </ul>
            </div>
        )}
      </div>

      {positions.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Позиции</h2>
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
                  <tr key={p.assortmentMeta?.href ?? index} className="border-b border-zinc-100 dark:border-zinc-700">
                    <td className="px-2 py-2">{p.name}</td>
                    <td className="px-2 py-2">
                      {p.cell ?? cellByAssortment[p.assortmentMeta?.href ?? ""] ?? ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {p.stock?.quantity ?? stockByAssortment[p.assortmentMeta?.href ?? ""]?.quantity ?? ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {p.stock?.reserve ?? stockByAssortment[p.assortmentMeta?.href ?? ""]?.reserve ?? ""}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {p.stock?.available ?? stockByAssortment[p.assortmentMeta?.href ?? ""]?.available ?? ""}
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
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={p.discountAmount ?? 0}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              const lineBase = (p.quantity || 0) * (p.price || 0);
                              const percent = lineBase > 0 ? Math.min(100, (val / lineBase) * 100) : 0;
                              const next = [...positions];
                              next[index] = { ...p, discountMode: "amount", discountAmount: val, discount: percent };
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
                              const percent = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                              const lineBase = (p.quantity || 0) * (p.price || 0);
                              const amount = lineBase * (percent / 100);
                              const next = [...positions];
                              next[index] = { ...p, discountMode: "percent", discount: percent, discountAmount: amount };
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
                          const next = [...positions];
                          next[index] = { ...p, quantity: parseDecimalInput(e.target.value) };
                          setPositions(next);
                        }}
                        className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={p.price}
                        onChange={(e) => {
                          const next = [...positions];
                          next[index] = { ...p, price: Number(e.target.value) || 0 };
                          setPositions(next);
                        }}
                        className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      {(p.quantity * (p.price || 0) * (1 - (typeof p.discount === "number" ? p.discount : 0) / 100)).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button" onClick={() => removePosition(index)} className="text-xs text-red-600 hover:underline dark:text-red-400">Удалить</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end text-sm text-zinc-700 dark:text-zinc-200">
            <div className="text-right">
              <div>Кол-во всего: {positions.reduce((sum, p) => sum + (p.quantity || 0), 0)}</div>
              <div>
                Сумма всего: {positions.reduce((sum, p) => {
                  const base = (p.quantity || 0) * (p.price || 0);
                  const disc = typeof p.discount === "number" ? p.discount : 0;
                  return sum + base * (1 - disc / 100);
                }, 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Комментарий</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
        </div>
        <div className="flex items-center gap-2">
          <input id="applicable" type="checkbox" checked={applicable} onChange={(e) => setApplicable(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500" />
          <label htmlFor="applicable" className="text-sm text-zinc-700 dark:text-zinc-300">Проведён (applicable)</label>
        </div>
        {submitError && <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={handleSubmit} disabled={submitLoading} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700">
            {submitLoading ? "Создание…" : "Создать отгрузку"}
          </button>
        </div>
      </div>

      <DiagnosticModal
        open={diagnosticModalOpen}
        onClose={() => setDiagnosticModalOpen(false)}
        diagnosticId={diagnosticRowId}
        shipmentMoySkladId={demandIdLocal}
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
          agentMoySkladId: selectedAgent?.id ?? null,
        }}
        onDiagnosticCreated={(id) => setDiagnosticRowId(id)}
        onAddedToShipment={() => router.refresh()}
      />
    </div>
  );
}

export function NewShipmentPageClient() {
  return <NewShipmentForm />;
}
