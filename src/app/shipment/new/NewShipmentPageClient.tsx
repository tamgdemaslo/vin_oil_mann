"use client";

import { Fragment, useState, useEffect, useCallback, useId, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Circle,
  CreditCard,
  Droplet,
  ExternalLink,
  Fan,
  Fuel,
  Pencil,
  Plus,
  Receipt,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  UserPlus,
  Wind,
  X,
} from "lucide-react";
import { DiagnosticMapModal } from "@/components/diagnostic/DiagnosticMapModal";
import { ContactActionButton } from "@/components/messenger/ContactActionButton";
import { EcoBadge, EcoButton, type EcoBadgeTone } from "@/components/platform/EcoUI";
import MoneyInput from "@/components/MoneyInput";
import { ShipmentPrintMenu } from "@/components/shipment/ShipmentPrintMenu";
import { VehicleLookupPanel } from "@/components/shipment/VehicleLookupPanel";
import { hasOpenCashShiftAccess } from "@/lib/cash-shift-access";
import { clientSessionUnavailableMessage, readClientSessionResponse } from "@/lib/client-session-response";
import { formatServiceDateTime, toServiceMomentString } from "@/lib/date-time";
import { inferDiagnosticVehicleHintsFromLookup } from "@/lib/diagnostic-vehicle-hints";
import {
  clientVehicleCompleteness,
  type ClientVehiclePassportValues,
  type ClientVehicleProfile,
} from "@/lib/client-vehicle-profile";
import { isValidMannYear, normalizeMannYearInput, shouldApplyMannRequest } from "@/lib/mann-picker-state";
import type { MannTransmissionType } from "@/lib/mann-unified-technical-profile";
import { vehicleFieldValues, type NormalizedVehicleIdentity } from "@/lib/vehicle-identity-client";
import type { MannVehicleCandidate, MannVehicleResolution } from "@/lib/mann-vehicle-resolver";
import {
  NONSTOCK_PRODUCT_ASSORTMENT_TYPE,
  NONSTOCK_PRODUCT_GROUPS,
  NONSTOCK_PRODUCT_UOMS,
  normalizeNonstockProductArticle,
  normalizeNonstockProductBrand,
  normalizeNonstockProductInput,
  type NonstockProductInput,
} from "@/lib/one-off-product";
import {
  ONE_OFF_SERVICE_AGGREGATES,
  ONE_OFF_SERVICE_CONFIGURATIONS,
  ONE_OFF_SERVICE_METRICS,
  ONE_OFF_SERVICE_PROCEDURES,
  normalizeOneOffServiceInput,
  type OneOffServiceInput,
} from "@/lib/one-off-service";

type Meta = { href: string; type: string; mediaType: string };

type Org = { id: string; name: string; meta: Meta; isDefault?: boolean; vatEnabled?: boolean; defaultVatRate?: number | null; currency?: string };
type Store = { id: string; name: string; meta: Meta; isMain?: boolean; organizationId?: string | null };
type Counterparty = {
  id: string;
  name: string;
  meta: Meta;
  phone?: string | null;
  normalizedPhone?: string | null;
  companyType?: string | null;
  counterpartyTypeName?: string | null;
  legalTitle?: string | null;
  vehiclePlate?: string | null;
  vehicleVin?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | null;
  vehicleLabel?: string | null;
  isSystem?: boolean;
  isAnonymousRetail?: boolean;
  subtitle?: string | null;
};
type ProductSearchMode = "all" | "product" | "service";
type PositionAddMode = "catalog" | "mann";
type MannManualCue = "idle" | "manual" | "plate_not_found" | "lookup_unavailable" | "partial";
type Product = {
  id: string;
  name: string;
  article?: string;
  code?: string;
  brand?: string;
  supplierName?: string;
  orderable?: boolean;
  uomName?: string;
  sae?: string;
  matchSummary?: string;
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
  uomName?: string;
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
  comment?: string;
  lineKind?: "nonstock_product" | "one_off_service";
  oneOffProduct?: NonstockProductInput & {
    groupLabel?: string;
    brandCanonical?: string;
    articleDisplay?: string;
    articleCanonical?: string;
    uomLabel?: string;
    analyticsKey?: string;
    costSource?: string;
    catalogMatchProductId?: string | null;
  };
  oneOffService?: OneOffServiceInput;
  copyMeta?: {
    status?: "linked" | "updated" | "unlinked" | "ambiguous" | "archived" | string;
    message?: string;
    priceUpdated?: boolean;
    originalPriceCents?: number;
    currentPriceCents?: number;
    archived?: boolean;
  } | null;
};

type NonstockProductDraft = {
  groupCode: string;
  brand: string;
  article: string;
  clarification: string;
  quantity: number;
  uomCode: string;
  purchasePrice: string;
  explicitZeroCost: boolean;
  salePrice: string;
  purchaseSourceId: string;
  purchaseSourceLabel: string;
  comment: string;
};

type NonstockProductOptions = {
  groups: Array<{ code: string; label: string; articleRequired: boolean }>;
  uoms: Array<{ code: string; label: string }>;
  brands: string[];
  suppliers: Array<{ id: string; name: string }>;
  normalized?: { brand?: string; article?: string; articleCanonical?: string };
  exactMatch?: Product | null;
  error?: string;
};

const EMPTY_NONSTOCK_PRODUCT_DRAFT: NonstockProductDraft = {
  groupCode: "",
  brand: "",
  article: "",
  clarification: "",
  quantity: 1,
  uomCode: "PCS",
  purchasePrice: "",
  explicitZeroCost: false,
  salePrice: "",
  purchaseSourceId: "",
  purchaseSourceLabel: "",
  comment: "",
};

type ShipmentAttribute = { id: string; name: string; type: string; meta: Meta; value: string | null; source?: string };
type SessionJson = { user?: { role?: string } };
type OrganizationsJson = { organizations?: Org[]; error?: string };
type StoresJson = { stores?: Store[]; error?: string };
type StockJson = { stockByAssortment?: Record<string, { quantity: number; reserve?: number; available?: number; slotName?: string; cost?: number }> };
type AttributesJson = { attributes?: ShipmentAttribute[]; anonymousRetailCounterparty?: Counterparty; error?: string };
type CounterpartiesJson = { counterparties?: Counterparty[]; anonymousRetailCounterparty?: Counterparty; error?: string };
type ProductsJson = { products?: Product[]; items?: Product[]; error?: string };
type AgentCreateJson = { id?: string; name?: string; meta?: Meta; error?: string };
type DemandCreateJson = { id?: string; name?: string; applicable?: boolean; description?: string; error?: string };
type DiagnosticExistingJson = { diagnostic?: { id?: string }; error?: string };
type DiagnosticCreateJson = { diagnosticId?: string; error?: string };
type ClientVehicleProfilesJson = { profiles?: ClientVehicleProfile[]; error?: string };
type ClientVehicleSaveJson = { profile?: ClientVehicleProfile; changedFields?: string[]; error?: string };

type MannMake = {
  make: string;
  countModels: number;
  countApplications: number;
};

type MannModel = {
  model: string;
  modelYears?: string | null;
  countVariants: number;
  countFilters: number;
};

type MannVariant = {
  variantId: string;
  vehicleText?: string | null;
  effectiveVehicleText?: string | null;
  engineCode?: string | null;
  kw?: string | null;
  hp?: string | null;
  vehicleYears?: string | null;
  condition?: string | null;
  countFilters: number;
};

type MannFilter = {
  filterType: "oil" | "air" | "fuel" | "cabin" | "other" | string;
  filterSubtype?: string | null;
  mannArticle: string;
  mannArticleNormalized: string;
  filterNote?: string | null;
  condition?: string | null;
  vehicleText?: string | null;
  effectiveVehicleText?: string | null;
  engineCode?: string | null;
  kw?: string | null;
  hp?: string | null;
  vehicleYears?: string | null;
  pdfPage?: number | null;
  catalogPage?: number | null;
};

type MannLocalMatch = {
  id: string;
  name: string;
  meta?: Meta;
  article?: string | null;
  code?: string | null;
  brand?: string | null;
  price: number;
  currency: string;
  stock: number;
  reserve?: number;
  available: number;
  cell?: string | null;
  buyPriceCents?: number | null;
  cost?: number;
  orderable: boolean;
  matchType:
    | "EXACT_PRODUCT_BRAND_ARTICLE"
    | "OEM_EXACT_BRAND_ARTICLE"
    | "OEM_EXACT_ARTICLE"
    | "OEM_SAFE_COMPACT"
    | "PRODUCT_MANN_LINK";
  matchConfidence: number;
  matchReason: string;
};

type MannArticleMatch = {
  mannArticle: string;
  mannArticleNormalized: string;
  filterType?: string;
  filterSubtype?: string | null;
  compatibleProducts: MannLocalMatch[];
  localMatches: MannLocalMatch[];
  bestMatch: MannLocalMatch | null;
  matchConfidence: number;
  matchReason: string;
  stock: number;
  available: number;
  price: number | null;
  cell?: string | null;
  status: "found" | "not_found";
  coverageStatus: "OEM_COVERED" | "OEM_NOT_COVERED";
  diagnostics: {
    candidateCount: number;
    compatibleCount: number;
    canonicalArticle: string;
    compactCandidate: string;
    compactCollisionBlocked: boolean;
    collisionCanonicalArticles: string[];
    localProductScanMs: number;
    parsingMs: number;
    totalMs: number;
  };
};

type MannMatchJson = { matches?: MannArticleMatch[]; error?: string };

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
    agent?: Partial<Omit<Counterparty, "meta">> & { meta?: Meta };
    organization?: { id?: string; name?: string; meta?: Meta };
    store?: { id?: string; name?: string; meta?: Meta; isMain?: boolean };
  };
  error?: string;
};

const ORGANIZATION_STORAGE_KEY = "eco-current-organization-id";
const ORGANIZATION_EVENT = "eco-organization-changed";
const VIN_FILTER_PICKER_ENABLED = process.env.NEXT_PUBLIC_VIN_FILTER_PICKER_ENABLED === "true";

function formatCents(value?: number | null): string {
  const rub = Number(value ?? 0) / 100;
  return `${rub.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;
}

function formatShipmentMoney(value?: number | null): string {
  const amount = Number(value ?? 0);
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  return `${amount.toLocaleString("ru-RU", { minimumFractionDigits: fractionDigits, maximumFractionDigits: 2 })} ₽`;
}

function formatProductSearchAvailability(product: Product, isService: boolean): string {
  if (isService) return "Услуга";
  const available = product.availableQuantity ?? product.stockQuantity ?? 0;
  return `${formatQuantityInput(available)} шт`;
}

function productSearchAvailabilityClass(product: Product, isService: boolean): string {
  if (isService) return "is-service";
  const available = product.availableQuantity ?? product.stockQuantity ?? 0;
  if (available <= 0) return "is-empty";
  if (available < 2) return "is-low";
  return "is-ok";
}

async function safeJson<T>(response: Response, fallback: T): Promise<T> {
  try {
    const text = await response.text();
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function demandSaveErrorMessage(response: Response, data: DemandCreateJson, fallback: string): string {
  const serverError = data.error?.trim();
  if (serverError) return serverError;
  const status = [response.status, response.statusText].filter(Boolean).join(" ");
  return `${fallback}. Сервер вернул ${status || "ошибку без описания"}. Проверьте серверные логи или повторите действие.`;
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
  legacyItems: VinLookupItem[];
  legacyError?: string;
};

const FILTER_SECTION_META = {
  "oil-filter": { title: "Масляные фильтры", accent: "amber" },
  "air-filter": { title: "Воздушные фильтры", accent: "sky" },
  "cabin-filter": { title: "Салонные фильтры", accent: "violet" },
  "fuel-filter": { title: "Топливные фильтры", accent: "emerald" },
} as const;

type FilterSectionKind = keyof typeof FILTER_SECTION_META;

function parseDecimalInput(value: string): number {
  return Number(value.replace(",", ".")) || 0;
}

function formatQuantityInput(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3, useGrouping: false });
}

function normalizeQuantityInput(value: string): string {
  const [whole, ...fraction] = value.replace(/\./g, ",").replace(/[^\d,]/g, "").split(",");
  return fraction.length > 0 ? `${whole},${fraction.join("")}` : whole;
}

function QuantityInput({
  value,
  onValueChange,
  className,
}: {
  value: number;
  onValueChange: (value: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(formatQuantityInput(value));
  const [isFocused, setIsFocused] = useState(false);
  const inputValue = isFocused ? draft : formatQuantityInput(value);

  return (
    <input
      type="text"
      inputMode="decimal"
      pattern="[0-9]*[,.]?[0-9]*"
      value={inputValue}
      onFocus={() => {
        setDraft(formatQuantityInput(value));
        setIsFocused(true);
      }}
      onChange={(e) => {
        const next = normalizeQuantityInput(e.target.value);
        setDraft(next);
        onValueChange(parseDecimalInput(next));
      }}
      onBlur={() => {
        setIsFocused(false);
        const parsed = parseDecimalInput(draft);
        const hasDecimalPart = draft.includes(",");
        setDraft(
          parsed.toLocaleString("ru-RU", {
            minimumFractionDigits: hasDecimalPart ? 1 : 0,
            maximumFractionDigits: 3,
            useGrouping: false,
          })
        );
      }}
      className={className}
    />
  );
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

function positionProductHref(position: Position): string | null {
  if (isNonstockProduct(position)) return null;
  const productId = localEntityIdFromMeta(position.assortmentMeta);
  if (productId) return `/inventory/products?product=${encodeURIComponent(productId)}`;
  return `/inventory/products?search=${encodeURIComponent(position.name)}`;
}

function isServiceMeta(meta?: Meta): boolean {
  return meta?.type === "service" || /^local:\/\/service\//i.test(meta?.href ?? "") || /\/entity\/service\//i.test(meta?.href ?? "");
}

function isNonstockProduct(position: Position): boolean {
  return position.lineKind === "nonstock_product"
    || position.assortmentMeta?.type === NONSTOCK_PRODUCT_ASSORTMENT_TYPE
    || Boolean(position.oneOffProduct);
}

function demandPositionPayload(position: Position, options: { priceIsCents: boolean; includeId?: boolean }) {
  return {
    id: options.includeId ? position.id : undefined,
    name: position.name,
    comment: position.comment,
    quantity: position.quantity,
    price: options.priceIsCents ? Math.round((Number(position.price) || 0) * 100) : Number(position.price) || 0,
    discount: typeof position.discount === "number" ? position.discount : 0,
    assortment: position.assortmentMeta ? { meta: position.assortmentMeta } : undefined,
    lineKind: position.lineKind,
    oneOffProduct: position.oneOffProduct
      ? {
          groupCode: position.oneOffProduct.groupCode,
          brand: position.oneOffProduct.brand,
          article: position.oneOffProduct.article,
          uomCode: position.oneOffProduct.uomCode,
          purchasePrice: position.oneOffProduct.purchasePrice,
          explicitZeroCost: position.oneOffProduct.explicitZeroCost,
          purchaseSourceId: position.oneOffProduct.purchaseSourceId,
          purchaseSourceLabel: position.oneOffProduct.purchaseSourceLabel,
          clarification: position.oneOffProduct.clarification,
        }
      : undefined,
    oneOffService: position.oneOffService,
    copyMeta: position.copyMeta,
  };
}

function counterpartyCatalogHref(counterparty: Counterparty): string {
  const id = counterparty.id?.trim() || localEntityIdFromMeta(counterparty.meta);
  if (id) return `/clients/counterparties?counterparty=${encodeURIComponent(id)}`;
  const name = counterparty.name.trim();
  return name ? `/clients/counterparties?search=${encodeURIComponent(name)}` : "/clients/counterparties";
}

function cleanCounterpartyValue(value?: string | null): string {
  const text = String(value ?? "").trim();
  return text && text !== "." && text !== "/" && text !== "..." ? text : "";
}

function counterpartyDisplayName(counterparty: Counterparty): string {
  return (
    cleanCounterpartyValue(counterparty.name) ||
    cleanCounterpartyValue(counterparty.legalTitle) ||
    cleanCounterpartyValue(counterparty.phone) ||
    cleanCounterpartyValue(counterparty.normalizedPhone) ||
    "Клиент без имени"
  );
}

function counterpartyTypeLabel(counterparty: Counterparty): string {
  const explicit = cleanCounterpartyValue(counterparty.counterpartyTypeName);
  if (explicit) return explicit;
  switch (counterparty.companyType) {
    case "individual":
      return "физлицо";
    case "entrepreneur":
      return "ИП";
    case "legal":
      return "компания";
    default:
      return "клиент";
  }
}

function counterpartyVehicleLabel(counterparty: Counterparty): string {
  return (
    cleanCounterpartyValue(counterparty.vehicleLabel) ||
    [
      [cleanCounterpartyValue(counterparty.vehicleModel), cleanCounterpartyValue(counterparty.vehicleYear)].filter(Boolean).join(" "),
      cleanCounterpartyValue(counterparty.vehiclePlate),
      cleanCounterpartyValue(counterparty.vehicleVin) ? `VIN ${cleanCounterpartyValue(counterparty.vehicleVin)}` : "",
    ]
      .filter(Boolean)
      .join(" · ")
  );
}

function counterpartySecondaryLine(counterparty: Counterparty): string {
  return [
    cleanCounterpartyValue(counterparty.legalTitle),
    cleanCounterpartyValue(counterparty.normalizedPhone),
    counterpartyVehicleLabel(counterparty),
  ].filter(Boolean).join(" · ");
}

function shouldSearchCounterparties(query: string): boolean {
  const trimmed = query.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.length >= 2 || digits.length >= 10;
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

function normalizeAttrName(value?: string): string {
  return (value ?? "").toString().trim().toLowerCase().replace(/ё/g, "е");
}

function formatVehicleAttributeInput(name: string | undefined, value: string): string {
  const normalized = normalizeAttrName(name);
  if (/vin/.test(normalized)) return value.replace(/\s/g, "").toUpperCase().slice(0, 17);
  if (
    normalized === "модель авто" ||
    normalized === "модель" ||
    normalized === "марка / модель" ||
    normalized === "марка модель" ||
    normalized === "номер" ||
    /гос.*номер|госномер|plate/.test(normalized)
  ) return value.toUpperCase();
  return value;
}

function profileText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result || undefined;
}

function profileNumber(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function parseVehicleNumber(value: string): number | null {
  const match = value.replace(/\s+/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const result = Number(match[0]);
  return Number.isFinite(result) ? result : null;
}

function splitVehicleMakeModel(value: string): { make: string; model: string } {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return { make: "", model: "" };
  const upper = normalized.toUpperCase();
  const compoundMakes = ["LAND ROVER", "ALFA ROMEO", "ASTON MARTIN", "GREAT WALL", "MERCEDES BENZ", "MERCEDES-BENZ"];
  const compound = compoundMakes.find((make) => upper === make || upper.startsWith(`${make} `));
  if (compound) return { make: normalized.slice(0, compound.length), model: normalized.slice(compound.length).trim() };
  const [make = "", ...model] = normalized.split(" ");
  return { make, model: model.join(" ") };
}

function profileToVehicleIdentity(profile: ClientVehicleProfile): NormalizedVehicleIdentity {
  return {
    vin: profileText(profile.vin),
    frameNumber: profileText(profile.frameNumber),
    licensePlate: profileText(profile.plate),
    makeRaw: profileText(profile.make),
    makeCanonical: profileText(profile.makeCanonical),
    modelRaw: profileText(profile.model),
    modelCanonical: profileText(profile.modelCanonical),
    generationRaw: profileText(profile.generation),
    generationCanonical: profileText(profile.generationCanonical),
    bodyName: profileText(profile.bodyName),
    bodyCode: profileText(profile.bodyCode),
    bodyType: profileText(profile.bodyType),
    year: profileNumber(profile.year),
    modelYearFrom: profileNumber(profile.modelYearFrom),
    modelYearTo: profileNumber(profile.modelYearTo),
    engineName: profileText(profile.engineName),
    engineCode: profileText(profile.engineCode),
    engineSeries: profileText(profile.engineSeries),
    engineVolumeCc: profileNumber(profile.engineVolumeCc),
    engineVolumeLiters: profileNumber(profile.engineVolumeCc) ? Number((profileNumber(profile.engineVolumeCc)! / 1000).toFixed(3)) : undefined,
    powerHp: profileNumber(profile.powerHp),
    powerKw: profileNumber(profile.powerKw),
    fuelType: profileText(profile.fuelType),
    transmissionType: profileText(profile.transmissionType),
    transmissionName: profileText(profile.transmissionName),
    driveType: profileText(profile.driveType),
    steeringPosition: profileText(profile.steeringPosition),
    market: profileText(profile.market),
    countryOfOrigin: profileText(profile.countryOfOrigin),
    mileage: profileNumber(profile.mileage),
    ownersCount: profileNumber(profile.ownersCount),
    sourceMethods: ["manual"],
    confidence: profile.confidence === "HIGH" ? "high" : profile.confidence === "MEDIUM" ? "medium" : "low",
    rawResultIds: [],
    vinStatus: "unknown",
  };
}

function mergeVehicleAttributes(current: ShipmentAttribute[], vehicle: NormalizedVehicleIdentity) {
  const fields = vehicleFieldValues(vehicle);
  const next = [...current];
  for (const [attributeName, field] of Object.entries(fields)) {
    if (!field?.value) continue;
    const normalizedTarget = normalizeAttrName(attributeName);
    const index = next.findIndex((attribute) => normalizeAttrName(attribute.name) === normalizedTarget);
    if (index >= 0) {
      const attribute = next[index];
      if (!attribute || attributeValueToString(attribute.value).trim()) continue;
      next[index] = { ...attribute, value: field.value, source: field.source };
      continue;
    }
    next.push({
      id: `vehicle-profile-${normalizedTarget.replace(/\s+/g, "-")}`,
      name: attributeName,
      type: "string",
      meta: { href: `local://demand-attribute/${encodeURIComponent(attributeName)}`, type: "demandattribute", mediaType: "application/json" },
      value: field.value,
      source: field.source,
    });
  }
  return next;
}

function isBlankUiValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "null" || normalized === "undefined";
}

function attributeValueToString(value: unknown): string {
  if (isBlankUiValue(value)) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return isBlankUiValue(name) ? "" : String(name);
  }
  return "";
}

function getAttributeString(attributes: ShipmentAttribute[], matches: (name: string) => boolean): string {
  const attr = attributes.find((a) => matches((a.name ?? "").toLowerCase()));
  return attributeValueToString(attr?.value).trim();
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

function getVinLookupItemTypeLabel(item: VinLookupItem): string {
  switch (item.lookupKind) {
    case "oil":
      return "моторное масло";
    case "oil-filter":
      return "масляный фильтр";
    case "air-filter":
      return "воздушный фильтр";
    case "cabin-filter":
      return "салонный фильтр";
    case "fuel-filter":
      return "топливный фильтр";
    case "other":
      return "прочее";
    default:
      break;
  }
  const filterKind = detectFilterKind(item);
  if (filterKind) return getFilterLinePrefix(filterKind).toLowerCase();
  if (/масл|oil/i.test(item.name)) return "моторное масло";
  return "прочее";
}

function getMannFilterTypeLabel(type?: string): string {
  switch (type) {
    case "oil":
      return "Масляный фильтр";
    case "air":
      return "Воздушный фильтр";
    case "fuel":
      return "Топливный фильтр";
    case "cabin":
      return "Салонный фильтр";
    default:
      return "Прочее";
  }
}

function getMannFilterGroupPath(type?: string): string {
  switch (type) {
    case "oil":
      return "Масляные фильтры";
    case "air":
      return "Воздушные фильтры";
    case "fuel":
      return "Топливные фильтры";
    case "cabin":
      return "Салонные фильтры";
    default:
      return "Прочее";
  }
}

function MannFilterTypeIcon({ type }: { type?: string }) {
  const label = getMannFilterTypeLabel(type);
  const Icon = type === "oil" ? Droplet : type === "air" ? Wind : type === "fuel" ? Fuel : type === "cabin" ? Fan : Circle;
  return (
    <span className="eco-shipment-mann-kind-icon" data-filter-type={type ?? "other"} title={label} aria-label={label}>
      <Icon size={18} strokeWidth={1.9} aria-hidden />
    </span>
  );
}

function formatMannMatchCount(count: number): string {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "совпадение" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "совпадения" : "совпадений";
  return `${count} ${word}`;
}

function formatMannVariantCount(count: number): string {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "вариант" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "варианта" : "вариантов";
  return `${count} ${word}`;
}

function formatMannCategoryCount(count: number): string {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "категория" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "категории" : "категорий";
  return `${count} ${word}`;
}

function mannFilterGroupOrder(type?: string): number {
  switch (type) {
    case "oil":
      return 1;
    case "air":
      return 2;
    case "fuel":
      return 3;
    case "cabin":
      return 4;
    default:
      return 5;
  }
}

function describeMannVariant(variant: MannVariant): string {
  const title = variant.effectiveVehicleText || variant.vehicleText || "Все модификации";
  const details = [
    variant.engineCode,
    variant.kw ? `${variant.kw} kW` : "",
    variant.hp ? `${variant.hp} hp` : "",
    variant.vehicleYears,
  ].filter(Boolean);
  return details.length > 0 ? `${title} · ${details.join(" · ")}` : title;
}

type MannComboboxOption = {
  value: string;
  label: string;
  meta?: string;
  searchText?: string;
};

const MANN_MAKE_ALIASES: Record<string, string[]> = {
  BMW: ["бм", "бмв", "бмw"],
  AUDI: ["ауди"],
  "MERCEDES-BENZ": ["мерс", "мерседес", "мерседес бенц", "mercedes"],
  VOLKSWAGEN: ["vw", "фолькс", "фольксваген", "volkswagen", "volks"],
  "VW (VOLKSWAGEN)": ["vw", "фолькс", "фольксваген", "volkswagen", "volks"],
  SKODA: ["шкода"],
  TOYOTA: ["тойота"],
  NISSAN: ["ниссан"],
  HYUNDAI: ["хендай", "хундай", "хюндай"],
  KIA: ["киа", "kia"],
  "KIA MOTORS": ["киа", "kia"],
  RENAULT: ["рено"],
  PEUGEOT: ["пежо"],
  CITROEN: ["ситроен"],
  OPEL: ["опель"],
};

function transliterateMannSearch(value: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya",
  };
  return value.replace(/[а-яё]/giu, (char) => map[char.toLowerCase()] ?? char);
}

function normalizeMannComboSearch(value: unknown): string {
  return transliterateMannSearch(String(value ?? ""))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function mannComboSearchKey(value: unknown): string {
  return normalizeMannComboSearch(value).replace(/\s+/g, "");
}

function mannOptionMatchesQuery(option: MannComboboxOption, query: string): boolean {
  const normalizedQuery = normalizeMannComboSearch(query);
  if (!normalizedQuery) return true;
  const compactQuery = mannComboSearchKey(query);
  const haystack = normalizeMannComboSearch([option.label, option.meta, option.searchText].filter(Boolean).join(" "));
  const compactHaystack = haystack.replace(/\s+/g, "");
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  return (
    compactHaystack.includes(compactQuery) ||
    tokens.every((token) => haystack.includes(token) || compactHaystack.includes(token.replace(/\s+/g, "")))
  );
}

function MannCombobox({
  inputId,
  label,
  placeholder,
  helper,
  value,
  query,
  options,
  loading,
  disabled,
  onSelect,
  onQueryChange,
  onClear,
}: {
  inputId?: string;
  label: string;
  placeholder: string;
  helper?: string;
  value: string;
  query: string;
  options: MannComboboxOption[];
  loading?: boolean;
  disabled?: boolean;
  onSelect: (value: string) => void;
  onQueryChange: (value: string) => void;
  onClear: () => void;
}) {
  const menuId = useId();
  const helperId = helper ? `${menuId}-helper` : undefined;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const selected = options.find((option) => option.value === value) ?? null;
  const visibleOptions = useMemo(
    () => options.filter((option) => mannOptionMatchesQuery(option, query)),
    [options, query]
  );
  const activeIndex = visibleOptions.length > 0 ? Math.min(highlighted, visibleOptions.length - 1) : 0;
  const activeOptionId = open && visibleOptions.length > 0 ? `${menuId}-option-${activeIndex}` : undefined;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open, selected?.label]);

  const choose = (option: MannComboboxOption) => {
    onSelect(option.value);
    onQueryChange(option.label);
    setHighlighted(0);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`eco-mann-combobox ${disabled ? "is-disabled" : ""}`}>
      <label className="eco-field">
        <span>{label}</span>
        <div className="eco-mann-combobox-input">
          <input
            id={inputId}
            className="eco-input"
            type="text"
            value={query}
            disabled={disabled}
            placeholder={loading ? "Ищем..." : placeholder}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={open}
            aria-controls={menuId}
            aria-activedescendant={activeOptionId}
            aria-describedby={helperId}
            aria-autocomplete="list"
            onFocus={(event) => {
              if (disabled) return;
              const input = event.currentTarget;
              setHighlighted(0);
              setOpen(true);
              if (!query && selected?.label) onQueryChange(selected.label);
              window.setTimeout(() => input.select(), 0);
            }}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setHighlighted(0);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setHighlighted((index) => (visibleOptions.length > 0 ? Math.min(visibleOptions.length - 1, index + 1) : 0));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                setHighlighted((index) => Math.max(0, index - 1));
                return;
              }
              if (event.key === "Enter") {
                const option = visibleOptions[activeIndex] ?? visibleOptions[0];
                if (option) {
                  event.preventDefault();
                  choose(option);
                }
              }
            }}
          />
          {value ? (
            <button
              type="button"
              aria-label={`Очистить ${label.toLowerCase()}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onClear();
                onQueryChange("");
                setOpen(true);
              }}
            >
              <X className="eco-icon" aria-hidden />
            </button>
          ) : null}
        </div>
        {helper ? <small id={helperId} className="eco-mann-combobox-helper">{helper}</small> : null}
      </label>
      {open && !disabled ? (
        <div id={menuId} className="eco-mann-combobox-menu" role="listbox" onMouseDown={(event) => event.preventDefault()}>
          {loading ? (
            <div className="eco-mann-combobox-state">Ищем...</div>
          ) : visibleOptions.length > 0 ? (
            <>
              <div className="eco-mann-combobox-count" aria-live="polite">
                {visibleOptions.length === options.length
                  ? `Всего вариантов: ${options.length}`
                  : `Найдено: ${visibleOptions.length} из ${options.length}`}
              </div>
              {visibleOptions.map((option, index) => (
                <button
                  id={`${menuId}-option-${index}`}
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  className={activeIndex === index ? "is-highlighted" : undefined}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(option)}
                >
                  <strong>{option.label}</strong>
                  {option.meta ? <span>{option.meta}</span> : null}
                </button>
              ))}
            </>
          ) : (
            <div className="eco-mann-combobox-state">
              <strong>Ничего не найдено</strong>
              <span>Попробуйте другой запрос</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

type NewShipmentFormProps = {
  demandId?: string;
  copied?: boolean;
};

type EntityCardHeaderProps = {
  title: string;
  status?: string;
  tone?: EcoBadgeTone;
  action?: ReactNode;
};

function EntityCardHeader({ title, status, tone = "neutral", action }: EntityCardHeaderProps) {
  return (
    <div className="eco-shipment-card-head eco-entity-card-head">
      <div>
        <h2>{title}</h2>
      </div>
      <div className="eco-entity-card-head-actions">
        {status ? (
          <EcoBadge tone={tone} dot>
            {status}
          </EcoBadge>
        ) : null}
        {action}
      </div>
    </div>
  );
}

type KeyValueItem = {
  key: string;
  label: string;
  value: ReactNode;
  wide?: boolean;
};

function KeyValueGrid({ items }: { items: KeyValueItem[] }) {
  return (
    <dl className="eco-key-value-grid">
      {items.map((item) => (
        <div key={item.key} className={item.wide ? "is-wide" : undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type PositionAvailabilityViewProps = {
  isService: boolean;
  isNonstock?: boolean;
  slot?: number | string | null;
  quantity?: number;
  reserve?: number;
  available?: number;
  needed: number;
};

function PositionAvailabilityView({ isService, isNonstock = false, slot, quantity, reserve, available, needed }: PositionAvailabilityViewProps) {
  if (isService) {
    return (
      <div className="eco-position-availability">
        <strong>Услуга</strong>
        <span>Без складского остатка</span>
      </div>
    );
  }
  if (isNonstock) {
    return (
      <div className="eco-position-availability is-nonstock">
        <strong>Вне склада</strong>
        <span>Не учитывается в остатках</span>
      </div>
    );
  }

  const hasAvailable = typeof available === "number";
  const hasQuantity = typeof quantity === "number";
  const hasReserve = typeof reserve === "number";
  const availableLabel = hasAvailable ? available : hasQuantity ? quantity : 0;
  const isShort = hasAvailable && available < needed;
  const slotLabel = slot == null || String(slot).trim() === "" ? "Ячейка не указана" : `Ячейка ${slot}`;

  return (
    <div className={`eco-position-availability ${isShort ? "is-warning" : ""}`}>
      <strong>{isShort ? "Недостаточно" : `Доступно: ${availableLabel}`}</strong>
      <span>
        {isShort
          ? `Доступно: ${availableLabel} · нужно: ${needed}`
          : `Остаток: ${hasQuantity ? quantity : "—"}${hasReserve ? ` · резерв: ${reserve}` : ""}`}
      </span>
      <span>{slotLabel}</span>
    </div>
  );
}

function NewShipmentForm({ demandId, copied = false }: NewShipmentFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillCounterparty = searchParams.get("counterparty")?.trim() ?? "";
  const prefillPhone = searchParams.get("phone")?.trim() ?? "";
  const prefillComment = searchParams.get("comment")?.trim() ?? "";
  const prefillVin = searchParams.get("vin")?.trim() ?? "";
  const prefillVehicle = searchParams.get("vehicle")?.trim() ?? "";
  const prefillPlate = searchParams.get("plate")?.trim() ?? "";
  const crmDealId = searchParams.get("crmDealId")?.trim() ?? "";
  const prefillAgentQuery = prefillCounterparty || prefillPhone;
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
  const [anonymousRetailAgent, setAnonymousRetailAgent] = useState<Counterparty | null>(null);
  const [replacingAgent, setReplacingAgent] = useState(false);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [highlightedAgentIndex, setHighlightedAgentIndex] = useState(0);
  const agentSearchRef = useRef<HTMLDivElement | null>(null);
  const [vehicleEditorOpen, setVehicleEditorOpen] = useState(false);
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vehicleDraftValues, setVehicleDraftValues] = useState<Record<string, string>>({});
  const [vehicleProfile, setVehicleProfile] = useState<ClientVehicleProfile | null>(null);
  const [vehicleProfileLoading, setVehicleProfileLoading] = useState(false);
  const [vehicleProfileError, setVehicleProfileError] = useState("");
  const [identifiedVehicle, setIdentifiedVehicle] = useState<NormalizedVehicleIdentity | null>(null);
  const [positionAddMode, setPositionAddMode] = useState<PositionAddMode>("mann");

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
  const [, setAttributesLoading] = useState(true);
  const [, setAttributesError] = useState<string | null>(null);
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
  const [productParams, setProductParams] = useState("");
  const [productSearchMode, setProductSearchMode] = useState<ProductSearchMode>("all");
  const [productOptions, setProductOptions] = useState<Product[]>([]);
  const [productAddQuantities, setProductAddQuantities] = useState<Record<string, number>>({});
  const [showOrderableProducts, setShowOrderableProducts] = useState(false);
  const [showUnavailableProducts, setShowUnavailableProducts] = useState(false);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [productSearchError, setProductSearchError] = useState<string | null>(null);
  const [productResultsOpen, setProductResultsOpen] = useState(false);
  const [highlightedProductIndex, setHighlightedProductIndex] = useState(0);
  const [productAddNotice, setProductAddNotice] = useState("");
  const [productSearchRetrySeed, setProductSearchRetrySeed] = useState(0);
  const [recentlyAddedPositionIndex, setRecentlyAddedPositionIndex] = useState<number | null>(null);
  const [positionsExpanded, setPositionsExpanded] = useState(false);
  const productResultsDismissedRef = useRef(false);
  const [oneOffServiceOpen, setOneOffServiceOpen] = useState(false);
  const [oneOffServiceName, setOneOffServiceName] = useState("");
  const [oneOffServicePrice, setOneOffServicePrice] = useState("");
  const [oneOffServiceComment, setOneOffServiceComment] = useState("");
  const [oneOffServiceMetricCode, setOneOffServiceMetricCode] = useState("");
  const [oneOffServiceAggregateType, setOneOffServiceAggregateType] = useState("UNKNOWN");
  const [oneOffServiceProcedure, setOneOffServiceProcedure] = useState("UNKNOWN");
  const [oneOffServiceConfiguration, setOneOffServiceConfiguration] = useState("UNKNOWN");
  const [nonstockProductOpen, setNonstockProductOpen] = useState(false);
  const [nonstockProductEditingIndex, setNonstockProductEditingIndex] = useState<number | null>(null);
  const [nonstockProductDraft, setNonstockProductDraft] = useState<NonstockProductDraft>(EMPTY_NONSTOCK_PRODUCT_DRAFT);
  const [nonstockProductOptions, setNonstockProductOptions] = useState<NonstockProductOptions>({
    groups: [...NONSTOCK_PRODUCT_GROUPS],
    uoms: [...NONSTOCK_PRODUCT_UOMS],
    brands: [],
    suppliers: [],
  });
  const [nonstockProductOptionsLoading, setNonstockProductOptionsLoading] = useState(false);
  const [nonstockProductError, setNonstockProductError] = useState<string | null>(null);

  const [submitLoading, setSubmitLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [momentStr, setMomentStr] = useState("");
  const [vinLookupLoading, setVinLookupLoading] = useState(false);
  const [vinLookupResult, setVinLookupResult] = useState<VinLookupResult | null>(null);
  const [manualEngineVolume, setManualEngineVolume] = useState("");
  const [manualEnginePower, setManualEnginePower] = useState("");
  const [showVehicleOverrideDialog, setShowVehicleOverrideDialog] = useState(false);
  const [vehicleOverridePromptVin, setVehicleOverridePromptVin] = useState("");
  const [mannMakes, setMannMakes] = useState<MannMake[]>([]);
  const [mannModels, setMannModels] = useState<MannModel[]>([]);
  const [mannVariants, setMannVariants] = useState<MannVariant[]>([]);
  const [mannFilters, setMannFilters] = useState<MannFilter[]>([]);
  const [mannMatches, setMannMatches] = useState<Record<string, MannArticleMatch>>({});
  const [selectedMannMake, setSelectedMannMake] = useState("");
  const [selectedMannModel, setSelectedMannModel] = useState("");
  const [selectedMannVariantId, setSelectedMannVariantId] = useState("");
  const [mannMakeQuery, setMannMakeQuery] = useState("");
  const [mannModelQuery, setMannModelQuery] = useState("");
  const [mannVariantQuery, setMannVariantQuery] = useState("");
  const [mannYear, setMannYear] = useState("");
  const [mannLoading, setMannLoading] = useState<"makes" | "models" | "variants" | "filters" | "matches" | null>(null);
  const [mannError, setMannError] = useState<string | null>(null);
  const [manualMannFilter, setManualMannFilter] = useState<MannFilter | null>(null);
  const [mannPickerExpanded, setMannPickerExpanded] = useState(false);
  const [mannManualCue, setMannManualCue] = useState<MannManualCue>("idle");
  const mannAutoSelectionRef = useRef<{ make: string; model: string; variantId: string } | null>(null);
  const mannModelsRequestIdRef = useRef(0);
  const mannVariantsRequestIdRef = useRef(0);

  const [demandIdLocal, setDemandIdLocal] = useState<string | null>(null);
  const [existingDemandName, setExistingDemandName] = useState<string | null>(null);
  const [existingDemandLoading, setExistingDemandLoading] = useState(Boolean(demandId));
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saved" | "error">("idle");
  const [copyNotice, setCopyNotice] = useState(copied);
  const [diagnosticModalOpen, setDiagnosticModalOpen] = useState(false);
  const [diagnosticRowId, setDiagnosticRowId] = useState<string | null>(null);
  const [summarySheetOpen, setSummarySheetOpen] = useState(false);
  const [documentParamsOpen, setDocumentParamsOpen] = useState(false);

  const markDraftDirty = useCallback(() => {
    if (isExistingDraft) setSaveState("dirty");
  }, [isExistingDraft]);

  useEffect(() => {
    if (prefillApplied) return;
    if (prefillAgentQuery) {
      setAgentSearch(prefillAgentQuery);
      setNewAgentName(prefillCounterparty || prefillPhone);
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
      if (prefillVin) setVin(formatVehicleAttributeInput("vin", prefillVin));
    }
    setPrefillApplied(true);
  }, [isExistingDraft, prefillAgentQuery, prefillApplied, prefillComment, prefillCounterparty, prefillPhone, prefillPlate, prefillVehicle, prefillVin]);

  useEffect(() => {
    if (!prefillAgentQuery || selectedAgent || agentOptions.length === 0) return;
    const expectedName = prefillCounterparty.trim().toLowerCase();
    const expectedPhone = prefillPhone.replace(/\D/g, "");
    const exactByName = expectedName ? agentOptions.find((item) => item.name.trim().toLowerCase() === expectedName) : undefined;
    const exactByPhone = expectedPhone
      ? agentOptions.find((item) => [item.phone, item.normalizedPhone].some((value) => String(value ?? "").replace(/\D/g, "").includes(expectedPhone.slice(-10))))
      : undefined;
    const exact = exactByName ?? exactByPhone ?? (agentOptions.length === 1 ? agentOptions[0] : undefined);
    if (!exact) return;
    setSelectedAgent(exact);
    setAgentSearch(exact.name);
    setAgentOptions([]);
    setReplacingAgent(false);
  }, [agentOptions, prefillAgentQuery, prefillCounterparty, prefillPhone, selectedAgent]);

  useEffect(() => {
    setMomentStr(toServiceMomentString());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((response) => readClientSessionResponse<SessionJson>(response))
      .then(async (sessionResult) => {
        if (cancelled) return;
        if (sessionResult.status === "unauthenticated") {
          router.push("/login?from=/shipment/new");
          return;
        }
        if (sessionResult.status === "unavailable") {
          setSubmitError(clientSessionUnavailableMessage(sessionResult));
          return;
        }
        const data = sessionResult.data;
        if (data.user.role === "admin" || data.user.role === "master") {
          const cash = await fetch("/api/cash", { cache: "no-store" }).then((r) =>
            r.ok ? safeJson<{ shift?: { status?: string } } | null>(r, null) : null
          );
          if (cancelled) return;
          if (!hasOpenCashShiftAccess(data.user.role, cash?.shift)) {
            router.push(data.user.role === "admin" ? "/cash?needCashShift=1" : "/?needCashShift=1");
            return;
          }
        }
        setAuthChecked(true);
      })
      .catch(() => {
        if (!cancelled) setSubmitError("Не удалось проверить авторизацию. Проверьте соединение и обновите страницу.");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadOrganizations = useCallback(async () => {
    setLoadingOrgs(true);
    try {
      const res = await fetch("/api/local-inventory/organizations");
      if (res.status === 401) {
        router.push("/login?from=/shipment/new");
        return;
      }
      const data = await safeJson<OrganizationsJson>(res, {});
      if (res.ok && data.organizations) {
        const nextOrganizations = data.organizations;
        setOrganizations(nextOrganizations);
        setSelectedOrg((current) => {
          if (current) {
            return nextOrganizations.find((org) => org.id === current.id) ?? nextOrganizations.find((org) => org.name === current.name) ?? current;
          }
          const storedId = typeof window !== "undefined" ? window.localStorage.getItem(ORGANIZATION_STORAGE_KEY) : "";
          return nextOrganizations.find((org) => org.id === storedId)
            ?? nextOrganizations.find((org) => org.isDefault)
            ?? nextOrganizations[0]
            ?? null;
        });
      }
    } catch {
      setOrganizations([]);
    } finally {
      setLoadingOrgs(false);
    }
  }, [router]);

  const loadStores = useCallback(async () => {
    setLoadingStores(true);
    try {
      const params = selectedOrg?.id ? `?organizationId=${encodeURIComponent(selectedOrg.id)}` : "";
      const res = await fetch(`/api/local-inventory/store-options${params}`);
      if (res.status === 401) {
        router.push("/login?from=/shipment/new");
        return;
      }
      const data = await safeJson<StoresJson>(res, {});
      if (res.ok && data.stores) {
        const nextStores = data.stores;
        setStores(nextStores);
        setSelectedStore((current) => {
          if (current && nextStores.some((store) => store.id === current.id)) {
            return nextStores.find((store) => store.id === current.id) ?? current;
          }
          if (nextStores.length === 0) return null;
          const main = nextStores.find((s: Store) => s.isMain || (s.name ?? "").toLowerCase().includes("основной"));
          return main ?? nextStores[0];
        });
      }
    } catch {
      setStores([]);
    } finally {
      setLoadingStores(false);
    }
  }, [router, selectedOrg?.id]);

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
          if (prefillVin && /vin/i.test(name)) return { ...attribute, value: formatVehicleAttributeInput(attribute.name, prefillVin) };
          if (prefillPlate && /^гос\.?\s*номер$|^госномер$|license\s*plate|plate/i.test(name)) return { ...attribute, value: formatVehicleAttributeInput(attribute.name, prefillPlate) };
          if (prefillVehicle && /модель|авто|vehicle|car/i.test(name)) return { ...attribute, value: formatVehicleAttributeInput(attribute.name, prefillVehicle) };
          return attribute;
        });
        setAttributes((currentAttributes) => {
          if (currentAttributes.length === 0) return nextAttributes;
          const currentByName = new Map(
            currentAttributes.map((attribute) => [normalizeAttrName(attribute.name), attribute])
          );
          const mergedNames = new Set<string>();
          const merged = nextAttributes.map((attribute) => {
            const normalizedName = normalizeAttrName(attribute.name);
            mergedNames.add(normalizedName);
            const current = currentByName.get(normalizedName);
            const currentValue = attributeValueToString(current?.value);
            if (currentValue && !attributeValueToString(attribute.value)) {
              return { ...attribute, value: currentValue };
            }
            return attribute;
          });
          for (const current of currentAttributes) {
            const normalizedName = normalizeAttrName(current.name);
            if (mergedNames.has(normalizedName)) continue;
            if (!attributeValueToString(current.value)) continue;
            merged.push(current);
          }
          return merged;
        });
        const vinIdx = nextAttributes.findIndex((a: { name: string }) => /vin/i.test(a.name ?? ""));
        if (vinIdx >= 0) setVin((prev) => prev || formatVehicleAttributeInput(nextAttributes[vinIdx]?.name, attributeValueToString(nextAttributes[vinIdx]?.value)));
      }
      if (data.anonymousRetailCounterparty) {
        const anonymousRetail = data.anonymousRetailCounterparty;
        setAnonymousRetailAgent(anonymousRetail);
        if (!prefillAgentQuery) {
          setSelectedAgent((current) => current ?? anonymousRetail);
          setAgentSearch((current) => current || counterpartyDisplayName(anonymousRetail));
        }
      }
    } catch (error) {
      setAttributesError(error instanceof Error ? error.message : "Не удалось загрузить дополнительные поля");
    } finally {
      setAttributesLoading(false);
    }
  }, [prefillAgentQuery, prefillPlate, prefillVehicle, prefillVin]);

  useEffect(() => {
    if (!authChecked) return;
    loadOrganizations();
  }, [authChecked, loadOrganizations]);

  useEffect(() => {
    if (!authChecked) return;
    loadStores();
  }, [authChecked, loadStores]);

  useEffect(() => {
    function handleOrganizationChanged(event: Event) {
      const id = (event as CustomEvent<{ organizationId?: string }>).detail?.organizationId;
      if (!id) return;
      const org = organizations.find((item) => item.id === id);
      if (org) {
        setSelectedOrg(org);
        markDraftDirty();
      } else {
        void loadOrganizations();
      }
    }
    window.addEventListener(ORGANIZATION_EVENT, handleOrganizationChanged);
    return () => window.removeEventListener(ORGANIZATION_EVENT, handleOrganizationChanged);
  }, [loadOrganizations, markDraftDirty, organizations]);

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
        const atts = Array.isArray(json.attributes)
          ? json.attributes.map((attr: ShipmentAttribute) => ({
              ...attr,
	              value: typeof attr.value === "string" ? formatVehicleAttributeInput(attr.name, attributeValueToString(attr.value)) : attr.value,
            }))
          : [];
        setAttributes(atts);
        setAttributesError(null);
        setAttributesLoading(false);
        const vinAttr = atts.find((a) => typeof a.name === "string" && /vin/i.test(a.name));
        setVin(formatVehicleAttributeInput(vinAttr?.name, attributeValueToString(vinAttr?.value)));
        setPositions(
          (json.positions ?? []).map((p) => {
            const priceRub = (Number(p.price) || 0) / 100;
            const discount = typeof p.discount === "number" ? p.discount : 0;
            const lineBase = (Number(p.quantity) || 0) * priceRub;
            const stockCostRub =
              typeof p.stock?.cost === "number" && Number.isFinite(p.stock.cost)
                ? p.stock.cost / 100
                : undefined;
            return {
              ...p,
              price: priceRub,
              stock: p.stock ? { ...p.stock, cost: stockCostRub } : p.stock,
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
            phone: rawAgent.phone,
            companyType: rawAgent.companyType,
            counterpartyTypeName: rawAgent.counterpartyTypeName,
            legalTitle: rawAgent.legalTitle,
            isSystem: rawAgent.isSystem,
            isAnonymousRetail: rawAgent.isAnonymousRetail,
            subtitle: rawAgent.subtitle,
          });
          setAgentSearch(rawAgent.name ?? json.header.agentName ?? "");
          setAgentOptions([]);
          setReplacingAgent(false);
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

  const positionAssortmentHrefs = useMemo(
    () => positions.filter((position) => !isNonstockProduct(position)).map((p) => p.assortmentMeta?.href).filter(Boolean).sort() as string[],
    [positions]
  );

  useEffect(() => {
    if (!selectedStore || positionAssortmentHrefs.length === 0) {
      setStockByAssortment({});
      return;
    }
    let cancelled = false;
    const storeId = selectedStore.id ? `&storeId=${encodeURIComponent(selectedStore.id)}` : "";
    fetch(
      `/api/stock?storeName=${encodeURIComponent(selectedStore.name)}&assortmentHrefs=${encodeURIComponent(positionAssortmentHrefs.join(","))}${storeId}`
    )
      .then((r) => safeJson<StockJson>(r, {}))
      .then((data) => {
        if (!cancelled && data.stockByAssortment) setStockByAssortment(data.stockByAssortment);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedStore, positionAssortmentHrefs]);

  useEffect(() => {
    if (!authChecked) return;
    if (positionAssortmentHrefs.length === 0) {
      setCellByAssortment({});
      return;
    }
    let cancelled = false;
    fetch(`/api/local-inventory/product-cells?hrefs=${encodeURIComponent(positionAssortmentHrefs.join(","))}`)
      .then((r) => safeJson<Record<string, number | string>>(r, {}))
      .then((data) => {
        if (!cancelled && typeof data === "object" && data !== null) setCellByAssortment(data as Record<string, number | string>);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authChecked, positionAssortmentHrefs]);

  useEffect(() => {
    if (!authChecked || !nonstockProductOpen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setNonstockProductOptionsLoading(true);
      const params = new URLSearchParams();
      if (nonstockProductDraft.brand.trim()) params.set("brand", nonstockProductDraft.brand.trim());
      if (nonstockProductDraft.article.trim()) params.set("article", nonstockProductDraft.article.trim());
      if (selectedStore?.id) params.set("storeId", selectedStore.id);
      try {
        const response = await fetch(`/api/demands/one-off-product?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await safeJson<NonstockProductOptions>(response, {
          groups: [...NONSTOCK_PRODUCT_GROUPS],
          uoms: [...NONSTOCK_PRODUCT_UOMS],
          brands: [],
          suppliers: [],
        });
        if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить справочники разового товара");
        setNonstockProductOptions(data);
        setNonstockProductError(null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setNonstockProductError(error instanceof Error ? error.message : "Не удалось загрузить справочники разового товара");
        }
      } finally {
        if (!controller.signal.aborted) setNonstockProductOptionsLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [authChecked, nonstockProductDraft.article, nonstockProductDraft.brand, nonstockProductOpen, selectedStore?.id]);

  useEffect(() => {
    if (!authChecked) return;
    if (demandId) return;
    void loadAttributeMetadata();
  }, [authChecked, demandId, loadAttributeMetadata]);

  useEffect(() => {
    const query = agentSearch.trim();
    if (!authChecked || (selectedAgent && !replacingAgent) || !query || !shouldSearchCounterparties(query)) {
      if (!query || !shouldSearchCounterparties(query)) {
        setAgentOptions([]);
        setAgentSearchError(null);
        setAgentLoading(false);
      }
      return;
    }
    let cancelled = false;
    setAgentLoading(true);
    setAgentSearchError(null);
    const t = setTimeout(() => {
      fetch(`/api/local-inventory/counterparty-options?search=${encodeURIComponent(query)}&limit=20`)
        .then(async (r) => {
          const data = await safeJson<CounterpartiesJson>(r, {});
          if (!r.ok) throw new Error(data.error ?? "Не удалось загрузить контрагентов");
          return data;
        })
        .then((data) => {
          if (cancelled) return;
          if (data.anonymousRetailCounterparty) setAnonymousRetailAgent(data.anonymousRetailCounterparty);
          setAgentOptions(data.counterparties ?? []);
          setHighlightedAgentIndex(0);
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
  }, [authChecked, selectedAgent, replacingAgent, agentSearch]);

  const loadInitialCounterparties = useCallback(() => {
    const query = agentSearch.trim();
    if (!authChecked || (selectedAgent && !replacingAgent) || !shouldSearchCounterparties(query)) return;
    setAgentLoading(true);
    setAgentSearchError(null);
    fetch(`/api/local-inventory/counterparty-options?search=${encodeURIComponent(query)}&limit=20`)
      .then(async (r) => {
        const data = await safeJson<CounterpartiesJson>(r, {});
        if (!r.ok) throw new Error(data.error ?? "Не удалось загрузить контрагентов");
        return data;
      })
      .then((data) => {
        if (data.anonymousRetailCounterparty) setAnonymousRetailAgent(data.anonymousRetailCounterparty);
        setAgentOptions(data.counterparties ?? []);
        setHighlightedAgentIndex(0);
      })
      .catch((error) => {
        setAgentOptions([]);
        setAgentSearchError(error instanceof Error ? error.message : "Не удалось загрузить контрагентов");
      })
      .finally(() => setAgentLoading(false));
  }, [authChecked, selectedAgent, replacingAgent, agentSearch]);

  useEffect(() => {
    if (!agentDropdownOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (agentSearchRef.current?.contains(target)) return;
      setAgentDropdownOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setAgentDropdownOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [agentDropdownOpen]);

  const selectAgentOption = (agent: Counterparty) => {
    setSelectedAgent(agent);
    setAgentSearch(counterpartyDisplayName(agent));
    setAgentOptions([]);
    setAgentDropdownOpen(false);
    setHighlightedAgentIndex(0);
    setReplacingAgent(false);
  };

  useEffect(() => {
    let cancelled = false;
    const counterpartyId = selectedAgent?.id?.trim();
    setVehicleProfile(null);
    setVehicleProfileError("");
    if (!counterpartyId || selectedAgent?.isAnonymousRetail) {
      setVehicleProfileLoading(false);
      return () => { cancelled = true; };
    }
    setVehicleProfileLoading(true);
    fetch(`/api/client-vehicles?counterpartyId=${encodeURIComponent(counterpartyId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await safeJson<ClientVehicleProfilesJson>(response, {});
        if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить паспорт автомобиля");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        const profile = data.profiles?.[0] ?? null;
        setVehicleProfile(profile);
        if (!profile) return;
        const vehicle = profileToVehicleIdentity(profile);
        setIdentifiedVehicle(vehicle);
        setAttributes((current) => mergeVehicleAttributes(current, vehicle));
        if (vehicle.vin) setVin((current) => current || vehicle.vin || "");
      })
      .catch((error) => {
        if (!cancelled) setVehicleProfileError(error instanceof Error ? error.message : "Не удалось загрузить паспорт автомобиля");
      })
      .finally(() => {
        if (!cancelled) setVehicleProfileLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedAgent?.id, selectedAgent?.isAnonymousRetail]);

  const handleAgentSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setAgentDropdownOpen(false);
      event.preventDefault();
      return;
    }
    if (!agentDropdownOpen || agentOptions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedAgentIndex((index) => Math.min(agentOptions.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedAgentIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const agent = agentOptions[highlightedAgentIndex] ?? agentOptions[0];
      if (agent) selectAgentOption(agent);
    }
  };

  useEffect(() => {
    const manualMannArticle = manualMannFilter ? productSearch.trim() || manualMannFilter.mannArticle : "";
    const hasQuery = manualMannFilter
      ? Boolean(manualMannArticle.trim())
      : productSearchMode === "service" || [productSearch.trim(), productOem.trim(), productParams.trim()].some(Boolean);
    if (!hasQuery) {
      setProductOptions([]);
      setProductSearchError(null);
      setProductSearchLoading(false);
      setProductResultsOpen(false);
      setHighlightedProductIndex(0);
      productResultsDismissedRef.current = false;
      return;
    }
    let cancelled = false;
    setProductSearchLoading(true);
    setProductSearchError(null);
    const t = setTimeout(() => {
      if (manualMannFilter) {
        fetch("/api/mann-catalog/match-local-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: selectedOrg?.id,
            warehouseId: selectedStore?.id,
            mannArticles: [{
              mannArticle: manualMannArticle,
              filterType: manualMannFilter.filterType,
              filterSubtype: manualMannFilter.filterSubtype,
            }],
          }),
        })
          .then(async (r) => {
            const data = await safeJson<MannMatchJson>(r, {});
            if (!r.ok) throw new Error(data.error ?? "Не удалось выполнить строгий поиск MANN");
            return data;
          })
          .then((data) => {
            if (cancelled) return;
            const match = data.matches?.[0] ?? null;
            const products = (match?.compatibleProducts ?? match?.localMatches ?? []).map((local): Product => {
              const reason = local.matchType === "EXACT_PRODUCT_BRAND_ARTICLE"
                ? "точный бренд + артикул товара"
                : local.matchType === "OEM_EXACT_BRAND_ARTICLE"
                  ? "точный бренд + артикул в OEM Parts"
                  : local.matchType === "OEM_EXACT_ARTICLE"
                    ? "точный артикул в OEM Parts"
                    : local.matchType === "OEM_SAFE_COMPACT"
                      ? "безопасный compact OEM без коллизий"
                      : "подтверждённая связь MANN";
              return {
                id: local.id,
                name: local.name,
                article: local.article ?? undefined,
                code: local.code ?? undefined,
                brand: local.brand ?? undefined,
                price: local.price,
                currency: local.currency,
                meta: local.meta ?? { href: `local://product/${local.id}`, type: "product", mediaType: "application/json" },
                cell: local.cell ?? undefined,
                slotName: local.cell ?? undefined,
                stockQuantity: local.stock,
                reserveQuantity: local.reserve ?? 0,
                availableQuantity: local.available,
                buyPriceCents: local.buyPriceCents ?? undefined,
                cost: local.cost,
                orderable: local.orderable,
                matchSummary: `Техническая связь: ${reason}`,
              };
            });
            setProductOptions(products);
            setHighlightedProductIndex(0);
            setProductResultsOpen(!productResultsDismissedRef.current);
          })
          .catch((error) => {
            if (cancelled) return;
            setProductOptions([]);
            setHighlightedProductIndex(0);
            setProductResultsOpen(!productResultsDismissedRef.current);
            setProductSearchError(error instanceof Error ? error.message : "Не удалось выполнить строгий поиск MANN");
          })
          .finally(() => {
            if (!cancelled) setProductSearchLoading(false);
          });
        return;
      }
      const params = new URLSearchParams();
      if (productSearch.trim()) params.set("q", productSearch.trim());
      if (productOem.trim()) params.set("oem", productOem.trim());
      if (productParams.trim()) params.set("params", productParams.trim());
      params.set("context", "shipment");
      if (productSearchMode !== "all") {
        params.set("type", productSearchMode);
      }
      if (selectedStore?.id) params.set("storeId", selectedStore.id);
      if (selectedStore?.name) params.set("storeName", selectedStore.name);
      params.set("limit", "50");
      fetch(`/api/catalog/search?${params.toString()}`)
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
          setProductOptions(data.products ?? data.items ?? []);
          setHighlightedProductIndex(0);
          setProductResultsOpen(!productResultsDismissedRef.current);
        })
        .catch((error) => {
          if (cancelled) return;
          setProductOptions([]);
          setHighlightedProductIndex(0);
          setProductResultsOpen(!productResultsDismissedRef.current);
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
  }, [manualMannFilter, productSearch, productOem, productParams, productSearchMode, productSearchRetrySeed, selectedOrg?.id, selectedStore?.id, selectedStore?.name]);

  useEffect(() => {
    if (!authChecked || positionAddMode !== "mann" || mannMakes.length > 0) return;
    let cancelled = false;
    setMannLoading("makes");
    setMannError(null);
    fetch("/api/mann-catalog/makes")
      .then((response) => safeJson<{ makes?: MannMake[]; error?: string }>(response, {}))
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setMannError(data.error);
          return;
        }
        setMannMakes(data.makes ?? []);
      })
      .catch((error) => {
        if (!cancelled) setMannError(error instanceof Error ? error.message : "Не удалось загрузить марки MANN");
      })
      .finally(() => {
        if (!cancelled) setMannLoading(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authChecked, mannMakes.length, positionAddMode]);

  useEffect(() => {
    if (!selectedMannMake) {
      mannModelsRequestIdRef.current += 1;
      mannVariantsRequestIdRef.current += 1;
      setMannModels([]);
      setSelectedMannModel("");
      setMannModelQuery("");
      setMannVariants([]);
      setSelectedMannVariantId("");
      setMannVariantQuery("");
      setMannFilters([]);
      setMannMatches({});
      return;
    }
    const autoSelection = mannAutoSelectionRef.current;
    const preserveAutoSelection = Boolean(autoSelection && autoSelection.make === selectedMannMake);
    const requestId = ++mannModelsRequestIdRef.current;
    const controller = new AbortController();
    setMannLoading("models");
    setMannError(null);
    setMannModels([]);
    setSelectedMannModel(preserveAutoSelection ? autoSelection!.model : "");
    if (!preserveAutoSelection) setMannModelQuery("");
    setMannVariants([]);
    setSelectedMannVariantId("");
    setMannVariantQuery("");
    setMannFilters([]);
    setMannMatches({});
    fetch(`/api/mann-catalog/models?make=${encodeURIComponent(selectedMannMake)}`, { signal: controller.signal })
      .then((response) => safeJson<{ models?: MannModel[]; error?: string }>(response, {}))
      .then((data) => {
        if (!shouldApplyMannRequest(requestId, mannModelsRequestIdRef.current)) return;
        if (data.error) {
          setMannError(data.error);
          return;
        }
        setMannModels(data.models ?? []);
      })
      .catch((error) => {
        if (!(error instanceof Error && error.name === "AbortError") && shouldApplyMannRequest(requestId, mannModelsRequestIdRef.current)) {
          setMannError(error instanceof Error ? error.message : "Не удалось загрузить модели MANN");
        }
      })
      .finally(() => {
        if (shouldApplyMannRequest(requestId, mannModelsRequestIdRef.current)) setMannLoading(null);
      });
    return () => {
      controller.abort();
    };
  }, [selectedMannMake]);

  useEffect(() => {
    if (positionAddMode !== "mann" || mannYear) return;
    const year = normalizeMannYearInput(getAttributeString(attributes, (name) => name === "год"));
    if (isValidMannYear(year)) setMannYear(year);
  }, [attributes, mannYear, positionAddMode]);

  useEffect(() => {
    if (!selectedMannMake || !selectedMannModel) {
      mannVariantsRequestIdRef.current += 1;
      setMannVariants([]);
      setSelectedMannVariantId("");
      setMannVariantQuery("");
      setMannFilters([]);
      setMannMatches({});
      return;
    }
    const requestId = ++mannVariantsRequestIdRef.current;
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      const params = new URLSearchParams({ make: selectedMannMake, model: selectedMannModel });
      if (isValidMannYear(mannYear)) params.set("year", mannYear);
      const autoSelection = mannAutoSelectionRef.current;
      if (autoSelection?.make === selectedMannMake && autoSelection.model === selectedMannModel) {
        params.set("includeVariantId", autoSelection.variantId);
      }
      setMannLoading("variants");
      setMannError(null);
      setMannVariants([]);
      setSelectedMannVariantId("");
      setMannVariantQuery("");
      setMannFilters([]);
      setMannMatches({});
      fetch(`/api/mann-catalog/variants?${params.toString()}`, { signal: controller.signal })
        .then((response) => safeJson<{ variants?: MannVariant[]; error?: string }>(response, {}))
        .then((data) => {
          if (!shouldApplyMannRequest(requestId, mannVariantsRequestIdRef.current)) return;
          if (data.error) {
            setMannError(data.error);
            return;
          }
          setMannVariants(data.variants ?? []);
        })
        .catch((error) => {
          if (!(error instanceof Error && error.name === "AbortError") && shouldApplyMannRequest(requestId, mannVariantsRequestIdRef.current)) {
            setMannError(error instanceof Error ? error.message : "Не удалось загрузить модификации MANN");
          }
        })
        .finally(() => {
          if (shouldApplyMannRequest(requestId, mannVariantsRequestIdRef.current)) setMannLoading(null);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [mannYear, selectedMannMake, selectedMannModel]);

  useEffect(() => {
    const autoSelection = mannAutoSelectionRef.current;
    if (!autoSelection || autoSelection.make !== selectedMannMake || autoSelection.model !== selectedMannModel) return;
    const variant = mannVariants.find((item) => item.variantId === autoSelection.variantId);
    if (!variant) return;
    mannAutoSelectionRef.current = null;
    setSelectedMannVariantId(autoSelection.variantId);
    setMannVariantQuery(describeMannVariant(variant));
  }, [mannVariants, selectedMannMake, selectedMannModel]);

  useEffect(() => {
    if (!selectedMannVariantId) {
      setMannFilters([]);
      setMannMatches({});
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ variantId: selectedMannVariantId });
    if (selectedMannMake) params.set("make", selectedMannMake);
    if (selectedMannModel) params.set("model", selectedMannModel);
    if (isValidMannYear(mannYear)) params.set("year", mannYear);
    setMannLoading("filters");
    setMannError(null);
    setMannFilters([]);
    setMannMatches({});
    fetch(`/api/mann-catalog/filters?${params.toString()}`)
      .then((response) => safeJson<{ filters?: MannFilter[]; error?: string }>(response, {}))
      .then(async (data) => {
        if (cancelled) return;
        if (data.error) {
          setMannError(data.error);
          return;
        }
        const filters = data.filters ?? [];
        setMannFilters(filters);
        if (filters.length === 0) return;
        setMannLoading("matches");
        const matchResponse = await fetch("/api/mann-catalog/match-local-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: selectedOrg?.id,
            warehouseId: selectedStore?.id,
            mannArticles: filters.map((filter) => ({
              mannArticle: filter.mannArticle,
              filterType: filter.filterType,
              filterSubtype: filter.filterSubtype,
            })),
          }),
        });
        const matchJson = await safeJson<MannMatchJson>(matchResponse, {});
        if (cancelled) return;
        if (!matchResponse.ok || matchJson.error) {
          setMannError(matchJson.error ?? "Не удалось сопоставить фильтры с локальным каталогом");
          return;
        }
        setMannMatches(Object.fromEntries((matchJson.matches ?? []).map((match) => [match.mannArticleNormalized, match])));
      })
      .catch((error) => {
        if (!cancelled) setMannError(error instanceof Error ? error.message : "Не удалось загрузить фильтры MANN");
      })
      .finally(() => {
      if (!cancelled) setMannLoading(null);
    });
    return () => {
      cancelled = true;
    };
  }, [mannYear, selectedMannMake, selectedMannModel, selectedMannVariantId, selectedOrg?.id, selectedStore?.id]);

  useEffect(() => {
    if (!productAddNotice) return;
    const timer = window.setTimeout(() => setProductAddNotice(""), 1800);
    return () => window.clearTimeout(timer);
  }, [productAddNotice]);

  useEffect(() => {
    if (recentlyAddedPositionIndex == null) return;
    const timer = window.setTimeout(() => setRecentlyAddedPositionIndex(null), 1800);
    return () => window.clearTimeout(timer);
  }, [recentlyAddedPositionIndex]);

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
      const res = await fetch("/api/local-inventory/counterparty-options", {
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
      setReplacingAgent(false);
    } catch (e) {
      setCreateAgentError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setCreateAgentLoading(false);
    }
  };

  const addPosition = (p: Product, requestedQuantity = 1) => {
    const quantityToAdd = Math.max(1, Number.isFinite(requestedQuantity) ? requestedQuantity : 1);
    const existingIndex = positions.findIndex((position) => position.assortmentMeta?.href === p.meta.href);
    if (existingIndex >= 0) {
      setPositions((prev) => prev.map((position, index) => index === existingIndex
        ? { ...position, quantity: (position.quantity || 0) + quantityToAdd }
        : position));
      setRecentlyAddedPositionIndex(existingIndex);
      setProductAddNotice("");
      markDraftDirty();
      focusProductSearch();
      return;
    }
    const nextIndex = positions.length;
    setPositions((prev) => [
      ...prev,
      {
        name: p.name,
        quantity: quantityToAdd,
        price: p.price,
        uomName: p.uomName || (isServiceMeta(p.meta) ? "усл." : "шт."),
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
    productResultsDismissedRef.current = false;
    setProductAddNotice("");
    setRecentlyAddedPositionIndex(nextIndex);
    markDraftDirty();
    focusProductSearch();
  };

  const changePositionQuantity = (index: number, delta: number) => {
    setPositions((prev) => prev.map((position, positionIndex) => positionIndex === index
      ? { ...position, quantity: Math.max(1, (position.quantity || 1) + delta) }
      : position));
    markDraftDirty();
  };

  const startMannManualSearch = (filter: MannFilter) => {
    setManualMannFilter(filter);
    setProductSearchMode("product");
    setProductOem("");
    setProductParams("");
    setProductSearch(filter.mannArticle);
    productResultsDismissedRef.current = false;
    setProductResultsOpen(true);
    setHighlightedProductIndex(0);
    window.requestAnimationFrame(() => document.getElementById("shipment-product-search")?.focus());
  };

  const addManualMannProductToPosition = (product: Product, requestedQuantity = 1) => {
    const filter = manualMannFilter;
    addPosition(product, requestedQuantity);
    if (!filter) return;
    const localMatch: MannLocalMatch = {
      id: product.id,
      name: product.name,
      meta: product.meta,
      article: product.article ?? null,
      code: product.code ?? null,
      brand: product.brand ?? null,
      price: product.price,
      currency: product.currency,
      stock: product.stockQuantity ?? 0,
      reserve: product.reserveQuantity ?? 0,
      available: product.availableQuantity ?? product.stockQuantity ?? 0,
      cell: product.cell ?? product.slotName ?? null,
      buyPriceCents: product.buyPriceCents ?? null,
      cost: product.cost,
      orderable: false,
      matchType: "PRODUCT_MANN_LINK",
      matchConfidence: 100,
      matchReason: "manual_link",
    };
    setMannMatches((prev) => ({
      ...prev,
      [filter.mannArticleNormalized]: {
        mannArticle: filter.mannArticle,
        mannArticleNormalized: filter.mannArticleNormalized,
        filterType: filter.filterType,
        filterSubtype: filter.filterSubtype,
        compatibleProducts: [localMatch],
        localMatches: [localMatch],
        bestMatch: localMatch,
        matchConfidence: 100,
        matchReason: "manual_link",
        stock: localMatch.stock,
        available: localMatch.available,
        price: localMatch.price,
        cell: localMatch.cell,
        status: "found",
        coverageStatus: "OEM_COVERED",
        diagnostics: {
          candidateCount: 1,
          compatibleCount: 1,
          canonicalArticle: filter.mannArticleNormalized,
          compactCandidate: filter.mannArticleNormalized.replace(/\//g, ""),
          compactCollisionBlocked: false,
          collisionCanonicalArticles: [],
          localProductScanMs: 0,
          parsingMs: 0,
          totalMs: 0,
        },
      },
    }));
    void fetch("/api/mann-catalog/product-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: selectedOrg?.id,
        productId: product.id,
        mannArticle: filter.mannArticle,
        linkType: "manual",
        confidence: 100,
      }),
    }).catch(() => undefined);
    setManualMannFilter(null);
    setProductAddNotice("Товар добавлен в отгрузку");
  };

  const focusProductSearch = () => {
    window.requestAnimationFrame(() => document.getElementById("shipment-product-search")?.focus());
  };

  const openServiceSearch = () => {
    setPositionAddMode("catalog");
    setProductSearchMode("all");
    setProductOem("");
    setProductParams("");
    setOneOffServiceOpen(true);
    setNonstockProductOpen(false);
    setOneOffServiceName((current) => current || productSearch.trim());
    productResultsDismissedRef.current = false;
    setProductResultsOpen(false);
    window.requestAnimationFrame(() => document.getElementById("shipment-one-off-service-name")?.focus());
  };

  const closeNonstockProductForm = () => {
    setNonstockProductOpen(false);
    setNonstockProductEditingIndex(null);
    setNonstockProductDraft(EMPTY_NONSTOCK_PRODUCT_DRAFT);
    setNonstockProductError(null);
  };

  const openNonstockProductForm = (positionIndex?: number) => {
    const position = positionIndex == null ? null : positions[positionIndex];
    const oneOff = position?.oneOffProduct;
    setPositionAddMode("catalog");
    setOneOffServiceOpen(false);
    setProductResultsOpen(false);
    setNonstockProductEditingIndex(positionIndex ?? null);
    setNonstockProductDraft(oneOff
      ? {
          groupCode: oneOff.groupCode,
          brand: oneOff.brandCanonical || oneOff.brand,
          article: oneOff.articleDisplay || oneOff.article,
          clarification: oneOff.clarification ?? "",
          quantity: position?.quantity || 1,
          uomCode: oneOff.uomCode || "PCS",
          purchasePrice: oneOff.purchasePrice == null ? "" : String(oneOff.purchasePrice).replace(".", ","),
          explicitZeroCost: oneOff.explicitZeroCost === true,
          salePrice: position ? String(position.price).replace(".", ",") : "",
          purchaseSourceId: oneOff.purchaseSourceId ?? "",
          purchaseSourceLabel: oneOff.purchaseSourceLabel ?? "",
          comment: position?.comment ?? "",
        }
      : {
          ...EMPTY_NONSTOCK_PRODUCT_DRAFT,
          article: productSearch.trim(),
        });
    setNonstockProductOpen(true);
    setNonstockProductError(null);
    window.requestAnimationFrame(() => document.getElementById("shipment-nonstock-product-type")?.focus());
  };

  const saveNonstockProductPosition = () => {
    const group = nonstockProductOptions.groups.find((item) =>
      item.code === nonstockProductDraft.groupCode
      || item.label.toLocaleLowerCase("ru-RU") === nonstockProductDraft.groupCode.trim().toLocaleLowerCase("ru-RU")
    );
    const purchasePrice = nonstockProductDraft.explicitZeroCost
      ? 0
      : nonstockProductDraft.purchasePrice.trim()
        ? parseDecimalInput(nonstockProductDraft.purchasePrice)
        : null;
    const salePrice = nonstockProductDraft.salePrice.trim()
      ? parseDecimalInput(nonstockProductDraft.salePrice)
      : Number.NaN;
    if (!Number.isFinite(nonstockProductDraft.quantity) || nonstockProductDraft.quantity <= 0) {
      setNonstockProductError("Количество разового товара должно быть больше нуля");
      return;
    }
    if (!Number.isFinite(salePrice) || salePrice < 0) {
      setNonstockProductError("Укажите цену для клиента");
      return;
    }
    try {
      const input: NonstockProductInput = {
        groupCode: group?.code ?? nonstockProductDraft.groupCode,
        brand: nonstockProductDraft.brand,
        article: nonstockProductDraft.article,
        uomCode: nonstockProductDraft.uomCode,
        purchasePrice,
        explicitZeroCost: nonstockProductDraft.explicitZeroCost,
        purchaseSourceId: nonstockProductDraft.purchaseSourceId || null,
        purchaseSourceLabel: nonstockProductDraft.purchaseSourceLabel || null,
        clarification: nonstockProductDraft.clarification || null,
      };
      const normalized = normalizeNonstockProductInput(input);
      const duplicateIndex = positions.findIndex((position, index) => {
        if (index === nonstockProductEditingIndex || !position.oneOffProduct) return false;
        try {
          const current = normalizeNonstockProductInput(position.oneOffProduct);
          return current.analyticsKey === normalized.analyticsKey
            && current.uomCode === normalized.uomCode
            && current.purchasePriceCents === normalized.purchasePriceCents
            && Math.abs((position.price || 0) - salePrice) < 0.005;
        } catch {
          return false;
        }
      });
      if (duplicateIndex >= 0) {
        const increase = window.confirm(
          "Такая разовая позиция с теми же закупочной ценой и ценой продажи уже есть. Увеличить её количество?\n\nНажмите «Отмена», чтобы сохранить отдельной строкой."
        );
        if (increase) {
          setPositions((current) => current.map((position, index) => index === duplicateIndex
            ? { ...position, quantity: (position.quantity || 0) + nonstockProductDraft.quantity }
            : position));
          setRecentlyAddedPositionIndex(duplicateIndex);
          setProductAddNotice("Количество разового товара увеличено");
          markDraftDirty();
          closeNonstockProductForm();
          return;
        }
      }

      const existing = nonstockProductEditingIndex == null ? null : positions[nonstockProductEditingIndex];
      const nextPosition: Position = {
        ...existing,
        id: existing?.id,
        name: normalized.name,
        quantity: nonstockProductDraft.quantity,
        price: salePrice,
        discount: existing?.discount ?? 0,
        discountMode: existing?.discountMode ?? "percent",
        discountAmount: existing?.discountAmount ?? 0,
        comment: nonstockProductDraft.comment.trim() || undefined,
        lineKind: "nonstock_product",
        oneOffProduct: input,
        assortmentMeta: {
          href: existing?.assortmentMeta?.href ?? `local://one-off-product/${crypto.randomUUID()}`,
          type: NONSTOCK_PRODUCT_ASSORTMENT_TYPE,
          mediaType: "application/json",
        },
        cell: undefined,
        slotName: undefined,
        stock: { cost: normalized.purchasePriceCents == null ? undefined : normalized.purchasePriceCents / 100 },
      };
      if (nonstockProductEditingIndex == null) {
        const nextIndex = positions.length;
        setPositions((current) => [...current, nextPosition]);
        setRecentlyAddedPositionIndex(nextIndex);
        setProductAddNotice("Разовый товар добавлен в отгрузку");
      } else {
        setPositions((current) => current.map((position, index) => index === nonstockProductEditingIndex ? nextPosition : position));
        setRecentlyAddedPositionIndex(nonstockProductEditingIndex);
        setProductAddNotice("Разовый товар обновлён");
      }
      markDraftDirty();
      closeNonstockProductForm();
    } catch (error) {
      setNonstockProductError(error instanceof Error ? error.message : "Проверьте данные разового товара");
    }
  };

  const useExactCatalogProduct = () => {
    const product = nonstockProductOptions.exactMatch;
    if (!product) return;
    if (nonstockProductEditingIndex == null) {
      addPosition(product);
    } else {
      const index = nonstockProductEditingIndex;
      const current = positions[index];
      setPositions((items) => items.map((position, positionIndex) => positionIndex === index
        ? {
            name: product.name,
            quantity: current?.quantity || 1,
            price: product.price,
            discount: current?.discount ?? 0,
            discountMode: current?.discountMode ?? "percent",
            discountAmount: current?.discountAmount ?? 0,
            assortmentMeta: product.meta,
            cell: product.cell,
            slotName: product.slotName ?? product.cell,
            stock: {
              cost: product.cost,
              quantity: product.stockQuantity,
              reserve: product.reserveQuantity,
              available: product.availableQuantity,
            },
          }
        : position));
      setRecentlyAddedPositionIndex(index);
      markDraftDirty();
    }
    setProductAddNotice("Товар из каталога добавлен в отгрузку");
    closeNonstockProductForm();
  };

  const addOneOffServicePosition = () => {
    const name = oneOffServiceName.trim();
    if (!name) {
      setProductAddNotice("Укажите название разовой услуги");
      window.requestAnimationFrame(() => document.getElementById("shipment-one-off-service-name")?.focus());
      return;
    }
    let oneOffService: ReturnType<typeof normalizeOneOffServiceInput>;
    try {
      oneOffService = normalizeOneOffServiceInput({
        analyticsMetricCode: oneOffServiceMetricCode,
        aggregateType: oneOffServiceMetricCode === "TRANSMISSION_FLUID_SERVICE" ? oneOffServiceAggregateType : null,
        procedure: oneOffServiceMetricCode === "TRANSMISSION_FLUID_SERVICE" ? oneOffServiceProcedure : null,
        configuration: oneOffServiceMetricCode === "TRANSMISSION_FLUID_SERVICE" ? oneOffServiceConfiguration : null,
      });
    } catch (error) {
      setProductAddNotice(error instanceof Error ? error.message : "Проверьте категорию разовой услуги");
      return;
    }
    const price = parseDecimalInput(oneOffServicePrice);
    const nextIndex = positions.length;
    setPositions((prev) => [
      ...prev,
      {
        name,
        quantity: 1,
        price,
        discount: 0,
        discountMode: "percent",
        discountAmount: 0,
        comment: oneOffServiceComment.trim() || undefined,
        lineKind: "one_off_service",
        oneOffService,
        assortmentMeta: {
          href: `local://manual-service/${crypto.randomUUID()}`,
          type: "service",
          mediaType: "application/json",
        },
      },
    ]);
    setOneOffServiceOpen(false);
    setOneOffServiceName("");
    setOneOffServicePrice("");
    setOneOffServiceComment("");
    setOneOffServiceMetricCode("");
    setOneOffServiceAggregateType("UNKNOWN");
    setOneOffServiceProcedure("UNKNOWN");
    setOneOffServiceConfiguration("UNKNOWN");
    setProductSearch("");
    setProductOptions([]);
    setProductResultsOpen(false);
    setProductAddNotice("Разовая услуга добавлена в отгрузку");
    setRecentlyAddedPositionIndex(nextIndex);
    markDraftDirty();
    focusProductSearch();
  };

  const openAdvancedProductSearch = () => {
    setPositionAddMode("catalog");
    productResultsDismissedRef.current = false;
    window.requestAnimationFrame(() => {
      const advancedSearch = document.querySelector<HTMLDetailsElement>(".eco-shipment-advanced-search");
      if (advancedSearch) advancedSearch.open = true;
      focusProductSearch();
    });
  };

  const handleProductSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const hasQuery =
      productSearchMode === "service" ||
      [productSearch.trim(), productOem.trim(), productParams.trim()].some(Boolean);

    if (event.key === "Escape") {
      if (productResultsOpen) {
        event.preventDefault();
        productResultsDismissedRef.current = true;
        setProductResultsOpen(false);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      productResultsDismissedRef.current = false;
      if (hasQuery) setProductResultsOpen(true);
      setHighlightedProductIndex((index) => Math.min(Math.max(visibleProductOptions.length - 1, 0), index + 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedProductIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (event.key === "Enter") {
      const product = visibleProductOptions[highlightedProductIndex] ?? visibleProductOptions[0];
      if (product && !productSearchLoading) {
        event.preventDefault();
        const requestedQuantity = productAddQuantities[product.id] ?? 1;
        if (manualMannFilter) addManualMannProductToPosition(product, requestedQuantity);
        else addPosition(product, requestedQuantity);
      } else if (hasQuery) {
        productResultsDismissedRef.current = false;
        setProductResultsOpen(true);
      }
    }
  };

  const runVinLookup = useCallback(async (vehicleOverrides?: { displacementL?: string; enginePowerPS?: string }) => {
    const vinClean = vin.replace(/\s/g, "").toUpperCase();
    if (vinClean.length < 8) return;
    const hasOverrides = Boolean(vehicleOverrides?.displacementL?.trim() || vehicleOverrides?.enginePowerPS?.trim());
    setVinLookupLoading(true);
    setVinLookupResult(null);
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
        legacyItems: [],
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
              return { ...a, value: val ? formatVehicleAttributeInput(a.name, val) : null };
            }
            if (name === "год") {
              const val = (decoded.modelYear ?? "").trim();
              return { ...a, value: val || null };
            }
            if (name === "объем") {
              const val = (data as VinLookupResult).oilInfo?.fillVolumeLiters?.trim();
              if (val && !attributeValueToString(a.value).trim()) return { ...a, value: val };
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
        legacyItems: [],
        decodeError: "Ошибка запроса",
      });
    } finally {
      setVinLookupLoading(false);
    }
  }, [markDraftDirty, vin]);

  const persistVehicleProfile = useCallback(async (payload: {
    mode: "auto" | "confirmed";
    vehicle?: NormalizedVehicleIdentity;
    values?: ClientVehiclePassportValues;
    mannVariantIds?: string[];
  }) => {
    const counterpartyId = selectedAgent?.id?.trim();
    if (!counterpartyId || selectedAgent?.isAnonymousRetail) return null;
    setVehicleProfileLoading(true);
    setVehicleProfileError("");
    try {
      const response = await fetch("/api/client-vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterpartyId,
          vehicleId: vehicleProfile?.id,
          mode: payload.mode,
          vehicle: payload.vehicle,
          values: payload.values,
          mannVariantIds: payload.mannVariantIds,
        }),
      });
      const data = await safeJson<ClientVehicleSaveJson>(response, {});
      if (!response.ok || !data.profile) throw new Error(data.error ?? "Не удалось сохранить паспорт автомобиля");
      setVehicleProfile(data.profile);
      setSelectedAgent((current) => current && current.id === counterpartyId ? {
        ...current,
        vehicleModel: [profileText(data.profile?.make), profileText(data.profile?.model)].filter(Boolean).join(" "),
        vehicleYear: data.profile?.year == null ? current.vehicleYear : String(data.profile.year),
        vehiclePlate: profileText(data.profile?.plate) ?? current.vehiclePlate,
        vehicleVin: profileText(data.profile?.vin) ?? current.vehicleVin,
        vehicleLabel: [
          [profileText(data.profile?.make), profileText(data.profile?.model), profileText(data.profile?.generation)].filter(Boolean).join(" "),
          data.profile?.year,
          profileText(data.profile?.plate),
        ].filter(Boolean).join(" · "),
      } : current);
      return data.profile;
    } catch (error) {
      setVehicleProfileError(error instanceof Error ? error.message : "Не удалось сохранить паспорт автомобиля");
      return null;
    } finally {
      setVehicleProfileLoading(false);
    }
  }, [selectedAgent?.id, selectedAgent?.isAnonymousRetail, vehicleProfile?.id]);

  const applyIdentifiedVehicle = useCallback((vehicle: NormalizedVehicleIdentity, resolution: MannVehicleResolution | null) => {
    const fields = vehicleFieldValues(vehicle);
    const fieldEntries: Array<[string, { value: string; source: string }]> = [];
    for (const [attributeName, field] of Object.entries(fields)) {
      if (field?.value) fieldEntries.push([attributeName, field]);
    }
    setAttributes((prev) => {
      const next = [...prev];
      for (const [attributeName, field] of fieldEntries) {
        const normalizedTarget = normalizeAttrName(attributeName);
        const index = next.findIndex((attribute) => normalizeAttrName(attribute.name) === normalizedTarget);
        if (index >= 0) {
          const current = next[index];
          if (attributeValueToString(current?.value).trim()) continue;
          if (current) next[index] = { ...current, value: field.value, source: field.source };
          continue;
        }
        next.push({
          id: `vehicle-tronk-${normalizedTarget.replace(/\s+/g, "-")}`,
          name: attributeName,
          type: "string",
          meta: { href: `local://demand-attribute/${encodeURIComponent(attributeName)}`, type: "demandattribute", mediaType: "application/json" },
          value: field.value,
          source: field.source,
        });
      }
      return next;
    });
    if (vehicle.vin && !vin.trim()) setVin(formatVehicleAttributeInput("vin номер", vehicle.vin));
    const prefill = resolution?.safePrefill;
    const selected = resolution?.status === "resolved" ? resolution.selectedApplication : null;
    mannAutoSelectionRef.current = selected ? { make: selected.make, model: selected.model, variantId: selected.variantId } : null;
    setSelectedMannMake(prefill?.makeId ?? "");
    setMannMakeQuery(prefill?.makeLabel ?? "");
    setSelectedMannModel(selected?.model ?? "");
    setMannModelQuery(prefill?.modelQuery ?? "");
    setSelectedMannVariantId("");
    setMannVariantQuery(prefill?.modificationQuery ?? "");
    const prefilledYear = prefill?.year != null ? String(prefill.year) : vehicle.year != null ? String(vehicle.year) : "";
    setMannYear(isValidMannYear(prefilledYear) ? prefilledYear : "");
    setMannPickerExpanded(false);
    setMannManualCue("idle");
    setPositionAddMode("mann");
    setProductAddNotice(
      resolution?.status === "resolved"
        ? "Автомобиль заполнен, фильтры MANN подобраны"
        : "Автомобиль заполнен. Выберите MANN-модификацию перед подбором фильтров"
    );
    setIdentifiedVehicle(vehicle);
    void persistVehicleProfile({
      mode: "auto",
      vehicle,
      mannVariantIds: resolution?.selectedApplication?.variantIds,
    });
    markDraftDirty();
  }, [markDraftDirty, persistVehicleProfile, vin]);

  const confirmMannCandidate = useCallback((vehicle: NormalizedVehicleIdentity, candidate: MannVehicleCandidate) => {
    mannAutoSelectionRef.current = { make: candidate.make, model: candidate.model, variantId: candidate.variantId };
    setSelectedMannMake(candidate.make);
    setMannMakeQuery(candidate.make);
    setSelectedMannModel(candidate.model);
    setMannModelQuery(candidate.model);
    setSelectedMannVariantId("");
    setMannVariantQuery(candidate.effectiveVehicleText ?? candidate.vehicleText ?? "");
    const year = vehicle.year != null ? String(vehicle.year) : "";
    if (isValidMannYear(year)) setMannYear(year);
    setPositionAddMode("mann");
    setMannPickerExpanded(false);
    setMannManualCue("idle");
    setProductAddNotice("MANN-модификация подтверждена, подбираем фильтры");
    void fetch("/api/mann-catalog/save-vehicle-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: selectedOrg?.id,
        make: candidate.make,
        model: candidate.model,
        sourceModel: vehicle.modelRaw ?? vehicle.modelCanonical ?? candidate.model,
        generation: vehicle.generationCanonical ?? vehicle.generationRaw,
        bodyCodes: [vehicle.bodyCode].filter((value): value is string => Boolean(value)),
        variantId: candidate.variantId,
        yearFrom: vehicle.year,
        yearTo: vehicle.modelYearTo,
        engineCode: vehicle.engineCode ?? vehicle.engineSeries,
        engineVolumeCc: vehicle.engineVolumeCc,
        powerKw: vehicle.powerKw ? Math.round(vehicle.powerKw) : undefined,
        powerHp: vehicle.powerHp ? Math.round(vehicle.powerHp) : undefined,
        fuelType: vehicle.fuelType,
        driveType: vehicle.driveType,
        transmissionType: vehicle.transmissionType ?? vehicle.transmissionName,
      }),
    }).catch(() => undefined);
    setIdentifiedVehicle(vehicle);
    void persistVehicleProfile({ mode: "auto", vehicle, mannVariantIds: candidate.variantIds });
    markDraftDirty();
  }, [markDraftDirty, persistVehicleProfile, selectedOrg?.id]);

  const confirmVehicleTransmission = useCallback((vehicle: NormalizedVehicleIdentity, transmissionType: MannTransmissionType, variantIds: string[]) => {
    const labels: Record<MannTransmissionType, string> = {
      automatic: "АКПП",
      manual: "МКПП",
      cvt: "Вариатор",
      robot: "Робот",
    };
    const nextVehicle = { ...vehicle, transmissionType };
    setIdentifiedVehicle(nextVehicle);
    setAttributes((current) => {
      const next = [...current];
      const index = next.findIndex((attribute) => normalizeAttrName(attribute.name) === "коробка");
      if (index >= 0 && next[index]) next[index] = { ...next[index], value: labels[transmissionType], source: "manual" };
      else next.push({
        id: "vehicle-transmission",
        name: "коробка",
        type: "string",
        meta: { href: "local://demand-attribute/transmission", type: "demandattribute", mediaType: "application/json" },
        value: labels[transmissionType],
        source: "manual",
      });
      return next;
    });
    void persistVehicleProfile({
      mode: "confirmed",
      values: {
        make: vehicle.makeRaw ?? vehicle.makeCanonical ?? null,
        model: vehicle.modelRaw ?? vehicle.modelCanonical ?? null,
        transmissionType,
      },
      mannVariantIds: variantIds,
    });
    markDraftDirty();
  }, [markDraftDirty, persistVehicleProfile]);

  const resetMannVehicleSelection = useCallback(() => {
    mannAutoSelectionRef.current = null;
    mannModelsRequestIdRef.current += 1;
    mannVariantsRequestIdRef.current += 1;
    setSelectedMannMake("");
    setSelectedMannModel("");
    setSelectedMannVariantId("");
    setMannMakeQuery("");
    setMannModelQuery("");
    setMannVariantQuery("");
    setMannYear("");
    setMannModels([]);
    setMannVariants([]);
    setMannFilters([]);
    setMannMatches({});
    setMannPickerExpanded(false);
    setMannManualCue("idle");
  }, []);

  const openMannManualPicker = useCallback((context?: { reason?: MannManualCue; vehicle?: NormalizedVehicleIdentity | null }) => {
    const reason = context?.reason && context.reason !== "idle" ? context.reason : "manual";
    const shouldFocusVariant = reason === "partial" && Boolean(context?.vehicle?.modelRaw ?? context?.vehicle?.modelCanonical);
    setPositionAddMode("mann");
    setMannPickerExpanded(true);
    setMannManualCue(reason);
    window.setTimeout(() => {
      document.getElementById("shipment-mann-manual")?.scrollIntoView({ behavior: "smooth", block: "center" });
      const targetId = shouldFocusVariant ? "shipment-mann-variant-combobox" : "shipment-mann-make-combobox";
      const input = document.getElementById(targetId) as HTMLInputElement | null;
      input?.focus();
    }, 80);
  }, []);

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
          slotName: it.cell ?? undefined,
          stock: {
            quantity: it.quantity,
            available: it.quantity,
          },
        });
        indexByHref.set(meta.href, next.length - 1);
      }
      return next;
    });
    markDraftDirty();
  }, [markDraftDirty]);

  const addMannMatchesToPositions = useCallback((items: Array<{ filter: MannFilter; match: MannLocalMatch; quantity?: number }>) => {
    if (items.length === 0) {
      setProductAddNotice("Нет найденных локальных товаров для добавления");
      return;
    }
    const projectedIndexes = new Map(
      positions.map((position, index) => [position.assortmentMeta?.href, index] as const)
    );
    let projectedLength = positions.length;
    let highlightedIndex: number | null = null;
    for (const item of items) {
      const href = `local://product/${item.match.id}`;
      const existingIndex = projectedIndexes.get(href);
      if (existingIndex != null) {
        highlightedIndex = existingIndex;
      } else {
        highlightedIndex = projectedLength;
        projectedIndexes.set(href, projectedLength);
        projectedLength += 1;
      }
    }
    setPositions((prev) => {
      const next = [...prev];
      const indexByHref = new Map(next.map((position, index) => [position.assortmentMeta?.href, index] as const));
      for (const item of items) {
        const quantityToAdd = Math.max(1, Number.isFinite(item.quantity) ? item.quantity ?? 1 : 1);
        const meta: Meta = {
          href: `local://product/${item.match.id}`,
          type: "product",
          mediaType: "application/json",
        };
        const existingIndex = indexByHref.get(meta.href);
        if (existingIndex != null) {
          const existing = next[existingIndex];
          next[existingIndex] = { ...existing, quantity: (existing.quantity || 0) + quantityToAdd };
          continue;
        }
        next.push({
          name: item.match.name,
          quantity: quantityToAdd,
          price: item.match.price,
          uomName: "шт.",
          discount: 0,
          discountMode: "percent",
          discountAmount: 0,
          assortmentMeta: meta,
          cell: item.match.cell ?? undefined,
          slotName: item.match.cell ?? undefined,
          stock: {
            quantity: item.match.stock,
            available: item.match.available,
          },
        });
        indexByHref.set(meta.href, next.length - 1);
      }
      return next;
    });
    setRecentlyAddedPositionIndex(highlightedIndex);
    void Promise.all(items.map((item) =>
      fetch("/api/mann-catalog/product-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: selectedOrg?.id,
          productId: item.match.id,
          mannArticle: item.filter.mannArticle,
          linkType: "manual",
          confidence: item.match.matchConfidence,
        }),
      }).catch(() => undefined)
    ));
    setProductAddNotice(items.length === 1 ? "Фильтр добавлен в отгрузку" : "Комплект фильтров добавлен в отгрузку");
    markDraftDirty();
  }, [markDraftDirty, positions, selectedOrg?.id]);

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
            ? positions.map((position) => demandPositionPayload(position, { priceIsCents: false }))
            : undefined,
      };
      const res = await fetch("/api/demands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeJson<DemandCreateJson>(res, {});
      if (!res.ok) {
        setSubmitError(demandSaveErrorMessage(res, data, "Ошибка создания отгрузки"));
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
      const plateStr = getAttributeString(attributes, (name) => /^гос\.?\s*номер$|^госномер$|license\s*plate|plate/i.test(name));
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
            ? positions.map((position) => demandPositionPayload(position, {
                priceIsCents: isExistingDraft,
                includeId: isExistingDraft,
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
        setSubmitError(demandSaveErrorMessage(res, data, isExistingDraft ? "Ошибка сохранения отгрузки" : "Ошибка создания отгрузки"));
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
      if (crmDealId) {
        await fetch(`/api/crm/deals/${encodeURIComponent(crmDealId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipmentId: nextId,
            nextAction: applicable ? "Закрыть вопрос после визита" : "Подготовить документ к визиту",
          }),
        }).catch(() => undefined);
      }
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
          positions: positions.map((position) => demandPositionPayload(position, { priceIsCents: true, includeId: true })),
        }),
      });
      const data = await safeJson<DemandCreateJson>(res, {});
      if (!res.ok) {
        setSubmitError(demandSaveErrorMessage(res, data, `Не удалось сохранить черновик перед ${actionLabel}`));
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

  const getPositionStock = useCallback(
    (position: Position) => {
      if (isServiceMeta(position.assortmentMeta)) return position.stock ?? { cost: 0 };
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
  const collapsedPositionLimit = 4;
  const latestIndexedPositions = indexedPositions.slice(-collapsedPositionLimit);
  const recentlyAddedIndexedPosition = recentlyAddedPositionIndex == null
    ? null
    : indexedPositions[recentlyAddedPositionIndex] ?? null;
  const collapsedIndexedPositions = recentlyAddedIndexedPosition
    && !latestIndexedPositions.some(({ index }) => index === recentlyAddedIndexedPosition.index)
      ? [recentlyAddedIndexedPosition, ...latestIndexedPositions.slice(-(collapsedPositionLimit - 1))]
      : latestIndexedPositions;
  const visibleIndexedPositions = positionsExpanded ? indexedPositions : collapsedIndexedPositions;
  const hiddenPositionsCount = Math.max(0, indexedPositions.length - visibleIndexedPositions.length);
  const positionGroups = [
    {
      key: "services",
      title: "Услуги",
      items: visibleIndexedPositions.filter(({ position }) => isServiceMeta(position.assortmentMeta)),
    },
    {
      key: "products",
      title: "Товары",
      items: visibleIndexedPositions.filter(({ position }) => !isServiceMeta(position.assortmentMeta)),
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
  const nonstockDraftGroup = nonstockProductOptions.groups.find((item) =>
    item.code === nonstockProductDraft.groupCode
    || item.label.toLocaleLowerCase("ru-RU") === nonstockProductDraft.groupCode.trim().toLocaleLowerCase("ru-RU")
  );
  const nonstockDraftUomLabel = nonstockProductOptions.uoms.find((uom) => uom.code === nonstockProductDraft.uomCode)?.label ?? "ед.";
  const nonstockDraftBrand = normalizeNonstockProductBrand(nonstockProductDraft.brand).display;
  const nonstockDraftArticle = normalizeNonstockProductArticle(nonstockProductDraft.article).display;
  const nonstockDraftPreview = [
    nonstockDraftGroup?.label,
    nonstockProductDraft.clarification.trim(),
    nonstockDraftBrand,
    nonstockDraftArticle,
  ].filter(Boolean).join(" ");
  const nonstockDraftSalePrice = nonstockProductDraft.salePrice.trim() ? parseDecimalInput(nonstockProductDraft.salePrice) : 0;
  const nonstockDraftPurchasePrice = nonstockProductDraft.explicitZeroCost
    ? 0
    : nonstockProductDraft.purchasePrice.trim()
      ? parseDecimalInput(nonstockProductDraft.purchasePrice)
      : null;
  const nonstockDraftRevenue = nonstockProductDraft.quantity * nonstockDraftSalePrice;
  const nonstockDraftCost = nonstockDraftPurchasePrice == null ? null : nonstockProductDraft.quantity * nonstockDraftPurchasePrice;
  const nonstockDraftProfit = nonstockDraftCost == null ? null : nonstockDraftRevenue - nonstockDraftCost;
  const nonstockDraftMargin = nonstockDraftProfit == null || nonstockDraftRevenue <= 0
    ? null
    : (nonstockDraftProfit / nonstockDraftRevenue) * 100;
  const overAvailablePositionsCount = positions.filter((position) => {
    if (isServiceMeta(position.assortmentMeta) || isNonstockProduct(position)) return false;
    const available = getPositionStock(position)?.available;
    return typeof available === "number" && (position.quantity || 0) > available;
  }).length;
  const copiedPositionsWithMeta = positions.filter((position) => position.copyMeta?.status);
  const copiedPriceUpdates = copiedPositionsWithMeta.filter((position) => position.copyMeta?.priceUpdated);
  const copiedPositionIssues = copiedPositionsWithMeta.filter((position) =>
    ["unlinked", "ambiguous", "archived", "one_off_price_check"].includes(String(position.copyMeta?.status ?? ""))
  );
  const missingNonstockCostCount = positions.filter((position) =>
    isNonstockProduct(position)
    && position.oneOffProduct?.purchasePrice == null
    && position.oneOffProduct?.explicitZeroCost !== true
  ).length;
  const decodedVehicle = vinLookupResult?.decoded;
  const attrLegacyModel = getAttributeString(attributes, (name) => name === "модель авто");
  const legacyModelParts = splitVehicleMakeModel(attrLegacyModel);
  const attrMake = getAttributeString(attributes, (name) => name === "марка") || legacyModelParts.make;
  const attrModel = getAttributeString(attributes, (name) => name === "модель") || legacyModelParts.model;
  const attrGeneration = getAttributeString(attributes, (name) => name === "поколение");
  const attrBody = getAttributeString(attributes, (name) => name === "кузов");
  const attrBodyCode = getAttributeString(attributes, (name) => name === "код кузова");
  const attrBodyType = getAttributeString(attributes, (name) => name === "тип кузова");
  const attrFrameNumber = getAttributeString(attributes, (name) => name === "номер кузова");
  const attrYear = getAttributeString(attributes, (name) => name === "год");
  const attrPlate = getAttributeString(attributes, (name) => /^гос\.?\s*номер$|^госномер$|license\s*plate|plate/i.test(name));
  const attrMileage = getAttributeString(attributes, (name) => /пробег/i.test(name));
  const attrEngine = getAttributeString(attributes, (name) => name === "двигатель");
  const attrEngineCode = getAttributeString(attributes, (name) => name === "код двигателя");
  const attrEngineSeries = getAttributeString(attributes, (name) => name === "серия двигателя");
  const attrEngineVolume = getAttributeString(attributes, (name) => name === "объем двигателя");
  const attrOil = getAttributeString(attributes, (name) => name === "моторное масло");
  const attrPower = getAttributeString(attributes, (name) => name === "мощность");
  const attrPowerKw = getAttributeString(attributes, (name) => name === "мощность квт");
  const attrFuel = getAttributeString(attributes, (name) => name === "топливо");
  const attrTransmission = getAttributeString(attributes, (name) => name === "коробка");
  const attrTransmissionName = getAttributeString(attributes, (name) => name === "модель коробки");
  const attrDrive = getAttributeString(attributes, (name) => name === "привод");
  const attrSteering = getAttributeString(attributes, (name) => name === "руль");
  const attrMarket = getAttributeString(attributes, (name) => name === "рынок");
  const attrCountry = getAttributeString(attributes, (name) => name === "страна сборки");
  const attrOwners = getAttributeString(attributes, (name) => name === "владельцев");
  const attrModelYearFrom = getAttributeString(attributes, (name) => name === "модельный год с");
  const attrModelYearTo = getAttributeString(attributes, (name) => name === "модельный год по");
  const documentVin = vin || getAttributeString(attributes, (name) => /vin/i.test(name));
  const vehicleManualReady = Boolean(
    attrMake && attrModel && (documentVin || attrPlate || attrMileage || attrYear)
  );
  const vehicleHasAnyManualData = Boolean(attrMake || attrModel || attrLegacyModel || attrPlate || documentVin || attrMileage || attrYear);
  const vehicleTitle =
    identifiedVehicle
      ? [identifiedVehicle.makeRaw ?? identifiedVehicle.makeCanonical, identifiedVehicle.modelRaw ?? identifiedVehicle.modelCanonical, identifiedVehicle.generationRaw].filter(Boolean).join(" ")
      : decodedVehicle
      ? [
          decodedVehicle.make,
          decodedVehicle.model,
          decodedVehicle.modification,
          decodedVehicle.modelYear,
        ]
          .filter(Boolean)
          .join(" · ")
      : [attrMake, attrModel, attrGeneration].filter(Boolean).join(" ") || attrLegacyModel;
  const vehicleReady = Boolean(documentVin || decodedVehicle || vehicleManualReady);
  const engineVolumeLiters = parseVehicleNumber(attrEngineVolume);
  const passportValuesForCompleteness: ClientVehiclePassportValues = {
    make: attrMake || null,
    model: attrModel || null,
    year: parseVehicleNumber(attrYear),
    vin: documentVin || null,
    engineVolumeCc: engineVolumeLiters == null ? null : Math.round(engineVolumeLiters * 1000),
    powerHp: parseVehicleNumber(attrPower),
    fuelType: attrFuel || null,
    transmissionType: attrTransmission || null,
    driveType: attrDrive || null,
    mileage: parseVehicleNumber(attrMileage),
  };
  const vehicleCompleteness = clientVehicleCompleteness(passportValuesForCompleteness);
  const vehicleStatusText = vehicleEditorOpen
    ? "Редактирование"
    : vehicleProfile?.verificationStatus === "CONFIRMED"
      ? `Подтверждено · ${vehicleCompleteness.completed}/${vehicleCompleteness.total}`
      : vehicleReady
        ? `Паспорт · ${vehicleCompleteness.completed}/${vehicleCompleteness.total}`
      : vehicleHasAnyManualData
        ? "Частично заполнен"
        : "Не указан";
  const vehicleStatusTone: EcoBadgeTone = vehicleEditorOpen
    ? "info"
    : vehicleReady
      ? "success"
      : vehicleHasAnyManualData
        ? "warning"
        : "neutral";
  const vehicleActionLabel = vehicleReady ? "Редактировать" : vehicleHasAnyManualData ? "Дополнить" : "Заполнить автомобиль";
  const vehicleHelpText = vehicleReady
    ? vehicleCompleteness.missing.length
      ? "Паспорт сохранён. Дополните силовой агрегат и эксплуатационные данные при следующем визите."
      : "Паспорт заполнен: данные будут использованы в следующих отгрузках и записях клиента."
    : vehicleHasAnyManualData
      ? "Добавьте модель вместе с номером, пробегом или годом, чтобы считать авто заполненным."
      : "Можно заполнить вручную без VIN или воспользоваться подбором фильтров по автомобилю.";
  const readinessItems = [
    { key: "organization", label: "Организация", ready: Boolean(selectedOrg), hint: "выберите организацию", required: true },
    { key: "store", label: "Склад", ready: Boolean(selectedStore), hint: "выберите склад", required: true },
    { key: "client", label: "Клиент", ready: Boolean(selectedAgent), hint: "выберите клиента", required: true },
    {
      key: "vehicle",
      label: "Автомобиль",
      ready: vehicleReady,
      partial: vehicleHasAnyManualData && !vehicleReady,
      hint: "заполните модель и номер или пробег",
      optional: true,
    },
    { key: "positions", label: "Позиции", ready: positions.length > 0, hint: "добавьте товар или услугу" },
  ];
  const requiredReadinessItems = readinessItems.filter((item) => item.required);
  const readinessMissing = requiredReadinessItems.filter((item) => !item.ready).map((item) => item.label.toLowerCase());
  const workflowMissing = readinessItems
    .filter((item) => !item.ready)
    .map((item) => item.partial ? `${item.label.toLowerCase()}: ${item.hint}` : item.label.toLowerCase());
  const readinessStripMissing = readinessItems
    .filter((item) => !item.ready && !item.partial && !item.optional)
    .map((item) => item.label.toLowerCase());
  const readinessStripText = readinessStripMissing.length > 0
    ? `Не хватает: ${readinessStripMissing.join(", ")}`
    : workflowMissing.length > 0
      ? `Можно дополнить: ${workflowMissing.join(", ")}`
      : "Готово к сохранению";
  const nonstockCostBlocksPosting = applicable && missingNonstockCostCount > 0;
  const saveDisabledReason = readinessMissing.length > 0
    ? `Не хватает: ${readinessMissing.join(", ")}`
    : nonstockCostBlocksPosting
      ? "Укажите закупочную цену разового товара"
      : "";
  const saveDisabled = submitLoading || readinessMissing.length > 0 || nonstockCostBlocksPosting;
  const documentStepReady = Boolean(selectedOrg && selectedStore);
  const finalStepReady = documentStepReady && Boolean(selectedAgent) && positions.length > 0 && overAvailablePositionsCount === 0 && !nonstockCostBlocksPosting;
  const vehicleAttributeControls = [
    {
      section: "identity",
      key: "make",
      label: "Марка",
      attributeName: "марка",
      placeholder: "Например: HYUNDAI",
      match: (name: string) => name === "марка",
    },
    {
      section: "identity",
      key: "model",
      label: "Модель",
      attributeName: "модель",
      placeholder: "Например: Solaris",
      match: (name: string) => name === "модель",
    },
    {
      section: "identity",
      key: "generation",
      label: "Поколение",
      attributeName: "поколение",
      placeholder: "Например: II (HCr)",
      match: (name: string) => name === "поколение",
    },
    {
      section: "identity",
      key: "plate",
      label: "Госномер",
      attributeName: "гос. номер",
      placeholder: "Например: Т349ОК39",
      match: (name: string) => /^гос\.?\s*номер$|^госномер$|license\s*plate|plate/i.test(name),
    },
    {
      section: "identity",
      key: "mileage",
      label: "Пробег",
      attributeName: "пробег",
      placeholder: "Например: 154000",
      match: (name: string) => /пробег/i.test(name),
    },
    {
      section: "identity",
      key: "year",
      label: "Год",
      attributeName: "год",
      placeholder: "Например: 2018",
      match: (name: string) => name === "год",
    },
    {
      section: "identity",
      key: "vin",
      label: "VIN",
      attributeName: "vin номер",
      placeholder: "Например: Z94K241BBJR074943",
      match: (name: string) => /vin/i.test(name),
    },
    {
      section: "powertrain",
      key: "engineName",
      label: "Двигатель",
      attributeName: "двигатель",
      placeholder: "Например: 1.4 MPI",
      match: (name: string) => name === "двигатель",
    },
    {
      section: "powertrain",
      key: "engineCode",
      label: "Код двигателя",
      attributeName: "код двигателя",
      placeholder: "Например: G4LC",
      match: (name: string) => name === "код двигателя",
    },
    {
      section: "powertrain",
      key: "engineSeries",
      label: "Серия двигателя",
      attributeName: "серия двигателя",
      placeholder: "Например: Gamma",
      match: (name: string) => name === "серия двигателя",
    },
    {
      section: "powertrain",
      key: "engineVolume",
      label: "Объём двигателя, л",
      attributeName: "объем двигателя",
      placeholder: "Например: 1,4",
      match: (name: string) => name === "объем двигателя",
    },
    {
      section: "powertrain",
      key: "powerHp",
      label: "Мощность, л.с.",
      attributeName: "мощность",
      placeholder: "Например: 100",
      match: (name: string) => name === "мощность",
    },
    {
      section: "powertrain",
      key: "fuelType",
      label: "Топливо",
      attributeName: "топливо",
      placeholder: "Например: бензин",
      match: (name: string) => name === "топливо",
    },
    {
      section: "powertrain",
      key: "transmissionType",
      label: "Тип коробки",
      attributeName: "коробка",
      placeholder: "АКПП / МКПП / вариатор / робот",
      match: (name: string) => name === "коробка",
    },
    {
      section: "powertrain",
      key: "transmissionName",
      label: "Модель коробки",
      attributeName: "модель коробки",
      placeholder: "Например: A6GF1",
      match: (name: string) => name === "модель коробки",
    },
    {
      section: "powertrain",
      key: "driveType",
      label: "Привод",
      attributeName: "привод",
      placeholder: "Передний / задний / полный",
      match: (name: string) => name === "привод",
    },
    {
      section: "additional",
      key: "bodyName",
      label: "Кузов",
      attributeName: "кузов",
      placeholder: "Например: седан HC",
      match: (name: string) => name === "кузов",
    },
    {
      section: "additional",
      key: "bodyCode",
      label: "Код кузова",
      attributeName: "код кузова",
      placeholder: "Например: HC",
      match: (name: string) => name === "код кузова",
    },
    {
      section: "additional",
      key: "bodyType",
      label: "Тип кузова",
      attributeName: "тип кузова",
      placeholder: "Например: седан",
      match: (name: string) => name === "тип кузова",
    },
    {
      section: "additional",
      key: "frameNumber",
      label: "Номер кузова / Frame",
      attributeName: "номер кузова",
      placeholder: "Для машин без 17-значного VIN",
      match: (name: string) => name === "номер кузова",
    },
    {
      section: "additional",
      key: "powerKw",
      label: "Мощность, кВт",
      attributeName: "мощность квт",
      placeholder: "Например: 74",
      match: (name: string) => name === "мощность квт",
    },
    {
      section: "additional",
      key: "modelYearFrom",
      label: "Модельный год с",
      attributeName: "модельный год с",
      placeholder: "Например: 2017",
      match: (name: string) => name === "модельный год с",
    },
    {
      section: "additional",
      key: "modelYearTo",
      label: "Модельный год по",
      attributeName: "модельный год по",
      placeholder: "Например: 2022",
      match: (name: string) => name === "модельный год по",
    },
    {
      section: "additional",
      key: "steeringPosition",
      label: "Руль",
      attributeName: "руль",
      placeholder: "Левый / правый",
      match: (name: string) => name === "руль",
    },
    {
      section: "additional",
      key: "market",
      label: "Рынок",
      attributeName: "рынок",
      placeholder: "Например: Европа",
      match: (name: string) => name === "рынок",
    },
    {
      section: "additional",
      key: "countryOfOrigin",
      label: "Страна сборки",
      attributeName: "страна сборки",
      placeholder: "Например: Россия",
      match: (name: string) => name === "страна сборки",
    },
    {
      section: "additional",
      key: "ownersCount",
      label: "Владельцев",
      attributeName: "владельцев",
      placeholder: "Например: 2",
      match: (name: string) => name === "владельцев",
    },
  ].map((control) => {
    const attrIndex = attributes.findIndex((a) => control.match(normalizeAttrName(a.name)));
    const attr = attrIndex >= 0 ? attributes[attrIndex] : null;
    const fallback = control.key === "make" ? legacyModelParts.make : control.key === "model" ? legacyModelParts.model : "";
    const value = control.key === "vin" ? documentVin : attributeValueToString(attr?.value) || fallback;
    return { ...control, attr, attrIndex, value };
  });
  const vehicleSummaryItems: KeyValueItem[] = [
    { key: "model", label: "Марка / модель", value: vehicleTitle || "—" },
    { key: "generation", label: "Поколение / кузов", value: [attrGeneration, attrBody].filter(Boolean).join(" · ") || "—" },
    { key: "plate", label: "Госномер", value: attrPlate || "—" },
    { key: "mileage", label: "Пробег", value: attrMileage ? `${attrMileage} км` : "—" },
    { key: "year", label: "Год", value: attrYear || "—" },
    { key: "engine", label: "Двигатель", value: [attrEngineCode, attrEngine].filter(Boolean).join(" · ") || "—" },
    { key: "engineVolume", label: "Объём / мощность", value: [attrEngineVolume, attrPower].filter(Boolean).join(" · ") || "—" },
    { key: "transmission", label: "Коробка / привод", value: [attrTransmission, attrTransmissionName, attrDrive].filter(Boolean).join(" · ") || "—" },
    { key: "vin", label: "VIN", value: documentVin || "—", wide: true },
  ];
  const vehicleAdditionalSummaryItems: KeyValueItem[] = [
    { key: "fuel", label: "Топливо", value: attrFuel || "—" },
    { key: "engineSeries", label: "Серия двигателя", value: attrEngineSeries || "—" },
    { key: "powerKw", label: "Мощность, кВт", value: attrPowerKw || "—" },
    { key: "bodyDetails", label: "Кузов", value: [attrBodyType, attrBodyCode].filter(Boolean).join(" · ") || "—" },
    { key: "frame", label: "Номер кузова", value: attrFrameNumber || "—" },
    { key: "steering", label: "Руль", value: attrSteering || "—" },
    { key: "market", label: "Рынок", value: attrMarket || "—" },
    { key: "country", label: "Страна сборки", value: attrCountry || "—" },
    { key: "owners", label: "Владельцев", value: attrOwners || "—" },
    { key: "modelYears", label: "Модельные годы", value: [attrModelYearFrom, attrModelYearTo].filter(Boolean).join("–") || "—" },
  ];
  const documentMomentLabel = momentStr ? formatServiceDateTime(momentStr) : "Дата и время...";
  const documentParamsSummary = [
    loadingOrgs ? "Организация..." : selectedOrg?.name ?? "Организация не выбрана",
    loadingStores ? "Склад..." : selectedStore?.name ?? "Склад не выбран",
    documentMomentLabel,
  ].join(" · ");

  const openVehicleEditor = () => {
    setVehicleDraftValues(
      Object.fromEntries(vehicleAttributeControls.map((control) => [control.key, control.value]))
    );
    setVehicleSaving(false);
    setVehicleEditorOpen(true);
  };

  const saveVehicleEditor = async () => {
    if (vehicleSaving) return;
    setVehicleSaving(true);
    const nextValues = new Map(
      vehicleAttributeControls.map((control) => {
        const attrName = control.attr?.name ?? control.attributeName;
        return [
          control.key,
          formatVehicleAttributeInput(attrName, vehicleDraftValues[control.key] ?? control.value),
        ] as const;
      })
    );
    const nextVin = nextValues.get("vin") ?? "";
    setVin(nextVin);
    setManualEngineVolume("");
    setManualEnginePower("");
    setShowVehicleOverrideDialog(false);
    setAttributes((prev) => {
      const next = [...prev];
      for (const control of vehicleAttributeControls) {
        const attrName = control.attr?.name ?? control.attributeName;
        const value = nextValues.get(control.key) ?? "";
        const existingIndex = next.findIndex((attribute) => {
          const normalizedName = normalizeAttrName(attribute.name);
          return control.match(normalizedName) || normalizedName === normalizeAttrName(attrName);
        });
        if (existingIndex >= 0) {
          const current = next[existingIndex];
          if (current) next[existingIndex] = { ...current, value: value || null };
          continue;
        }
        if (!value) continue;
        next.push({
          id: `vehicle-${control.key}`,
          name: attrName,
          type: "string",
          meta: {
            href: `local://demand-attribute/${encodeURIComponent(attrName)}`,
            type: "demandattribute",
            mediaType: "application/json",
          },
          value,
        });
      }
      const displayModel = [nextValues.get("make"), nextValues.get("model")].filter(Boolean).join(" ");
      const legacyIndex = next.findIndex((attribute) => normalizeAttrName(attribute.name) === "модель авто");
      if (legacyIndex >= 0 && next[legacyIndex]) next[legacyIndex] = { ...next[legacyIndex], value: displayModel || null, source: "manual" };
      else if (displayModel) next.push({
        id: "vehicle-model-display",
        name: "модель авто",
        type: "string",
        meta: { href: "local://demand-attribute/vehicle-model", type: "demandattribute", mediaType: "application/json" },
        value: displayModel,
        source: "manual",
      });
      return next;
    });
    const engineLiters = parseVehicleNumber(nextValues.get("engineVolume") ?? "");
    const manualValues: ClientVehiclePassportValues = {
      make: nextValues.get("make") || null,
      model: nextValues.get("model") || null,
      generation: nextValues.get("generation") || null,
      year: parseVehicleNumber(nextValues.get("year") ?? ""),
      plate: nextValues.get("plate") || null,
      vin: nextVin || null,
      bodyName: nextValues.get("bodyName") || null,
      bodyCode: nextValues.get("bodyCode") || null,
      bodyType: nextValues.get("bodyType") || null,
      frameNumber: nextValues.get("frameNumber") || null,
      engineName: nextValues.get("engineName") || null,
      engineCode: nextValues.get("engineCode") || null,
      engineSeries: nextValues.get("engineSeries") || null,
      engineVolumeCc: engineLiters == null ? null : Math.round(engineLiters * 1000),
      powerHp: parseVehicleNumber(nextValues.get("powerHp") ?? ""),
      powerKw: parseVehicleNumber(nextValues.get("powerKw") ?? ""),
      fuelType: nextValues.get("fuelType") || null,
      transmissionType: nextValues.get("transmissionType") || null,
      transmissionName: nextValues.get("transmissionName") || null,
      driveType: nextValues.get("driveType") || null,
      steeringPosition: nextValues.get("steeringPosition") || null,
      market: nextValues.get("market") || null,
      countryOfOrigin: nextValues.get("countryOfOrigin") || null,
      mileage: parseVehicleNumber(nextValues.get("mileage") ?? ""),
      ownersCount: parseVehicleNumber(nextValues.get("ownersCount") ?? ""),
      modelYearFrom: parseVehicleNumber(nextValues.get("modelYearFrom") ?? ""),
      modelYearTo: parseVehicleNumber(nextValues.get("modelYearTo") ?? ""),
    };
    const savedProfile = await persistVehicleProfile({ mode: "confirmed", values: manualValues, mannVariantIds: vehicleProfile?.mannVariantIds });
    if (savedProfile) setIdentifiedVehicle(profileToVehicleIdentity(savedProfile));
    setVehicleDraftValues({});
    markDraftDirty();
    setVehicleEditorOpen(false);
    setVehicleSaving(false);
  };

  const cancelVehicleEditor = () => {
    setVehicleSaving(false);
    setVehicleDraftValues({});
    setVehicleEditorOpen(false);
  };

  const confirmDocumentParameterChange = () => {
    if (positions.length === 0) return true;
    return window.confirm("При смене организации могут измениться склад, цены, налоги и нумерация документа.");
  };

  const handleOrganizationChange = (orgId: string) => {
    if ((selectedOrg?.id ?? "") === orgId) return;
    if (!confirmDocumentParameterChange()) return;
    const org = organizations.find((item) => item.id === orgId) ?? null;
    setSelectedOrg(org);
    if (org) {
      window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, org.id);
      window.dispatchEvent(new CustomEvent(ORGANIZATION_EVENT, { detail: { organizationId: org.id } }));
    }
    markDraftDirty();
  };

  const handleStoreChange = (storeId: string) => {
    if ((selectedStore?.id ?? "") === storeId) return;
    if (!confirmDocumentParameterChange()) return;
    const store = stores.find((item) => item.id === storeId) ?? null;
    setSelectedStore(store);
    markDraftDirty();
  };

  const focusReadinessItem = (key: string) => {
    if (key === "organization" || key === "store") {
      setDocumentParamsOpen(true);
      window.setTimeout(() => document.getElementById(key === "organization" ? "shipment-document-org" : "shipment-document-store")?.focus(), 0);
      return;
    }
    if (key === "client") {
      document.getElementById("shipment-client-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => document.getElementById("shipment-client-search")?.focus(), 250);
      return;
    }
    if (key === "vehicle") {
      openVehicleEditor();
      document.getElementById("shipment-vehicle-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => document.getElementById("shipment-vehicle-model")?.focus(), 250);
      return;
    }
    if (key === "positions") {
      setPositionAddMode("catalog");
      document.getElementById("shipment-positions-add")?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => document.getElementById("shipment-product-search")?.focus(), 250);
    }
  };
  const hasProductSearchQuery = manualMannFilter
    ? Boolean((productSearch.trim() || manualMannFilter.mannArticle).trim())
    : productSearchMode === "service" || [productSearch.trim(), productOem.trim(), productParams.trim()].some(Boolean);
  const showProductResults = productResultsOpen && hasProductSearchQuery;
  const productOptionIsAdded = (product: Product) => positions.some((position) => position.assortmentMeta?.href === product.meta.href);
  const availableProductOptions = productOptions.filter((product) => {
    if (isServiceMeta(product.meta) || productOptionIsAdded(product)) return true;
    return (product.availableQuantity ?? product.stockQuantity ?? 0) > 0;
  });
  const orderableProductOptions = productOptions.filter((product) => {
    if (isServiceMeta(product.meta) || productOptionIsAdded(product)) return false;
    const available = product.availableQuantity ?? product.stockQuantity ?? 0;
    return available <= 0 && (product.orderable === true || Boolean(product.supplierName));
  });
  const unavailableProductOptions = productOptions.filter((product) => {
    if (isServiceMeta(product.meta) || productOptionIsAdded(product)) return false;
    const available = product.availableQuantity ?? product.stockQuantity ?? 0;
    return available <= 0 && product.orderable !== true && !product.supplierName;
  });
  const visibleProductOptions = [
    ...availableProductOptions,
    ...(showOrderableProducts ? orderableProductOptions : []),
    ...(showUnavailableProducts ? unavailableProductOptions : []),
  ];
  const addProductFromSearch = manualMannFilter ? addManualMannProductToPosition : addPosition;
  const productSearchEntityLabel =
    manualMannFilter ? "Товар для MANN" : productSearchMode === "product" ? "Товар" : productSearchMode === "service" ? "Услуга" : "Товары и услуги";
  const productSearchLoadingLabel =
    manualMannFilter
      ? "Ищем строго по названию и OEM PARTS…"
      : productSearchMode === "service"
      ? "Ищем услуги в каталоге…"
      : productSearchMode === "product"
        ? "Ищем товары в каталоге…"
        : "Ищем товары и услуги в каталоге…";
  const productSearchErrorLabel =
    manualMannFilter
      ? "Не удалось выполнить поиск MANN"
      : productSearchMode === "service"
      ? "Не удалось загрузить услуги"
      : productSearchMode === "product"
        ? "Не удалось загрузить товары"
        : "Не удалось загрузить позиции";
  const productSearchEmptyHint =
    manualMannFilter
      ? "В названии и OEM PARTS нет точного нормализованного совпадения для этого MANN-артикула."
      : productSearchMode === "service"
      ? "Мы искали среди услуг. Попробуйте изменить запрос или создайте разовую услугу."
      : productSearchMode === "product"
        ? "Мы искали среди товаров. Попробуйте изменить запрос или создайте локальную позицию."
        : "Мы искали среди товаров и услуг. Попробуйте изменить запрос или создайте новую позицию.";
  const selectedMannVariant = mannVariants.find((variant) => variant.variantId === selectedMannVariantId) ?? null;
  const vehicleContextTitle = vehicleTitle || [selectedMannMake, selectedMannModel].filter(Boolean).join(" ") || "Автомобиль не указан";
  const vehicleEngineLabel = [
    decodedVehicle?.displacementL ? `${decodedVehicle.displacementL} л` : attrEngineVolume ? `${attrEngineVolume} л` : "",
    decodedVehicle?.engineSeries,
  ].filter(Boolean).join(" · ");
  const mannMakeOptions = mannMakes.map((item): MannComboboxOption => ({
    value: item.make,
    label: item.make,
    meta: `${item.countModels} моделей`,
    searchText: [item.make, ...(MANN_MAKE_ALIASES[item.make] ?? [])].join(" "),
  }));
  const mannModelOptions = mannModels.map((item): MannComboboxOption => ({
    value: item.model,
    label: item.model,
    meta: [item.modelYears, `${item.countVariants} мод.`].filter(Boolean).join(" · "),
    searchText: [item.model, item.modelYears].filter(Boolean).join(" "),
  }));
  const mannVariantOptions = mannVariants.map((variant): MannComboboxOption => ({
    value: variant.variantId,
    label: variant.effectiveVehicleText || variant.vehicleText || "Все модификации",
    meta: [
      variant.engineCode,
      variant.kw ? `${variant.kw} kW` : "",
      variant.hp ? `${variant.hp} hp` : "",
      variant.vehicleYears,
    ].filter(Boolean).join(" · "),
    searchText: [
      variant.effectiveVehicleText,
      variant.vehicleText,
      variant.engineCode,
      variant.kw,
      variant.hp,
      variant.vehicleYears,
      variant.condition,
    ].filter(Boolean).join(" "),
  }));
  const mannVehicleModificationLabel = selectedMannVariant
    ? `${selectedMannMake} ${selectedMannModel} · ${describeMannVariant(selectedMannVariant)}`
    : [selectedMannMake, selectedMannModel].filter(Boolean).join(" ");
  const mannManualReady = Boolean(selectedMannMake && selectedMannModel && selectedMannVariantId);
  const handleMannManualSubmit = () => {
    if (!mannManualReady) return;
    setMannPickerExpanded(false);
    setMannManualCue("idle");
    window.setTimeout(() => {
      document.querySelector(".eco-shipment-mann-kit, .eco-shipment-mann-filter-list")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
  };
  const mannSortedFilters = mannFilters
    .slice()
    .sort((left, right) => mannFilterGroupOrder(left.filterType) - mannFilterGroupOrder(right.filterType) || left.mannArticle.localeCompare(right.mannArticle, "ru"));
  const mannActionParams = (filter: MannFilter, extra?: Record<string, string>) => {
    const params = new URLSearchParams({
      source: "mann-picker",
      brand: "MANN",
      mannArticle: filter.mannArticle,
      filterType: filter.filterType,
      filterLabel: getMannFilterTypeLabel(filter.filterType),
      make: selectedMannMake,
      model: selectedMannModel,
      variant: selectedMannVariant ? describeMannVariant(selectedMannVariant) : "",
      demandId: demandIdLocal ?? "",
      ...(extra ?? {}),
    });
    for (const [key, value] of [...params.entries()]) {
      if (!value) params.delete(key);
    }
    return params;
  };
  const mannCreateProductHref = (filter: MannFilter) => {
    const params = mannActionParams(filter, {
      create: "1",
      article: filter.mannArticle,
      name: `${getMannFilterTypeLabel(filter.filterType)} MANN ${filter.mannArticle}`,
      groupPath: getMannFilterGroupPath(filter.filterType),
    });
    return `/inventory/products?${params.toString()}`;
  };
  const mannRestockHref = (filter: MannFilter) => {
    const params = mannActionParams(filter, {
      search: filter.mannArticle,
      quantity: "1",
      comment: `Подбор MANN: ${selectedMannMake} ${selectedMannModel}`.trim(),
    });
    return `/operations/restock?${params.toString()}`;
  };
  const mannRosskoHref = (filter: MannFilter) => {
    const params = mannActionParams(filter, {
      rossko: filter.mannArticle,
      article: filter.mannArticle,
    });
    return `/operations/restock?${params.toString()}`;
  };
  const showAgentSearchPanel = Boolean(
    (!selectedAgent || replacingAgent) &&
    !showCreateAgentForm &&
    agentDropdownOpen &&
      (shouldSearchCounterparties(agentSearch) || agentOptions.length > 0 || agentLoading || agentSearchError),
  );
  const clientPhone = selectedAgent?.phone ?? selectedAgent?.normalizedPhone ?? "";
  const isAnonymousRetail = selectedAgent?.isAnonymousRetail === true;
  const hasServicePositions = positions.some((position) => isServiceMeta(position.assortmentMeta));
  const clientDisplayName = selectedAgent ? counterpartyDisplayName(selectedAgent) : "";
  const clientTypeLabel = selectedAgent ? counterpartyTypeLabel(selectedAgent) : "";
  const clientVehicleLabel = selectedAgent ? counterpartyVehicleLabel(selectedAgent) : "";
  const clientInitials =
    clientDisplayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "К";
  const openAgentPicker = () => {
    setReplacingAgent(true);
    setAgentSearch("");
    setAgentOptions([]);
    setAgentSearchError(null);
    setAgentDropdownOpen(false);
    window.setTimeout(() => document.getElementById("shipment-client-search")?.focus(), 0);
  };
  const documentTitle = isExistingDraft ? `Отгрузка ${existingDemandName ?? demandIdLocal ?? demandId}` : "Новая отгрузка";
  const saveButtonLabel = submitLoading
    ? isExistingDraft
      ? "Сохранение..."
      : "Создание..."
    : isExistingDraft
      ? "Сохранить изменения"
      : "Сохранить отгрузку";
  const compactSaveButtonLabel = submitLoading ? (isExistingDraft ? "Сохранение..." : "Создание...") : "Сохранить";

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
        <div className="eco-shipment-new-head-main">
          <div className="eco-page-kicker">
            <Link href="/shipment">Операции / Отгрузки</Link>
            <span>{isExistingDraft ? " / Редактирование" : " / Новая"}</span>
          </div>
          <div className="eco-shipment-new-title-row">
            <h1 className="eco-page-title">{documentTitle}</h1>
          </div>
          <div className="eco-shipment-new-doc-strip">
            <span>{documentParamsSummary}</span>
            <button type="button" onClick={() => setDocumentParamsOpen(true)}>
              <Settings2 className="eco-icon" aria-hidden />
              Изменить
            </button>
          </div>
        </div>
        <div className="eco-actions">
          <Link href="/shipment" className="eco-btn eco-shipment-back-link">
            <ArrowLeft className="eco-icon" aria-hidden />
            К отгрузкам
          </Link>
        </div>
      </header>

      {readinessStripMissing.length > 0 ? (
        <section className="eco-shipment-new-readiness-strip" aria-label="Что нужно заполнить">
          <div className="eco-shipment-new-readiness-items">
            {readinessItems.filter((item) => !item.ready && !item.partial && !item.optional).map((item) => (
              <button key={item.key} type="button" className="is-missing" onClick={() => focusReadinessItem(item.key)} title={item.hint}>
                <Circle className="eco-icon" aria-hidden />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <strong className="is-missing">{readinessStripText}</strong>
        </section>
      ) : null}

      <nav className="eco-shipment-workflow-nav" aria-label="Этапы создания отгрузки">
        <a
          href="#shipment-parties"
          className={selectedAgent ? "is-complete" : "is-current"}
          aria-current={!selectedAgent ? "step" : undefined}
        >
          <span className="eco-shipment-workflow-index" aria-hidden>{selectedAgent ? "✓" : "1"}</span>
          <span>
            <strong>Клиент и автомобиль</strong>
            <small>{selectedAgent ? clientDisplayName : "Выберите клиента"}</small>
          </span>
        </a>
        <a
          href="#shipment-positions-workspace"
          className={positions.length > 0 ? "is-complete" : selectedAgent ? "is-current" : "is-upcoming"}
          aria-current={selectedAgent && positions.length === 0 ? "step" : undefined}
        >
          <span className="eco-shipment-workflow-index" aria-hidden>{positions.length > 0 ? "✓" : "2"}</span>
          <span>
            <strong>Состав отгрузки</strong>
            <small>{positions.length > 0 ? `${positions.length} позиций · ${positionsQty} ед.` : "Добавьте товары или услуги"}</small>
          </span>
        </a>
        <a
          href="#shipment-finalize"
          className={finalStepReady ? "is-complete" : selectedAgent && positions.length > 0 ? "is-current" : "is-upcoming"}
          aria-current={!finalStepReady && Boolean(selectedAgent) && positions.length > 0 ? "step" : undefined}
        >
          <span className="eco-shipment-workflow-index" aria-hidden>{finalStepReady ? "✓" : "3"}</span>
          <span>
            <strong>Проверка и сохранение</strong>
            <small>{finalStepReady ? "Можно завершать" : "Проверьте документ"}</small>
          </span>
        </a>
      </nav>

      {documentParamsOpen && (
        <div className="eco-shipment-doc-modal-backdrop" onClick={() => setDocumentParamsOpen(false)}>
          <div className="eco-shipment-doc-modal" role="dialog" aria-modal="true" aria-label="Параметры документа" onClick={(e) => e.stopPropagation()}>
            <div className="eco-shipment-card-head">
              <div>
                <div className="eco-page-kicker">Параметры</div>
                <h2>Документ</h2>
              </div>
              <button type="button" className="eco-shipment-icon-btn" onClick={() => setDocumentParamsOpen(false)} aria-label="Закрыть">
                <X className="eco-icon" aria-hidden />
              </button>
            </div>
            <div className="eco-shipment-new-document-body">
              <label className="eco-field">
                <span>Организация</span>
                <select
                  id="shipment-document-org"
                  value={selectedOrg?.id ?? ""}
                  onChange={(e) => handleOrganizationChange(e.target.value)}
                  className="eco-input"
                  disabled={loadingOrgs}
                >
                  {loadingOrgs ? (
                    <option value="">Загрузка...</option>
                  ) : (
                    <>
                      <option value="">Не выбрана</option>
                      {organizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.isDefault ? `${org.name} · основная` : org.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>
              <label className="eco-field">
                <span>Склад</span>
                <select
                  id="shipment-document-store"
                  value={selectedStore?.id ?? ""}
                  onChange={(e) => handleStoreChange(e.target.value)}
                  className="eco-input"
                  disabled={loadingStores}
                >
                  {loadingStores ? (
                    <option value="">Загрузка...</option>
                  ) : (
                    <>
                      <option value="">Не выбран</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>
              <label className="eco-field">
                <span>Дата и время</span>
                <input
                  type="text"
                  value={momentStr}
                  onChange={(e) => {
                    setMomentStr(e.target.value);
                    markDraftDirty();
                  }}
                  className="eco-input eco-shipment-new-date-input"
                />
              </label>
              <EcoButton type="button" onClick={() => setDocumentParamsOpen(false)} variant="primary">
                Готово
              </EcoButton>
            </div>
          </div>
        </div>
      )}

      {copyNotice && (
        <div className="eco-shipment-copy-notice">
          <span>Отгрузка скопирована. Вы можете отредактировать черновик перед сохранением.</span>
          <button type="button" onClick={() => setCopyNotice(false)}>Закрыть</button>
        </div>
      )}

      {(copiedPriceUpdates.length > 0 || copiedPositionIssues.length > 0) && (
        <div className="eco-shipment-copy-audit">
          <strong>Позиции пересобраны по локальному каталогу.</strong>
          <span>
            {copiedPriceUpdates.length > 0 ? `Цены обновлены: ${copiedPriceUpdates.length}. ` : ""}
            {copiedPositionIssues.length > 0 ? `Требуют проверки: ${copiedPositionIssues.length}.` : "Складские данные и ячейки подтянуты актуальными."}
          </span>
        </div>
      )}

      {isExistingDraft && (saveState === "saved" || saveState === "dirty") && (
        <div className={`eco-shipment-save-state ${saveState === "dirty" ? "is-dirty" : ""}`}>
          {saveState === "dirty" ? "Есть несохранённые изменения" : "Сохранено"}
        </div>
      )}

      <div className="eco-shipment-detail-layout eco-shipment-new-draft-layout">
        <div className="eco-shipment-detail-main eco-shipment-new-main">
      <section id="shipment-parties" className="eco-shipment-workflow-section eco-shipment-workflow-section--context" aria-labelledby="shipment-parties-title">
        <header className="eco-shipment-workflow-section-head">
          <div>
            <span>Шаг 1</span>
            <h2 id="shipment-parties-title">Клиент и автомобиль</h2>
          </div>
          <p>Без данных клиента можно сразу перейти к товарам. Для сервисной истории укажите клиента.</p>
        </header>
        <div className="eco-shipment-entity-grid">
        <article id="shipment-client-card" className="eco-card eco-shipment-entity-card eco-shipment-client-card">
          <EntityCardHeader
            title={replacingAgent ? "Указать клиента" : selectedAgent ? "Клиент" : "Выберите клиента"}
            status={isAnonymousRetail && !replacingAgent ? "По умолчанию" : selectedAgent ? undefined : "Нужно выбрать"}
            tone={isAnonymousRetail ? "neutral" : selectedAgent ? "success" : "neutral"}
          />
          <div className={`eco-shipment-card-body ${selectedAgent ? "is-filled-client" : ""}`}>
            {!selectedAgent || replacingAgent ? (
              <div className="eco-shipment-client-picker">
                {anonymousRetailAgent && (
                  <button
                    type="button"
                    className="eco-anonymous-retail-option"
                    onClick={() => selectAgentOption(anonymousRetailAgent)}
                  >
                    <span>
                      <strong>Без данных клиента</strong>
                      <small>Розничный покупатель</small>
                    </span>
                    <EcoBadge tone="neutral">По умолчанию</EcoBadge>
                  </button>
                )}
                <div className="eco-shipment-client-search-row">
                <div ref={agentSearchRef} className="eco-shipment-client-search-wrap">
                  <label className="eco-field eco-shipment-client-search">
                    <span>Поиск по имени, телефону или номеру</span>
                    {agentLoading ? (
                      <span className="eco-client-search-icon eco-search-spinner" aria-hidden />
                    ) : (
                      <Search className="eco-client-search-icon" aria-hidden />
                    )}
                    <input
                      id="shipment-client-search"
                      type="text"
                      value={agentSearch}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setAgentSearch(nextValue);
                        setAgentSearchError(null);
                        setAgentDropdownOpen(Boolean(nextValue.trim()));
                        setHighlightedAgentIndex(0);
                        if (!nextValue.trim()) setAgentOptions([]);
                      }}
                      onFocus={() => {
                        setAgentDropdownOpen(Boolean(agentSearch.trim()));
                        loadInitialCounterparties();
                      }}
                      onKeyDown={handleAgentSearchKeyDown}
                      placeholder="Например, +7 911..."
                      className="eco-input"
                      autoComplete="off"
                      role="combobox"
                      aria-expanded={showAgentSearchPanel}
                      aria-controls="shipment-client-results"
                      aria-autocomplete="list"
                    />
                  </label>
                  {showAgentSearchPanel && (
                    <div id="shipment-client-results" className="eco-counterparty-results" role="listbox" aria-live="polite" onMouseDown={(event) => event.preventDefault()}>
                      {agentLoading ? (
                        <div className="eco-counterparty-results-state">
                          <div className="eco-product-loading-copy">
                            <span className="eco-product-loading-spinner" aria-hidden />
                            <div>
                              <strong>Ищем клиентов...</strong>
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
                          <strong>Не удалось загрузить клиентов</strong>
                          <span>Повторите попытку.</span>
                          <button type="button" onClick={() => void loadInitialCounterparties()}>
                            Повторить
                          </button>
                        </div>
                      ) : agentOptions.length > 0 ? (
                        <ul className="eco-counterparty-results-list">
                          {agentOptions.map((agent, index) => {
                            const displayName = counterpartyDisplayName(agent);
                            const phone = cleanCounterpartyValue(agent.phone) || cleanCounterpartyValue(agent.normalizedPhone);
                            const typeLabel = counterpartyTypeLabel(agent);
                            const vehicleLabel = counterpartyVehicleLabel(agent);
                            const secondary = counterpartySecondaryLine(agent);
                            return (
                              <li key={agent.id}>
                                <div className={`eco-counterparty-option-row ${highlightedAgentIndex === index ? "is-highlighted" : ""}`}>
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={highlightedAgentIndex === index}
                                    className="eco-counterparty-option-main"
                                    onMouseEnter={() => setHighlightedAgentIndex(index)}
                                    onClick={() => selectAgentOption(agent)}
                                  >
                                    <span className="eco-counterparty-option-title">{displayName}</span>
                                    <span className="eco-counterparty-option-meta">
                                      {[phone, typeLabel, vehicleLabel].filter(Boolean).join(" · ")}
                                    </span>
                                    {secondary && <small>{secondary}</small>}
                                  </button>
                                  <Link href={counterpartyCatalogHref(agent)} className="eco-entity-open-link" title="Открыть контрагента">
                                    <ExternalLink className="eco-icon" aria-hidden />
                                  </Link>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <div className="eco-counterparty-results-state">
                          <strong>Клиенты не найдены</strong>
                          <span>Проверьте имя или телефон, либо создайте нового клиента.</span>
                          <button
                            type="button"
                            onClick={() => {
                              setAgentDropdownOpen(false);
                              openCreateAgentForm();
                            }}
                          >
                            Создать нового клиента
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {!showCreateAgentForm && (
                  <EcoButton type="button" onClick={openCreateAgentForm} variant="primary" className="eco-shipment-new-client-button">
                    <UserPlus className="eco-icon" aria-hidden />
                    Новый клиент
                  </EcoButton>
                )}
                </div>
              </div>
            ) : (
              <div className="eco-shipment-selected-client-card">
                <div className="eco-shipment-client-avatar" aria-hidden>{clientInitials}</div>
                <div className="eco-shipment-client-card-copy">
                  <strong>{clientDisplayName}</strong>
                  <span>{isAnonymousRetail ? "Без данных клиента" : clientPhone || "Телефон не указан"}</span>
                  <small>{isAnonymousRetail ? "Розничная продажа без клиентской истории и уведомлений" : [clientTypeLabel, clientVehicleLabel ? `Авто: ${clientVehicleLabel}` : "Автомобиль не указан"].filter(Boolean).join(" · ")}</small>
                </div>
                <div className="eco-shipment-client-card-actions">
                  {!isAnonymousRetail && (
                    <>
                      <ContactActionButton
                        variant="icon"
                        size="sm"
                        entityType="shipment"
                        counterpartyId={selectedAgent.id}
                        phone={clientPhone}
                        displayName={clientDisplayName}
                        context={{
                          entityType: "shipment",
                          entityId: "draft",
                          car: clientVehicleLabel,
                          plate: selectedAgent.vehiclePlate,
                        }}
                      />
                      <Link href={counterpartyCatalogHref(selectedAgent)} className="eco-shipment-client-action-icon" title="Открыть карточку клиента" aria-label="Открыть карточку клиента">
                        <ExternalLink className="eco-icon" aria-hidden />
                      </Link>
                    </>
                  )}
                  <button
                    type="button"
                    className={isAnonymousRetail ? "eco-shipment-client-change-button" : "eco-shipment-client-action-icon"}
                    onClick={openAgentPicker}
                    title={isAnonymousRetail ? "Указать клиента" : "Изменить клиента"}
                    aria-label={isAnonymousRetail ? "Указать клиента" : "Изменить клиента"}
                  >
                    <Pencil className="eco-icon" aria-hidden />
                    {isAnonymousRetail && <span>Указать клиента</span>}
                  </button>
                </div>
              </div>
            )}
            {isAnonymousRetail && hasServicePositions && !replacingAgent && (
              <div className="eco-shipment-anonymous-service-note">
                <span><strong>Клиент не указан.</strong> История обслуживания не будет сохранена в карточке клиента и автомобиля.</span>
                <button type="button" onClick={openAgentPicker}>Указать клиента</button>
              </div>
            )}
          </div>
        </article>

        <article id="shipment-vehicle-card" className={`eco-card eco-shipment-entity-card eco-shipment-vehicle-card ${vehicleEditorOpen ? "is-editing" : ""}`}>
          <EntityCardHeader
            title={vehicleEditorOpen ? "Редактирование" : "Автомобиль"}
            status={vehicleReady ? undefined : vehicleStatusText}
            tone={vehicleStatusTone}
            action={!vehicleEditorOpen ? (
              <button
                type="button"
                className="eco-shipment-entity-edit-button"
                onClick={openVehicleEditor}
                title={vehicleActionLabel}
                aria-label={vehicleActionLabel}
              >
                <Pencil className="eco-icon" aria-hidden />
              </button>
            ) : null}
          />
          {vehicleEditorOpen ? (
            <div className="eco-shipment-vehicle-editor">
              <div className="eco-shipment-vehicle-passport-intro">
                <div>
                  <strong>Паспорт автомобиля</strong>
                  <span>Заполните известное. Пустые поля можно дополнить при следующем визите.</span>
                </div>
                <b>{vehicleCompleteness.completed} из {vehicleCompleteness.total}</b>
              </div>
              {[{ key: "identity", label: "Основные данные" }, { key: "powertrain", label: "Силовой агрегат" }].map((section) => (
                <fieldset className="eco-shipment-vehicle-fieldset" key={section.key}>
                  <legend>{section.label}</legend>
                  <div className="eco-shipment-vehicle-editor-grid">
                    {vehicleAttributeControls.filter((control) => control.section === section.key).map((control) => (
                      <label key={control.key} className={control.key === "vin" ? "is-wide" : undefined}>
                        <span>{control.label}</span>
                        <input
                          id={control.key === "model" ? "shipment-vehicle-model" : undefined}
                          type="text"
                          inputMode={["year", "mileage", "engineVolume", "powerHp"].includes(control.key) ? "decimal" : undefined}
                          maxLength={control.key === "vin" ? 17 : undefined}
                          value={vehicleDraftValues[control.key] ?? control.value}
                          onChange={(e) => {
                            const attrName = control.attr?.name ?? control.label;
                            const nextValue = formatVehicleAttributeInput(attrName, e.target.value);
                            setVehicleDraftValues((prev) => ({ ...prev, [control.key]: nextValue }));
                          }}
                          className="eco-input"
                          placeholder={control.placeholder}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <details className="eco-shipment-vehicle-more-fields">
                <summary>Дополнительные данные</summary>
                <div className="eco-shipment-vehicle-editor-grid">
                  {vehicleAttributeControls.filter((control) => control.section === "additional").map((control) => (
                    <label key={control.key}>
                      <span>{control.label}</span>
                      <input
                        type="text"
                        inputMode={["modelYearFrom", "modelYearTo", "ownersCount"].includes(control.key) ? "numeric" : undefined}
                        value={vehicleDraftValues[control.key] ?? control.value}
                        onChange={(e) => {
                          const attrName = control.attr?.name ?? control.label;
                          const nextValue = formatVehicleAttributeInput(attrName, e.target.value);
                          setVehicleDraftValues((prev) => ({ ...prev, [control.key]: nextValue }));
                        }}
                        className="eco-input"
                        placeholder={control.placeholder}
                      />
                    </label>
                  ))}
                </div>
              </details>
              {vehicleProfileError ? <p className="eco-shipment-vehicle-profile-error" role="alert">{vehicleProfileError}</p> : null}
              <div className="eco-shipment-vehicle-editor-actions">
                <EcoButton type="button" onClick={cancelVehicleEditor}>
                  Отмена
                </EcoButton>
                <EcoButton type="button" onClick={saveVehicleEditor} variant="primary" disabled={vehicleSaving}>
                  {vehicleSaving ? "Сохранение..." : selectedAgent?.isAnonymousRetail ? "Сохранить в отгрузке" : "Сохранить паспорт"}
                </EcoButton>
              </div>
            </div>
          ) : (
            <div className="eco-shipment-vehicle-summary">
              <div className="eco-shipment-vehicle-completeness" aria-label={`Паспорт заполнен на ${vehicleCompleteness.percent}%`}>
                <span><i style={{ width: `${vehicleCompleteness.percent}%` }} /></span>
                <b>{vehicleCompleteness.percent}%</b>
                <em>{vehicleProfile?.verificationStatus === "CONFIRMED" ? "Подтверждено вручную" : vehicleProfile ? "Сохранено в карточке клиента" : "Данные текущей отгрузки"}</em>
              </div>
              <KeyValueGrid items={vehicleSummaryItems} />
              {vehicleAdditionalSummaryItems.some((item) => item.value !== "—") ? (
                <details className="eco-shipment-vehicle-summary-more">
                  <summary>Все данные паспорта</summary>
                  <KeyValueGrid items={vehicleAdditionalSummaryItems} />
                </details>
              ) : null}
              {vehicleProfileLoading ? <p>Обновляем карточку автомобиля…</p> : null}
              {vehicleProfileError ? <p className="eco-shipment-vehicle-profile-error" role="alert">{vehicleProfileError}</p> : null}
              {!vehicleReady ? <p>{vehicleHelpText}</p> : null}
            </div>
          )}
        </article>
        </div>
      </section>

      <section id="shipment-positions-workspace" className="eco-shipment-workflow-section eco-shipment-workflow-section--positions" aria-labelledby="shipment-positions-title">
        <header className="eco-shipment-workflow-section-head">
          <div>
            <span>Шаг 2</span>
            <h2 id="shipment-positions-title">Состав отгрузки</h2>
          </div>
          <p>Найдите позиции, затем проверьте количество, скидку и доступный остаток.</p>
        </header>
        <div className="eco-shipment-vehicle-context" aria-label="Автомобиль отгрузки">
          <div className="eco-shipment-vehicle-context__main">
            <span className={`eco-shipment-vehicle-context__status ${selectedMannVariant ? "is-matched" : vehicleReady ? "is-ready" : "is-empty"}`}>
              {selectedMannVariant ? "Автомобиль сопоставлен с каталогом" : vehicleReady ? "Автомобиль указан" : "Автомобиль не указан"}
            </span>
            <strong title={vehicleContextTitle}>{vehicleContextTitle}</strong>
            <span className="eco-shipment-vehicle-context__facts">
              {attrPlate ? <span><b>Госномер</b> {attrPlate}</span> : null}
              {attrYear ? <span><b>Год</b> {attrYear}</span> : null}
              {vehicleEngineLabel ? <span><b>Двигатель</b> {vehicleEngineLabel}</span> : null}
            </span>
            {selectedMannVariant ? (
              <span className="eco-shipment-vehicle-context__variant">
                <b>Модификация каталога:</b> {describeMannVariant(selectedMannVariant)}
              </span>
            ) : null}
          </div>
          <div className="eco-shipment-vehicle-context__actions">
            <details>
              <summary>Данные автомобиля</summary>
              <dl>
                <div><dt>VIN</dt><dd>{documentVin || "—"}</dd></div>
                <div><dt>Пробег</dt><dd>{attrMileage ? `${attrMileage} км` : "—"}</dd></div>
                <div><dt>Моторное масло</dt><dd>{attrOil || "—"}</dd></div>
                <div><dt>Источник</dt><dd>{decodedVehicle ? "Расшифровка VIN" : vehicleHasAnyManualData ? "Карточка отгрузки" : "—"}</dd></div>
              </dl>
            </details>
            <button type="button" onClick={() => {
              openVehicleEditor();
              window.setTimeout(() => document.getElementById("shipment-vehicle-card")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
            }}>
              <Pencil className="eco-icon" aria-hidden />
              Изменить
            </button>
          </div>
        </div>
      <div className="eco-shipment-composition-grid">
      <section id="shipment-positions-add" className="eco-shipment-new-add" aria-label="Поиск и подбор позиций">
        <h3 className="sr-only">Поиск и подбор позиций</h3>
        {(positionAddMode === "catalog" || positionAddMode === "mann") && (
          <>
        <div className="eco-shipment-fast-search">
          <div className={`eco-shipment-position-searchbar ${VIN_FILTER_PICKER_ENABLED ? "has-vin" : "has-service-only"}`}>
            <label className="eco-field eco-shipment-position-search-field">
              <span className="sr-only">Быстрый поиск</span>
              {productSearchLoading ? (
                <span className="eco-shipment-new-search-icon eco-search-spinner" aria-hidden />
              ) : (
                <Search className="eco-shipment-new-search-icon" aria-hidden />
              )}
	            <input
	              id="shipment-product-search"
	              type="text"
	              value={productSearch}
	              onChange={(e) => {
                    productResultsDismissedRef.current = false;
                    setProductSearch(e.target.value);
                    setShowOrderableProducts(false);
                    setShowUnavailableProducts(false);
                    setProductResultsOpen(Boolean(e.target.value.trim()) || productSearchMode === "service");
                    setHighlightedProductIndex(0);
                  }}
                  onFocus={() => {
                    if (hasProductSearchQuery) {
                      productResultsDismissedRef.current = false;
                      setProductResultsOpen(true);
                    }
                  }}
                  onKeyDown={handleProductSearchKeyDown}
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showProductResults}
                  aria-controls="shipment-product-results"
	              placeholder={
                  productSearchMode === "service"
                    ? "Название услуги"
                    : "Название, артикул или OEM"
                }
	              className="eco-input"
	            />
            </label>
            <button
              type="button"
              className={`eco-shipment-auto-toggle ${positionAddMode === "mann" ? "is-active" : ""}`}
              onClick={() => {
                const opening = positionAddMode !== "mann";
                setPositionAddMode(opening ? "mann" : "catalog");
                if (opening) {
                  setMannPickerExpanded(false);
                  setMannManualCue("idle");
                }
              }}
              aria-expanded={positionAddMode === "mann"}
              role="switch"
              aria-checked={positionAddMode === "mann"}
            >
                <span aria-hidden />
                Подбор по авто
            </button>
            <button type="button" className="eco-shipment-link-btn" onClick={openServiceSearch} title="Добавить услугу, которой нет в каталоге">
              <Plus className="eco-icon" aria-hidden />
              Добавить услугу
            </button>
            <button
              type="button"
              className={`eco-shipment-link-btn ${nonstockProductOpen ? "is-active" : ""}`}
              onClick={() => nonstockProductOpen ? closeNonstockProductForm() : openNonstockProductForm()}
              title="Добавить товар только в эту отгрузку без создания карточки в каталоге"
              aria-expanded={nonstockProductOpen}
              aria-controls="shipment-nonstock-product-form"
            >
              <Plus className="eco-icon" aria-hidden />
              Добавить разовый товар
            </button>
          </div>
          {nonstockProductOpen && (
            <section id="shipment-nonstock-product-form" className="eco-nonstock-product-form" aria-labelledby="shipment-nonstock-product-title">
              <header className="eco-nonstock-product-form__head">
                <div>
                  <h4 id="shipment-nonstock-product-title">
                    {nonstockProductEditingIndex == null ? "Добавить разовый товар" : "Редактировать разовый товар"}
                  </h4>
                  <p>Не добавляется в каталог и не изменяет складские остатки.</p>
                </div>
                {nonstockProductOptionsLoading ? <span role="status">Проверяем каталог…</span> : null}
              </header>

              <div className="eco-nonstock-product-form__grid">
                <label className="eco-field">
                  <span>Тип товара</span>
                  <input
                    id="shipment-nonstock-product-type"
                    list="shipment-nonstock-product-types"
                    value={nonstockDraftGroup?.label ?? nonstockProductDraft.groupCode}
                    onChange={(event) => {
                      const value = event.target.value;
                      const match = nonstockProductOptions.groups.find((item) => item.label === value || item.code === value);
                      setNonstockProductDraft((current) => ({ ...current, groupCode: match?.code ?? value }));
                    }}
                    className="eco-input"
                    placeholder="Начните вводить тип"
                    autoComplete="off"
                  />
                  <datalist id="shipment-nonstock-product-types">
                    {nonstockProductOptions.groups.map((group) => <option key={group.code} value={group.label} />)}
                  </datalist>
                </label>
                <label className="eco-field">
                  <span>Бренд</span>
                  <input
                    list="shipment-nonstock-product-brands"
                    value={nonstockProductDraft.brand}
                    onChange={(event) => setNonstockProductDraft((current) => ({ ...current, brand: event.target.value }))}
                    className="eco-input"
                    placeholder="Например, MANN-FILTER"
                    autoComplete="off"
                  />
                  <datalist id="shipment-nonstock-product-brands">
                    {nonstockProductOptions.brands.map((brand) => <option key={brand} value={brand} />)}
                  </datalist>
                </label>
                <label className="eco-field">
                  <span>Артикул{nonstockDraftGroup?.articleRequired ? " *" : ""}</span>
                  <input
                    value={nonstockProductDraft.article}
                    onChange={(event) => setNonstockProductDraft((current) => ({ ...current, article: event.target.value }))}
                    className="eco-input"
                    placeholder="Например, C 35 154"
                    autoComplete="off"
                  />
                </label>
                {nonstockDraftGroup?.code === "OTHER" ? (
                  <label className="eco-field">
                    <span>Уточнение</span>
                    <input
                      value={nonstockProductDraft.clarification}
                      onChange={(event) => setNonstockProductDraft((current) => ({ ...current, clarification: event.target.value }))}
                      className="eco-input"
                      placeholder="Что это за товар"
                    />
                  </label>
                ) : null}
                <label className="eco-field">
                  <span>Количество</span>
                  <QuantityInput
                    value={nonstockProductDraft.quantity}
                    onValueChange={(quantity) => setNonstockProductDraft((current) => ({ ...current, quantity }))}
                    className="eco-input"
                  />
                </label>
                <label className="eco-field">
                  <span>Единица</span>
                  <select
                    value={nonstockProductDraft.uomCode}
                    onChange={(event) => setNonstockProductDraft((current) => ({ ...current, uomCode: event.target.value }))}
                    className="eco-input"
                  >
                    {nonstockProductOptions.uoms.map((uom) => <option key={uom.code} value={uom.code}>{uom.label}</option>)}
                  </select>
                </label>
                <label className="eco-field">
                  <span>Купили за, ₽/{nonstockDraftUomLabel}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={nonstockProductDraft.explicitZeroCost ? "0" : nonstockProductDraft.purchasePrice}
                    onChange={(event) => setNonstockProductDraft((current) => ({ ...current, purchasePrice: event.target.value }))}
                    className="eco-input"
                    placeholder="Можно заполнить перед проведением"
                    disabled={nonstockProductDraft.explicitZeroCost}
                  />
                </label>
                <label className="eco-field">
                  <span>Цена клиенту, ₽/{nonstockDraftUomLabel}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={nonstockProductDraft.salePrice}
                    onChange={(event) => setNonstockProductDraft((current) => ({ ...current, salePrice: event.target.value }))}
                    className="eco-input"
                    placeholder="1400"
                  />
                </label>
                <label className="eco-field eco-nonstock-product-form__wide">
                  <span>Где купили <small>необязательно</small></span>
                  <input
                    list="shipment-nonstock-product-suppliers"
                    value={nonstockProductDraft.purchaseSourceLabel}
                    onChange={(event) => {
                      const value = event.target.value;
                      const supplier = nonstockProductOptions.suppliers.find((item) => item.name === value);
                      setNonstockProductDraft((current) => ({
                        ...current,
                        purchaseSourceId: supplier?.id ?? "",
                        purchaseSourceLabel: value,
                      }));
                    }}
                    className="eco-input"
                    placeholder="Поставщик или название магазина"
                    autoComplete="off"
                  />
                  <datalist id="shipment-nonstock-product-suppliers">
                    {nonstockProductOptions.suppliers.map((supplier) => <option key={supplier.id} value={supplier.name} />)}
                  </datalist>
                </label>
                <label className="eco-field eco-nonstock-product-form__wide">
                  <span>Комментарий <small>необязательно</small></span>
                  <input
                    value={nonstockProductDraft.comment}
                    onChange={(event) => setNonstockProductDraft((current) => ({ ...current, comment: event.target.value }))}
                    className="eco-input"
                    placeholder="Внутренний комментарий к покупке"
                  />
                </label>
              </div>

              <label className="eco-nonstock-product-zero-cost">
                <input
                  type="checkbox"
                  checked={nonstockProductDraft.explicitZeroCost}
                  onChange={(event) => setNonstockProductDraft((current) => ({
                    ...current,
                    explicitZeroCost: event.target.checked,
                    purchasePrice: event.target.checked ? "" : current.purchasePrice,
                  }))}
                />
                <span><strong>Получено бесплатно</strong><small>Подтверждает фактическую нулевую себестоимость</small></span>
              </label>

              {nonstockProductOptions.exactMatch ? (
                <div className="eco-nonstock-product-match" role="status">
                  <div>
                    <strong>Такой товар уже есть в каталоге</strong>
                    <span>{nonstockProductOptions.exactMatch.name}</span>
                    <small>
                      Остаток: {nonstockProductOptions.exactMatch.availableQuantity ?? 0}
                      {nonstockProductOptions.exactMatch.slotName ? ` · Ячейка: ${nonstockProductOptions.exactMatch.slotName}` : ""}
                    </small>
                  </div>
                  <EcoButton type="button" onClick={useExactCatalogProduct}>Добавить товар из каталога</EcoButton>
                  <p>Разовую внешнюю покупку всё равно можно оформить ниже — складской остаток существующей карточки изменён не будет.</p>
                </div>
              ) : null}

              <div className="eco-nonstock-product-preview" aria-live="polite">
                <div>
                  <span>В отгрузке будет отображаться:</span>
                  <strong>{nonstockDraftPreview || "Заполните тип, бренд и артикул"}</strong>
                </div>
                <dl>
                  <div><dt>Количество</dt><dd>{formatQuantityInput(nonstockProductDraft.quantity)} {nonstockDraftUomLabel}</dd></div>
                  <div><dt>Закупка</dt><dd>{nonstockDraftPurchasePrice == null ? "Не указана" : `${formatShipmentMoney(nonstockDraftPurchasePrice)} / ${nonstockDraftUomLabel}`}</dd></div>
                  <div><dt>Продажа</dt><dd>{`${formatShipmentMoney(nonstockDraftSalePrice)} / ${nonstockDraftUomLabel}`}</dd></div>
                  <div><dt>Выручка</dt><dd>{formatShipmentMoney(nonstockDraftRevenue)}</dd></div>
                  <div><dt>Себестоимость</dt><dd>{nonstockDraftCost == null ? "Не указана" : formatShipmentMoney(nonstockDraftCost)}</dd></div>
                  <div><dt>Валовая прибыль</dt><dd>{nonstockDraftProfit == null ? "Не рассчитана" : formatShipmentMoney(nonstockDraftProfit)}</dd></div>
                  <div><dt>Маржа</dt><dd>{nonstockDraftMargin == null ? "—" : `${nonstockDraftMargin.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</dd></div>
                </dl>
              </div>

              {nonstockProductError ? <p className="eco-nonstock-product-error" role="alert">{nonstockProductError}</p> : null}
              <div className="eco-nonstock-product-actions">
                <EcoButton type="button" variant="primary" onClick={saveNonstockProductPosition}>
                  {nonstockProductEditingIndex != null
                    ? "Сохранить изменения"
                    : nonstockProductOptions.exactMatch
                      ? "Оформить как разовую внешнюю покупку"
                      : "Добавить разовый товар"}
                </EcoButton>
                <EcoButton type="button" onClick={closeNonstockProductForm}>Отмена</EcoButton>
              </div>
            </section>
          )}
          {oneOffServiceOpen && (
            <div className="eco-one-off-service-form">
              <label className="eco-field">
                <span>Название услуги</span>
                <input
                  id="shipment-one-off-service-name"
                  type="text"
                  value={oneOffServiceName}
                  onChange={(event) => setOneOffServiceName(event.target.value)}
                  className="eco-input"
                  placeholder="Например: Замена моторного масла"
                />
              </label>
              <label className="eco-field">
                <span>Категория аналитики</span>
                <select
                  value={oneOffServiceMetricCode}
                  onChange={(event) => setOneOffServiceMetricCode(event.target.value)}
                  className="eco-input"
                >
                  <option value="">Выберите операцию</option>
                  {ONE_OFF_SERVICE_METRICS.map((metric) => (
                    <option key={metric.code} value={metric.code}>{metric.label}</option>
                  ))}
                </select>
              </label>
              {oneOffServiceMetricCode === "TRANSMISSION_FLUID_SERVICE" ? (
                <div className="eco-one-off-service-classification">
                  <label className="eco-field">
                    <span>Агрегат</span>
                    <select className="eco-input" value={oneOffServiceAggregateType} onChange={(event) => setOneOffServiceAggregateType(event.target.value)}>
                      {ONE_OFF_SERVICE_AGGREGATES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="eco-field">
                    <span>Способ замены</span>
                    <select className="eco-input" value={oneOffServiceProcedure} onChange={(event) => setOneOffServiceProcedure(event.target.value)}>
                      {ONE_OFF_SERVICE_PROCEDURES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className="eco-field">
                    <span>Конфигурация</span>
                    <select className="eco-input" value={oneOffServiceConfiguration} onChange={(event) => setOneOffServiceConfiguration(event.target.value)}>
                      {ONE_OFF_SERVICE_CONFIGURATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                </div>
              ) : null}
              <label className="eco-field">
                <span>Цена</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={oneOffServicePrice}
                  onChange={(event) => setOneOffServicePrice(event.target.value)}
                  className="eco-input"
                  placeholder="1490"
                />
              </label>
              <label className="eco-field">
                <span>Комментарий</span>
                <input
                  type="text"
                  value={oneOffServiceComment}
                  onChange={(event) => setOneOffServiceComment(event.target.value)}
                  className="eco-input"
                  placeholder="Необязательно"
                />
              </label>
              <div className="eco-one-off-service-actions">
                <EcoButton type="button" variant="primary" onClick={addOneOffServicePosition}>
                  Добавить услугу
                </EcoButton>
                <EcoButton
                  type="button"
                  onClick={() => {
                    setOneOffServiceOpen(false);
                    setOneOffServiceName("");
                    setOneOffServicePrice("");
                    setOneOffServiceComment("");
                    setOneOffServiceMetricCode("");
                    setOneOffServiceAggregateType("UNKNOWN");
                    setOneOffServiceProcedure("UNKNOWN");
                    setOneOffServiceConfiguration("UNKNOWN");
                  }}
                >
                  Отмена
                </EcoButton>
              </div>
            </div>
          )}
          {manualMannFilter ? (
            <div className="eco-shipment-mann-search-context">
              <span>Ручной выбор для MANN {manualMannFilter.mannArticle}</span>
              <button type="button" onClick={() => setManualMannFilter(null)}>
                Сбросить
              </button>
            </div>
          ) : null}
          <details className="eco-shipment-advanced-search">
            <summary>Расширенный поиск</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <div>
              <label className="eco-field">
                <span>Тип позиции</span>
                <select
                  value={productSearchMode}
                  onChange={(event) => {
                    setProductSearchMode(event.target.value as ProductSearchMode);
                    setShowOrderableProducts(false);
                    setShowUnavailableProducts(false);
                    productResultsDismissedRef.current = false;
                    setProductResultsOpen(true);
                    setHighlightedProductIndex(0);
                  }}
                  className="eco-input"
                >
                  <option value="all">Все</option>
                  <option value="product">Товары</option>
                  <option value="service">Услуги</option>
                </select>
              </label>
            </div>
            <div>
              <label className="eco-field">
                <span>OEM Parts / кросс-номера / аналоги</span>
              <input
                type="text"
                value={productOem}
                onChange={(e) => {
                  productResultsDismissedRef.current = false;
                  setProductOem(e.target.value);
                  setShowOrderableProducts(false);
                  setShowUnavailableProducts(false);
                  setProductResultsOpen(true);
                  setHighlightedProductIndex(0);
                }}
                placeholder="OEM, MANN/POMAN, аналоги"
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
                onChange={(e) => {
                  productResultsDismissedRef.current = false;
                  setProductParams(e.target.value);
                  setShowOrderableProducts(false);
                  setShowUnavailableProducts(false);
                  setProductResultsOpen(true);
                  setHighlightedProductIndex(0);
                }}
                placeholder="Фильтр по параметрам"
                className="eco-input"
              />
              </label>
            </div>
          </div>
          </details>
          {productAddNotice && <div className="eco-shipment-add-notice" role="status">{productAddNotice}</div>}
        </div>
        {showProductResults && (
            <div id="shipment-product-results" className="eco-product-results" aria-live="polite" onMouseDown={(event) => event.preventDefault()}>
              {!productSearchLoading && !productSearchError && productOptions.length > 0 && (
                <div className="eco-product-results-head border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-600">
	                  <span>{productSearchEntityLabel}</span>
                  <span>На точке</span>
                  <span>Ячейка</span>
                  <span>К добавлению</span>
                  <span>Цена</span>
                  <span>Действие</span>
                </div>
              )}
              {!productSearchLoading && !productSearchError && productOptions.length > 0 && productSearchMode !== "service" ? (
                <div className="eco-product-availability-filter" aria-label="Наличие товаров">
                  <span>В наличии на выбранной точке · {availableProductOptions.filter((product) => !isServiceMeta(product.meta) && !productOptionIsAdded(product)).length}</span>
                  {orderableProductOptions.length > 0 ? (
                    <button type="button" aria-expanded={showOrderableProducts} onClick={() => {
                      setShowOrderableProducts((current) => !current);
                      setHighlightedProductIndex(0);
                    }}>
                      Под заказ · {orderableProductOptions.length}
                    </button>
                  ) : null}
                  {unavailableProductOptions.length > 0 ? (
                    <button type="button" className="is-muted" aria-expanded={showUnavailableProducts} onClick={() => {
                      setShowUnavailableProducts((current) => !current);
                      setHighlightedProductIndex(0);
                    }}>
                      Без остатка · {unavailableProductOptions.length}
                    </button>
                  ) : null}
                </div>
              ) : null}
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
                  <span>{productSearchError}</span>
                  <div className="eco-product-results-actions">
                    <button
                      type="button"
                      onClick={() => {
                        productResultsDismissedRef.current = false;
                        setProductSearchRetrySeed((value) => value + 1);
                      }}
                    >
                      Повторить поиск
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        productResultsDismissedRef.current = true;
                        setProductResultsOpen(false);
                      }}
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              ) : visibleProductOptions.length > 0 ? (
              <ul className="eco-product-results-list">
              {visibleProductOptions.map((p, index) => {
                const isService = isServiceMeta(p.meta);
                const stockQuantity = p.stockQuantity ?? 0;
                const reserveQuantity = p.reserveQuantity ?? 0;
                const slot = p.cell ?? p.slotName;
                const availabilityTone = productSearchAvailabilityClass(p, isService);
                const unavailable = !isService && (p.availableQuantity ?? p.stockQuantity ?? 0) <= 0;
                const orderable = unavailable && (p.orderable === true || Boolean(p.supplierName));
                const addedPositionIndex = positions.findIndex((position) => position.assortmentMeta?.href === p.meta.href);
                const addedPosition = addedPositionIndex >= 0 ? positions[addedPositionIndex] : null;
                return (
                <li key={p.id}>
                  <div
                    className={`eco-product-result-row px-3 py-2 text-sm ${availabilityTone} ${highlightedProductIndex === index ? "is-highlighted" : ""}`}
                    onMouseEnter={() => setHighlightedProductIndex(index)}
                    onDoubleClick={() => addProductFromSearch(p, productAddQuantities[p.id] ?? 1)}
                  >
                    <span className="min-w-0 flex-1">
                      <Link href={productCatalogHref(p)} className="eco-product-result-title" title={isService ? "Открыть услугу" : "Открыть товар"}>
                        <span className="truncate">{p.name}</span>
                        <ExternalLink className="eco-icon" aria-hidden />
                      </Link>
                      <span className="block truncate text-xs text-zinc-500">
                        {isService ? "локальная услуга" : `Артикул: ${p.article || "не указан"}`}
                      </span>
                      {p.matchSummary ? (
                        <span className="block truncate text-xs text-zinc-500">{p.matchSummary}</span>
                      ) : null}
                    </span>
                    <span className={`eco-product-result-stock ${availabilityTone}`}>
                      <strong>{formatProductSearchAvailability(p, isService)}</strong>
                      {!isService && <em>Остаток: {formatQuantityInput(stockQuantity)} · резерв: {formatQuantityInput(reserveQuantity)}</em>}
                    </span>
                    <span className="shrink-0 w-12 text-right text-zinc-500 tabular-nums">
                      {isService ? "—" : slot ? String(slot) : "не указана"}
                    </span>
                    <label className="eco-product-result-quantity">
                      <span className="sr-only">Количество к добавлению</span>
                      <QuantityInput
                        value={productAddQuantities[p.id] ?? 1}
                        onValueChange={(quantity) => setProductAddQuantities((current) => ({ ...current, [p.id]: quantity }))}
                        className="eco-product-result-quantity-input"
                      />
                    </label>
                    <span className="shrink-0 text-zinc-500">{formatShipmentMoney(p.price)}</span>
                    {addedPosition ? (
                      <div className="eco-product-result-added" role="status" aria-label={`${p.name} добавлен в отгрузку`}>
                        <span>✓ Добавлено</span>
                        <div aria-label="Количество в отгрузке">
                          <button
                            type="button"
                            onClick={() => changePositionQuantity(addedPositionIndex, -1)}
                            disabled={(addedPosition.quantity || 1) <= 1}
                            aria-label="Уменьшить количество"
                          >−</button>
                          <b>{formatQuantityInput(addedPosition.quantity || 1)}</b>
                          <button
                            type="button"
                            onClick={() => changePositionQuantity(addedPositionIndex, 1)}
                            aria-label="Увеличить количество"
                          >+</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addProductFromSearch(p, productAddQuantities[p.id] ?? 1)}
                        className="eco-product-result-add"
                        title={orderable ? "Добавить в отгрузку под заказ" : unavailable ? "Нет доступного остатка, проверьте наличие перед добавлением" : "Добавить в отгрузку"}
                      >
                        {orderable ? "Под заказ" : "Добавить"}
                      </button>
                    )}
                  </div>
                </li>
                );
              })}
              </ul>
              ) : productOptions.length > 0 ? (
                <div className="eco-product-results-state">
                  <strong>На выбранной точке нет доступных товаров</strong>
                  <span>Откройте варианты под заказ или измените запрос.</span>
                </div>
              ) : (
                <div className="eco-product-results-state">
                  <strong>Ничего не найдено</strong>
                  <span>{productSearchEmptyHint}</span>
                  <div className="eco-product-results-actions">
                    {manualMannFilter ? (
                      <button
                        type="button"
                        onClick={() => {
                          setManualMannFilter(null);
                          setProductOptions([]);
                          setProductResultsOpen(false);
                        }}
                      >
                        Сбросить ручной выбор
                      </button>
                    ) : (
                      <>
                        <button type="button" onClick={openServiceSearch}>
                          Создать услугу
                        </button>
                        <Link href="/inventory/products?type=product">Создать товар</Link>
                        <button type="button" onClick={openAdvancedProductSearch}>
                          Расширенный поиск
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
        )}
          </>
        )}
        {positionAddMode === "mann" && (
          <div className="eco-shipment-position-mann-panel">
            <div className="eco-shipment-mann-panel-body">

            <VehicleLookupPanel
              organizationId={selectedOrg?.id}
              warehouseId={selectedStore?.id}
              initialVin={vin}
              onUseVehicle={applyIdentifiedVehicle}
              onConfirmMannCandidate={confirmMannCandidate}
              onConfirmTransmission={confirmVehicleTransmission}
              onLookupStart={resetMannVehicleSelection}
              onManualMode={openMannManualPicker}
            />

            {mannPickerExpanded ? (
              <section className={`eco-shipment-mann-manual ${mannManualCue !== "idle" ? "is-guided" : ""}`} id="shipment-mann-manual">
                <div className="eco-shipment-mann-manual-head">
                  <div>
                    <strong>Выберите автомобиль вручную</strong>
                    <span>Марка, модель и модификация обязательны. Год можно не указывать.</span>
                  </div>
                </div>
                <div className="eco-shipment-mann-controls" id="shipment-mann-manual-controls">
                  <MannCombobox
                    inputId="shipment-mann-make-combobox"
                    label="Марка"
                    placeholder="Выберите марку"
                    value={selectedMannMake}
                    query={mannMakeQuery}
                    options={mannMakeOptions}
                    loading={mannLoading === "makes"}
                    onSelect={(value) => {
                      setMannManualCue("idle");
                      setSelectedMannMake(value);
                      setMannMakeQuery(mannMakeOptions.find((option) => option.value === value)?.label ?? value);
                    }}
                    onQueryChange={setMannMakeQuery}
                    onClear={() => {
                      mannAutoSelectionRef.current = null;
                      setSelectedMannMake("");
                      setMannModelQuery("");
                      setMannVariantQuery("");
                    }}
                  />
                  <MannCombobox
                    inputId="shipment-mann-model-combobox"
                    label="Модель"
                    placeholder={selectedMannMake ? "Выберите модель" : "Выберите сначала марку"}
                    value={selectedMannModel}
                    query={mannModelQuery}
                    options={mannModelOptions}
                    loading={mannLoading === "models"}
                    disabled={!selectedMannMake}
                    onSelect={(value) => {
                      mannAutoSelectionRef.current = null;
                      setSelectedMannModel(value);
                      setMannModelQuery(mannModelOptions.find((option) => option.value === value)?.label ?? value);
                    }}
                    onQueryChange={setMannModelQuery}
                    onClear={() => {
                      mannAutoSelectionRef.current = null;
                      setSelectedMannModel("");
                      setMannVariantQuery("");
                    }}
                  />
                  <label className="eco-field eco-shipment-mann-year">
                    <span>Год</span>
                    <input
                      className="eco-input"
                      type="text"
                      inputMode="numeric"
                      value={mannYear}
                      maxLength={4}
                      aria-invalid={mannYear.length > 0 && !isValidMannYear(mannYear)}
                      onChange={(event) => setMannYear(normalizeMannYearInput(event.target.value))}
                      placeholder={attrYear || "необязательно"}
                      autoComplete="off"
                    />
                  </label>
                  <MannCombobox
                    inputId="shipment-mann-variant-combobox"
                    label="Модификация / двигатель"
                    placeholder={selectedMannModel ? "Объём, код, мощность..." : "Выберите сначала модель"}
                    value={selectedMannVariantId}
                    query={mannVariantQuery}
                    options={mannVariantOptions}
                    loading={mannLoading === "variants"}
                    disabled={!selectedMannModel}
                    onSelect={(value) => {
                      setSelectedMannVariantId(value);
                      setMannVariantQuery(mannVariantOptions.find((option) => option.value === value)?.label ?? value);
                    }}
                    onQueryChange={setMannVariantQuery}
                    onClear={() => setSelectedMannVariantId("")}
                  />
                  <div className="eco-shipment-mann-submit">
                    <button type="button" className="eco-btn eco-btn--primary" disabled={!mannManualReady} onClick={handleMannManualSubmit}>
                      Подобрать фильтры
                    </button>
                    <span>{mannManualReady ? "Готово к подбору." : "Заполните обязательные поля."}</span>
                  </div>
                </div>
              </section>
            ) : null}

            {mannError && <p className="eco-vin-alert">{mannError}</p>}
            {mannLoading && mannLoading !== "makes" && (
              <div className="eco-product-results-state">
                <div className="eco-product-loading-copy">
                  <span className="eco-product-loading-spinner" aria-hidden />
                  <div>
                    <strong>Загружаем MANN-подбор...</strong>
                    <span>Берём применяемость из SQL и сверяем с локальным каталогом.</span>
                  </div>
                </div>
              </div>
            )}

            {selectedMannVariant && mannPickerExpanded && (
              <div className="eco-shipment-mann-variant-summary">
                <strong>{describeMannVariant(selectedMannVariant)}</strong>
                {selectedMannVariant.condition ? <span>Условие из каталога MANN: {selectedMannVariant.condition}</span> : null}
              </div>
            )}

            {mannSortedFilters.length > 0 ? (
              <div className="eco-shipment-mann-filter-list">
                <div className="eco-shipment-mann-results-head">
                  <div>
                    <strong>Товары по выбранному автомобилю</strong>
                    <span>{mannVehicleModificationLabel || "Товары из локального каталога и склада"}</span>
                  </div>
                  <span>{formatMannCategoryCount(mannSortedFilters.length)}</span>
                </div>
                {mannSortedFilters.map((filter) => {
                  const match = mannMatches[filter.mannArticleNormalized];
                  const status = match?.status ?? "not_found";
                  const compatibleProducts = match?.compatibleProducts ?? match?.localMatches ?? [];
                  const availableProducts = compatibleProducts.filter((product) => product.available > 0);
                  const addedOutOfStockProducts = compatibleProducts.filter((product) =>
                    product.available <= 0 && positions.some((position) => position.assortmentMeta?.href === `local://product/${product.id}`)
                  );
                  const orderableProducts = compatibleProducts.filter((product) =>
                    product.available <= 0
                    && product.orderable
                    && !positions.some((position) => position.assortmentMeta?.href === `local://product/${product.id}`)
                  );
                  const unavailableProducts = compatibleProducts.filter((product) =>
                    product.available <= 0
                    && !product.orderable
                    && !positions.some((position) => position.assortmentMeta?.href === `local://product/${product.id}`)
                  );
                  const categoryLabel = getMannFilterTypeLabel(filter.filterType);
                  const filterMeta = [
                    filter.engineCode,
                    filter.vehicleYears,
                    filter.kw ? `${filter.kw} kW` : "",
                    filter.hp ? `${filter.hp} hp` : "",
                  ].filter(Boolean).join(" · ");
                  const filterApplicability = mannVehicleModificationLabel || (filter.vehicleText === "All models"
                    ? "Для всех двигателей этой модели"
                    : filterMeta);
                  const categoryAvailability = [
                    availableProducts.length > 0 ? `${formatMannVariantCount(availableProducts.length)} в наличии` : "",
                    orderableProducts.length > 0 ? `${formatMannVariantCount(orderableProducts.length)} под заказ` : "",
                    unavailableProducts.length > 0 && availableProducts.length === 0 && orderableProducts.length === 0 ? "Нет вариантов в наличии" : "",
                  ].filter(Boolean).join(" · ") || "Товар в базе не найден";
                  const renderProductGroup = (label: string, products: MannLocalMatch[]) => products.length > 0 ? (
                    <section className="eco-shipment-mann-product-group" aria-label={`${label}: MANN ${filter.mannArticle}`}>
                      <h4>{label} <span>{products.length}</span></h4>
                      <div className="eco-shipment-mann-choice-list">
                        {products.map((local) => {
                          const localMeta = [local.article ? `арт. ${local.article}` : "", local.code ? `код ${local.code}` : "", local.brand].filter(Boolean).join(" · ");
                          const compatibilityBasis = local.matchType === "EXACT_PRODUCT_BRAND_ARTICLE"
                            ? "точное совпадение бренда и артикула"
                            : local.matchType === "OEM_EXACT_BRAND_ARTICLE"
                              ? "бренд и артикул в OEM"
                              : local.matchType === "OEM_EXACT_ARTICLE"
                                ? "точный артикул в OEM"
                                : local.matchType === "OEM_SAFE_COMPACT"
                                  ? "безопасное OEM-совпадение"
                                  : "подтверждённая связь с MANN";
                          const addedPositionIndex = positions.findIndex((position) => position.assortmentMeta?.href === `local://product/${local.id}`);
                          const addedPosition = addedPositionIndex >= 0 ? positions[addedPositionIndex] : null;
                          const isRecommended = match?.bestMatch?.id === local.id;
                          const isAvailable = local.available > 0;
                          const availabilityLabel = isAvailable
                            ? `${formatQuantityInput(local.available)} шт.`
                            : local.orderable ? "Под заказ" : "Недоступно";
                          const stockLabel = isAvailable && local.reserve
                            ? `Остаток ${formatQuantityInput(local.stock)} · резерв ${formatQuantityInput(local.reserve)}`
                            : isAvailable ? `Остаток ${formatQuantityInput(local.stock)}` : "";
                          return (
                            <div key={local.id} className={`eco-shipment-mann-choice-option ${isRecommended ? "is-recommended" : ""}`}>
                              <div className="eco-shipment-mann-sku-copy">
                                <div className="eco-shipment-mann-sku-title">
                                  <strong title={local.name}>{local.name}</strong>
                                  {isRecommended ? <span>Рекомендуем</span> : null}
                                </div>
                                {localMeta ? <small>{localMeta}</small> : null}
                                <small className="eco-shipment-mann-compatibility">Совместимость подтверждена: {compatibilityBasis}</small>
                              </div>
                              <div className={`eco-shipment-mann-sku-availability ${isAvailable ? "is-available" : local.orderable ? "is-order" : "is-unavailable"}`}>
                                <strong>{availabilityLabel}</strong>
                                {stockLabel ? <span>{stockLabel}</span> : null}
                              </div>
                              <span className="eco-shipment-mann-sku-cell">{local.cell || "—"}</span>
                              <label className="eco-product-result-quantity">
                                <span className="sr-only">Количество к добавлению</span>
                                <QuantityInput
                                  value={productAddQuantities[`mann-${local.id}`] ?? 1}
                                  onValueChange={(quantity) => setProductAddQuantities((current) => ({ ...current, [`mann-${local.id}`]: quantity }))}
                                  className="eco-product-result-quantity-input"
                                />
                              </label>
                              <strong className="eco-shipment-mann-sku-price">{formatShipmentMoney(local.price)}</strong>
                              {addedPosition ? (
                                <div className="eco-shipment-mann-added" role="status" aria-label={`${local.name} добавлен в отгрузку`}>
                                  <span>✓ Добавлено</span>
                                  <div aria-label="Количество в отгрузке">
                                    <button
                                      type="button"
                                      onClick={() => changePositionQuantity(addedPositionIndex, -1)}
                                      disabled={(addedPosition.quantity || 1) <= 1}
                                      aria-label="Уменьшить количество"
                                    >−</button>
                                    <b>{formatQuantityInput(addedPosition.quantity || 1)}</b>
                                    <button
                                      type="button"
                                      onClick={() => changePositionQuantity(addedPositionIndex, 1)}
                                      aria-label="Увеличить количество"
                                    >+</button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className={`eco-shipment-mann-add ${isAvailable ? "is-primary" : local.orderable ? "is-order" : "is-unavailable"}`}
                                  onClick={() => addMannMatchesToPositions([{ filter, match: local, quantity: productAddQuantities[`mann-${local.id}`] ?? 1 }])}
                                  disabled={!isAvailable && !local.orderable}
                                >
                                  {isAvailable ? "Добавить" : local.orderable ? "Добавить под заказ" : "Недоступно"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null;
                  return (
                    <div
                      key={`${filter.filterType}-${filter.filterSubtype ?? ""}-${filter.mannArticleNormalized}`}
                      className="eco-shipment-mann-filter-shell"
                    >
                      <article
                        className={`eco-shipment-mann-filter is-${status}`}
                      >
                        <MannFilterTypeIcon type={filter.filterType} />
                        <div className="eco-shipment-mann-filter-main">
                          <div>
                            <strong>{categoryLabel}</strong>
                            <span>MANN {filter.mannArticle}</span>
                          </div>
                        </div>
                        <div className="eco-shipment-mann-local">
                          <b>Каталог MANN</b>
                          <span>{categoryAvailability}</span>
                        </div>
                        <div className="eco-shipment-mann-actions">
                          <details className="eco-shipment-mann-more">
                            <summary aria-label={`Дополнительные действия: ${categoryLabel}`} title="Дополнительные действия">⋯</summary>
                            <div>
                              <div className="eco-shipment-mann-more-copy">
                                <strong>Техническая информация</strong>
                                {filterApplicability ? <span>{filterApplicability}</span> : null}
                                {filter.condition ? <span>Условие MANN: {filter.condition}</span> : null}
                                {filter.filterSubtype || filter.filterNote ? <span>{[filter.filterSubtype ? `Тип ${filter.filterSubtype}` : "", filter.filterNote].filter(Boolean).join(" · ")}</span> : null}
                                {match ? <span>Совместимость подтверждена по {formatMannMatchCount(match.diagnostics.compatibleCount)}.</span> : null}
                              </div>
                              <Link href={mannCreateProductHref(filter)} target="_blank" rel="noreferrer">
                                Создать товар
                              </Link>
                              <Link href={mannRestockHref(filter)} target="_blank" rel="noreferrer">
                                В закупку
                              </Link>
                              <Link href={mannRosskoHref(filter)} target="_blank" rel="noreferrer">
                                ROSSKO
                              </Link>
                              <button type="button" onClick={() => startMannManualSearch(filter)}>
                                Найти другой товар
                              </button>
                              {match ? (
                                <div className="eco-shipment-mann-more-copy">
                                  <strong>Диагностика сопоставления</strong>
                                  <span>Канонический артикул: {match.diagnostics.canonicalArticle}</span>
                                  <span>Кандидатов: {match.diagnostics.candidateCount} · совместимых: {match.diagnostics.compatibleCount}</span>
                                  <span>Поиск: {match.diagnostics.totalMs.toFixed(1)} мс</span>
                                  {match.diagnostics.compactCollisionBlocked ? <span>Компактное сравнение заблокировано защитой от коллизий.</span> : null}
                                </div>
                              ) : null}
                            </div>
                          </details>
                        </div>
                      </article>
                      <div className="eco-shipment-mann-choice-panel" role="region" aria-label={`Подходящие товары для MANN ${filter.mannArticle}`}>
                        {renderProductGroup("В наличии", availableProducts)}
                        {renderProductGroup("В отгрузке", addedOutOfStockProducts)}
                        {orderableProducts.length > 0 ? (
                          <details className="eco-shipment-mann-collapsible-group">
                            <summary>Под заказ · {orderableProducts.length}</summary>
                            {renderProductGroup("Под заказ", orderableProducts)}
                          </details>
                        ) : null}
                        {unavailableProducts.length > 0 ? (
                          <details className="eco-shipment-mann-collapsible-group is-muted">
                            <summary>Без остатка · {unavailableProducts.length}</summary>
                            {renderProductGroup("Нет на складе", unavailableProducts)}
                          </details>
                        ) : null}
                        {compatibleProducts.length === 0 ? (
                          <div className="eco-shipment-mann-choice-empty">
                            <strong>Подходящий товар ещё не связан с каталогом</strong>
                            <span>Можно найти существующий товар вручную или создать новую карточку через меню ⋯.</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : selectedMannVariantId && !mannLoading ? (
              <div className="eco-shipment-vin-empty">
                <strong>Фильтры MANN для выбранной модификации не найдены</strong>
                <span>Попробуйте выбрать модификацию без фильтра по году или проверить другую модель.</span>
              </div>
            ) : null}
            </div>
          </div>
        )}
        {VIN_FILTER_PICKER_ENABLED && positionAddMode === "mann" && (
          <details className="eco-shipment-direct-vin">
            <summary>Расширенный подбор по VIN</summary>
            <div className="eco-shipment-position-vin-panel">
            <div className="eco-shipment-position-vin-copy">
              <strong>Подбор показывает подходящие товары из локального каталога и склада.</strong>
              <span>VIN можно взять из карточки автомобиля или ввести только для текущего подбора.</span>
            </div>
            <div className="eco-shipment-position-vin-controls">
              <label className="eco-field">
                <span>VIN</span>
                <input
                  type="text"
                  maxLength={17}
                  value={vin}
                  onChange={(e) => {
                    const v = formatVehicleAttributeInput("vin", e.target.value);
                    setVin(v);
                    setManualEngineVolume("");
                    setManualEnginePower("");
                    setShowVehicleOverrideDialog(false);
                    const vinControl = vehicleAttributeControls.find((control) => control.key === "vin");
                    if (vinControl?.attrIndex != null && vinControl.attrIndex >= 0) {
                      const next = [...attributes];
                      const current = next[vinControl.attrIndex];
                      if (current) next[vinControl.attrIndex] = { ...current, value: v };
                      setAttributes(next);
                    }
                    markDraftDirty();
                  }}
                  className="eco-input eco-shipment-new-vin-input"
                  placeholder="Например: WBAXXXXX5JZ123456"
                />
              </label>
              <div className="eco-shipment-position-vin-actions">
                <button
                  type="button"
                  disabled={vin.replace(/\s/g, "").length < 8 || vinLookupLoading}
                  onClick={() => runVinLookup()}
                  className="eco-btn eco-btn--primary"
                >
                  <Sparkles className="eco-icon" aria-hidden />
                  {vinLookupLoading ? "Подбор..." : "Подобрать по VIN"}
                </button>
                <button type="button" className="eco-shipment-link-btn" onClick={openVehicleEditor}>
                  Изменить VIN автомобиля
                </button>
              </div>
            </div>
            {submitError && <p className="eco-shipment-new-error">{submitError}</p>}
            {vinLookupLoading && (
              <div className="eco-product-results-state">
                <div className="eco-product-loading-copy">
                  <span className="eco-product-loading-spinner" aria-hidden />
                  <div>
                    <strong>Подбираем позиции по VIN...</strong>
                    <span>Проверяем локальный каталог и остатки выбранного склада.</span>
                  </div>
                </div>
              </div>
            )}
            {vinLookupResult && !vinLookupLoading && (
              <div className="eco-shipment-vin-result">
                {vinLookupResult.decodeError && <p className="eco-vin-alert">{vinLookupResult.decodeError}</p>}
                {vinLookupResult.openaiError && <p className="eco-vin-alert">{vinLookupResult.openaiError}</p>}
                {vinLookupResult.decoded && (
                  <p className="eco-shipment-vin-decoded">
                    {[vinLookupResult.decoded.make, vinLookupResult.decoded.model, vinLookupResult.decoded.modelYear].filter(Boolean).join(", ")}
                    {vinLookupResult.decoded.modification ? ` · ${vinLookupResult.decoded.modification}` : ""}
                    {vinLookupResult.decoded.engineSeries ? ` · ${vinLookupResult.decoded.engineSeries}` : ""}
                    {vinLookupResult.decoded.displacementL ? ` · ${vinLookupResult.decoded.displacementL} л` : ""}
                  </p>
                )}
                {vinLookupResult.legacyItems.length > 0 ? (
                  <div className="eco-shipment-vin-offer-list">
                    {vinLookupResult.legacyItems.map((item, idx) => (
                      <div key={item.productId ?? `${item.name}-${idx}`} className="eco-shipment-vin-offer-row">
                        <span className="eco-shipment-vin-kind">{getVinLookupItemTypeLabel(item)}</span>
                        <div>
                          <strong>{item.name}</strong>
                          <span>{item.article || item.productId || "локальная позиция"}</span>
                        </div>
                        <span>{item.cell || "ячейка не указана"}</span>
                        <b>Остаток {item.quantity}</b>
                        <b>Доступно {item.quantity}</b>
                        <em>{formatShipmentMoney(item.price)}</em>
                        <button
                          type="button"
                          disabled={item.quantity <= 0}
                          onClick={() => addFromVinLookup([item])}
                        >
                          Добавить
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="eco-shipment-vin-empty">
                    <strong>В локальном каталоге подходящих позиций не найдено</strong>
                    <div>
                      <button type="button" onClick={() => setPositionAddMode("catalog")}>Перейти к обычному поиску</button>
                      <Link href="/inventory/products">Создать новый товар</Link>
                      <button type="button" onClick={() => setPositionAddMode("catalog")}>Открыть расширенный поиск</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </details>
        )}
      </section>

      <div className="eco-shipment-composition-rail">

      {positions.length === 0 && (
        <section id="shipment-position-list" className="eco-card eco-card--padded eco-shipment-new-positions" aria-live="polite">
          <div className="eco-card__head">
            <div className="eco-position-title-stack">
              <div className="eco-position-title-row">
                <h2>Текущая отгрузка</h2>
              </div>
            </div>
            <div className="eco-shipment-position-summary">
              <span className="eco-shipment-position-state is-empty">Пусто</span>
              <span>0 поз. · 0 ед.</span>
              <strong>{formatShipmentMoney(0)}</strong>
            </div>
          </div>
          <div className="eco-shipment-empty-state">
            <span>Добавьте товар или услугу — позиции появятся здесь.</span>
          </div>
        </section>
      )}

      {positions.length > 0 && (
        <section id="shipment-position-list" className="eco-card eco-shipment-new-positions" aria-live="polite">
          <div className="eco-card__head">
            <div className="eco-position-title-stack">
              <div className="eco-position-title-row">
                <h2>Текущая отгрузка</h2>
              </div>
            </div>
            <div className="eco-shipment-position-summary">
              <span className={`eco-shipment-position-state ${overAvailablePositionsCount > 0 ? "is-warning" : "is-ready"}`}>
                {overAvailablePositionsCount > 0 ? "Проверить остаток" : "Готово"}
              </span>
              <span>{positions.length} поз. · {positionsQty} ед.</span>
              <strong>{formatShipmentMoney(positionsTotal)}</strong>
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
	              const isNonstock = isNonstockProduct(p);
	              const productHref = positionProductHref(p);
	              const stock = getPositionStock(p);
	              const available = isService || isNonstock ? undefined : stock?.available;
	              const overAvailable = typeof available === "number" && (p.quantity || 0) > available;
	              const lineTotal = p.quantity * (p.price || 0) * (1 - (typeof p.discount === "number" ? p.discount : 0) / 100);
	              const slot = isService || isNonstock ? undefined : p.cell ?? cellByAssortment[p.assortmentMeta?.href ?? ""] ?? stock?.slotName;
	              const nonstockCost = isNonstock && p.oneOffProduct?.purchasePrice != null
	                ? p.oneOffProduct.purchasePrice * p.quantity
	                : null;
	              const nonstockProfit = nonstockCost == null ? null : lineTotal - nonstockCost;
                      const positionUnit = isService
                        ? "усл."
                        : p.oneOffProduct?.uomLabel
                          ?? NONSTOCK_PRODUCT_UOMS.find((unit) => unit.code === p.oneOffProduct?.uomCode)?.label
                          ?? p.uomName
                          ?? "шт.";
              return (
                <article
                  key={p.assortmentMeta?.href ?? index}
                  className={["eco-position-card", overAvailable ? "is-warning" : "", recentlyAddedPositionIndex === index ? "is-new" : ""].filter(Boolean).join(" ")}
                >
                  <div className="eco-position-card-head">
                    <div>
	                      {productHref ? (
	                        <Link href={productHref} className="eco-linked-entity" title={isService ? "Открыть услугу" : "Открыть товар"}>
                            <strong>{p.name}</strong>
                            <ExternalLink className="eco-icon" aria-hidden />
                          </Link>
	                      ) : <strong>{p.name}</strong>}
		                      <span>{isService ? "локальная услуга" : isNonstock ? "Разовый товар · не учитывается в остатках" : p.assortmentMeta?.href ? "локальная позиция" : "ручная позиция"}</span>
		                      {p.copyMeta?.priceUpdated && (
		                        <span className="eco-position-copy-note is-updated">
		                          Цена обновлена: было {formatCents(p.copyMeta.originalPriceCents)} → стало {formatCents(p.copyMeta.currentPriceCents)}
		                        </span>
		                      )}
		                      {["unlinked", "ambiguous", "archived", "one_off_price_check"].includes(String(p.copyMeta?.status ?? "")) && (
		                        <span className="eco-position-copy-note is-warning">
		                          {p.copyMeta?.message ?? "Позиция требует проверки"}
		                        </span>
		                      )}
	                    </div>
                    <div className="eco-position-card-actions">
                      {isNonstock ? (
                        <button type="button" onClick={() => openNonstockProductForm(index)} aria-label="Редактировать разовый товар" title="Редактировать разовый товар">
                          <Pencil className="eco-icon" aria-hidden />
                        </button>
                      ) : null}
                      <button type="button" onClick={() => removePosition(index)} aria-label="Удалить позицию" title="Удалить позицию">
                        <Trash2 className="eco-icon" aria-hidden />
                      </button>
                    </div>
                  </div>
                  <PositionAvailabilityView
                    isService={isService}
                    isNonstock={isNonstock}
                    slot={slot}
                    quantity={stock?.quantity}
                    reserve={stock?.reserve}
                    available={available}
                    needed={p.quantity || 0}
                  />
                  {isNonstock ? (
                    <dl className="eco-position-nonstock-details">
                      <div><dt>Купили</dt><dd>{nonstockCost == null ? "Не указано" : formatShipmentMoney(nonstockCost)}</dd></div>
                      <div><dt>Продали</dt><dd>{formatShipmentMoney(lineTotal)}</dd></div>
                      <div><dt>Прибыль</dt><dd>{nonstockProfit == null ? "Не рассчитана" : formatShipmentMoney(nonstockProfit)}</dd></div>
                      {p.oneOffProduct?.purchaseSourceLabel ? <div><dt>Где купили</dt><dd>{p.oneOffProduct.purchaseSourceLabel}</dd></div> : null}
                    </dl>
                  ) : null}
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
                      <QuantityInput
                        value={p.quantity}
                        onValueChange={(quantity) => {
                          const next = [...positions];
                          next[index] = { ...p, quantity };
                          setPositions(next);
                          markDraftDirty();
                        }}
                        className="eco-position-edit-input is-qty"
                      />
                    </label>
                    <span className="eco-position-card-unit"><span>Ед.</span><b>{positionUnit}</b></span>
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
                    <strong>{formatShipmentMoney(lineTotal)}</strong>
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
                  <th>Ед.</th>
                  <th className="is-num">Цена</th>
                  <th className="is-num">Сумма</th>
                  <th className="is-action">Действия</th>
                </tr>
              </thead>
              <tbody>
                {positionGroups.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="eco-position-group-row">
                      <td colSpan={9}>
                        <div className="eco-position-group-label">
                          <span>{group.title}</span>
                          <b>{group.items.length}</b>
                        </div>
                      </td>
                    </tr>
	                {group.items.map(({ position: p, index }, groupRowIndex) => {
	                  const isService = isServiceMeta(p.assortmentMeta);
	                  const isNonstock = isNonstockProduct(p);
	                  const productHref = positionProductHref(p);
	                  const stock = getPositionStock(p);
	                  const available = isService || isNonstock ? undefined : stock?.available;
	                  const overAvailable = typeof available === "number" && (p.quantity || 0) > available;
	                  const slot = isService || isNonstock ? undefined : p.cell ?? cellByAssortment[p.assortmentMeta?.href ?? ""] ?? stock?.slotName;
                  const lineTotal = p.quantity * (p.price || 0) * (1 - (typeof p.discount === "number" ? p.discount : 0) / 100);
                  const positionUnit = isService
                    ? "усл."
                    : p.oneOffProduct?.uomLabel
                      ?? NONSTOCK_PRODUCT_UOMS.find((unit) => unit.code === p.oneOffProduct?.uomCode)?.label
                      ?? p.uomName
                      ?? "шт.";
                  return (
                  <tr
                    key={p.assortmentMeta?.href ?? index}
                    className={[overAvailable ? "is-warning" : "", recentlyAddedPositionIndex === index ? "is-new" : ""].filter(Boolean).join(" ") || undefined}
                  >
                    <td className="eco-position-row-number">{String(groupRowIndex + 1).padStart(2, "0")}</td>
                    <td className="eco-position-product-cell" title={p.name}>
	                      {productHref ? (
	                        <Link href={productHref} className="eco-position-product-name eco-position-product-link" title={isService ? "Открыть услугу" : "Открыть товар"}>
                            <span>{p.name}</span>
                            <ExternalLink className="eco-icon" aria-hidden />
                          </Link>
	                      ) : <span className="eco-position-product-name">{p.name}</span>}
	                      <span className="eco-position-product-code">
		                        {isService ? "локальная услуга" : isNonstock ? "Разовый товар · не учитывается в остатках" : p.assortmentMeta?.href ? "локальная позиция" : "ручная позиция"}
	                      </span>
	                      {p.copyMeta?.priceUpdated && (
	                        <span className="eco-position-copy-note is-updated">
	                          Цена обновлена: было {formatCents(p.copyMeta.originalPriceCents)} → стало {formatCents(p.copyMeta.currentPriceCents)}
	                        </span>
	                      )}
	                      {["unlinked", "ambiguous", "archived", "one_off_price_check"].includes(String(p.copyMeta?.status ?? "")) && (
	                        <span className="eco-position-copy-note is-warning">
	                          {p.copyMeta?.message ?? "Позиция требует проверки"}
	                        </span>
	                      )}
                    </td>
                    <td>
                      <PositionAvailabilityView
                        isService={isService}
                        isNonstock={isNonstock}
                        slot={slot}
                        quantity={stock?.quantity}
                        reserve={stock?.reserve}
                        available={available}
                        needed={p.quantity || 0}
                      />
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
                      <QuantityInput
                        value={p.quantity}
                        onValueChange={(quantity) => {
                          const next = [...positions];
                          next[index] = { ...p, quantity };
                          setPositions(next);
                          markDraftDirty();
                        }}
                        className="eco-position-edit-input is-qty"
                      />
                    </td>
                    <td className="eco-position-unit">{positionUnit}</td>
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
                      <strong className="eco-position-line-total">{formatShipmentMoney(lineTotal)}</strong>
                    </td>
                    <td className="is-action">
                      {isNonstock ? (
                        <button
                          type="button"
                          onClick={() => openNonstockProductForm(index)}
                          className="eco-position-row-action"
                          aria-label="Редактировать разовый товар"
                          title="Редактировать разовый товар"
                        >
                          <Pencil className="eco-icon" aria-hidden />
                        </button>
                      ) : null}
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
          {positions.length > collapsedPositionLimit && (
            <button
              type="button"
              className="eco-shipment-position-reveal"
              onClick={() => setPositionsExpanded((current) => !current)}
              aria-expanded={positionsExpanded}
            >
              {positionsExpanded ? "Свернуть список" : `Показать ещё ${hiddenPositionsCount}`}
            </button>
          )}
          <div className="eco-shipment-new-table-foot">
            <span>Позиций: {positions.length}</span>
            <span>Кол-во всего: {positionsQty}</span>
            <strong>
              Итого: {formatShipmentMoney(positionsTotal)}
            </strong>
          </div>
		        </section>
		      )}
		        <aside id="shipment-finalize" className="eco-shipment-detail-aside eco-shipment-new-aside" aria-labelledby="shipment-finalize-title">
	          <section className="eco-card eco-shipment-new-total-card">
	            <div className="eco-shipment-card-head">
	              <div>
	                <span className="eco-page-kicker">Шаг 3</span>
	                <h2 id="shipment-finalize-title">Проверка и сохранение</h2>
	              </div>
	              <EcoBadge tone={finalStepReady ? "success" : "warning"} dot>
	                {finalStepReady ? "Готово" : "Проверьте"}
	              </EcoBadge>
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
	                <strong>{formatShipmentMoney(positionsTotal)}</strong>
	                <em>{positions.length} позиций · {positionsQty} ед.</em>
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
	              <div className="eco-shipment-final-checklist" aria-label="Готовность отгрузки">
	                <button type="button" className={documentStepReady ? "is-ready" : "is-missing"} onClick={() => setDocumentParamsOpen(true)}>
	                  <span aria-hidden>{documentStepReady ? "✓" : "1"}</span>
	                  <span><strong>Документ</strong><small>{documentStepReady ? "Организация и склад выбраны" : "Укажите организацию и склад"}</small></span>
	                </button>
	                <a href="#shipment-parties" className={selectedAgent ? "is-ready" : "is-missing"}>
	                  <span aria-hidden>{selectedAgent ? "✓" : "2"}</span>
	                  <span><strong>Клиент</strong><small>{selectedAgent ? clientDisplayName : "Клиент не выбран"}</small></span>
	                </a>
	                <a href="#shipment-position-list" className={positions.length > 0 && overAvailablePositionsCount === 0 ? "is-ready" : "is-missing"}>
	                  <span aria-hidden>{positions.length > 0 && overAvailablePositionsCount === 0 ? "✓" : "3"}</span>
	                  <span>
	                    <strong>Позиции</strong>
	                    <small>{positions.length === 0 ? "Нет позиций" : overAvailablePositionsCount > 0 ? `Нехватка остатка: ${overAvailablePositionsCount}` : `${positions.length} позиций проверено`}</small>
	                  </span>
	                </a>
	              </div>
	              <div className="eco-shipment-final-actions">
	                <label className="eco-shipment-new-check">
	                  <input id="applicable" type="checkbox" checked={applicable} onChange={(e) => { setApplicable(e.target.checked); markDraftDirty(); }} />
	                  <span>Провести отгрузку. Складские товары будут списаны; разовые товары остатки не изменят.</span>
	                </label>
	                {nonstockCostBlocksPosting && (
	                  <p className="eco-shipment-new-error">Укажите закупочную цену разового товара. Без неё прибыль по отгрузке будет рассчитана неверно.</p>
	                )}
	                {overAvailablePositionsCount > 0 && (
	                  <p className="eco-shipment-new-error">Нужно исправить позиции с нехваткой остатка: {overAvailablePositionsCount}</p>
	                )}
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
	                <details className="eco-shipment-final-details">
	                  <summary>Комментарий</summary>
	                  <label className="eco-field">
	                    <span>Комментарий к отгрузке</span>
	                    <textarea rows={3} value={description} onChange={(e) => { setDescription(e.target.value); markDraftDirty(); }} className="eco-input eco-shipment-new-comment" />
	                  </label>
	                </details>
	                <details className="eco-shipment-final-details">
	                  <summary>Печать, предчек и диагностика</summary>
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
	                    <button
	                      type="button"
	                      className="eco-shipment-diagnostic-action"
	                      onClick={() => void handleOpenDiagnostic()}
	                      disabled={!demandIdLocal || submitLoading}
	                      title={!demandIdLocal ? "Сначала сохраните отгрузку" : undefined}
	                    >
	                      {diagnosticRowId ? "Открыть диагностику" : "Создать диагностику"}
	                    </button>
	                  </div>
	                </details>
	              </div>
	            </div>
	          </section>
	        </aside>
      </div>
      </div>
      </section>
        </div>
      </div>

      {submitError && (
        <div className="eco-toast" role="alert">
          {submitError}
        </div>
      )}

      <div className="eco-shipment-bottom-bar">
        <button type="button" className="eco-shipment-bottom-total" onClick={() => setSummarySheetOpen(true)}>
          <span>В отгрузке: {positions.length} поз. · {positionsQty} ед.</span>
          <strong>{formatShipmentMoney(positionsTotal)}</strong>
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
                <strong>{formatShipmentMoney(positionsTotal)}</strong>
              </div>
              <label className="eco-field">
                <span>Комментарий</span>
                <textarea rows={3} value={description} onChange={(e) => { setDescription(e.target.value); markDraftDirty(); }} className="eco-input eco-shipment-new-comment" />
              </label>
              <label className="eco-shipment-new-check">
                <input type="checkbox" checked={applicable} onChange={(e) => { setApplicable(e.target.checked); markDraftDirty(); }} />
                <span>Провести отгрузку. Складские товары будут списаны; разовые товары остатки не изменят.</span>
              </label>
              {nonstockCostBlocksPosting ? (
                <p className="eco-shipment-new-error">Укажите закупочную цену разового товара. Без неё прибыль по отгрузке будет рассчитана неверно.</p>
              ) : null}
              <div className="eco-readiness-list">
                {readinessItems.map((item) => (
                  <span key={item.key} className={item.ready ? "is-ready" : item.partial ? "is-partial" : ""}>
                    {item.ready ? "✓" : item.partial ? "◐" : "•"} {item.label}
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
          licensePlate: getAttributeString(attributes, (name) => /^гос\.?\s*номер$|^госномер$|license\s*plate|plate/i.test(name)),
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
