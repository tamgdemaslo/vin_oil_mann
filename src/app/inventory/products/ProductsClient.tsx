"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Building2,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  History,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  PackageOpen,
  PanelLeftClose,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import MoneyInput, { parseMoneyInput } from "@/components/MoneyInput";
import {
  bulkOilSetupProblems,
  deriveProductMarkingStatus,
  isLiterSaleUnit,
  normalizeProductMarkingMode,
  normalizeProductMarkingSettings,
  productHasMarkingProblem,
  productMarkingDefaultForGroup,
  productMarkingModeLabel,
  productMarkingStatusText,
  type ProductMarkingMode,
  type ProductMarkingSettings,
} from "@/lib/product-marking";

type StockRow = {
  storeId: string;
  storeName: string;
  quantity: number;
  available: number;
  reserve: number;
  slotName: string;
};

type ProductPhoto = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
};

type ProductRow = {
  id: string;
  moyskladId?: string;
  name: string;
  article: string;
  code: string;
  externalCode: string;
  groupPath: string;
  uomName: string;
  entityType: string;
  salePrice: number;
  buyPrice: number | null;
  currencyName: string;
  minimumBalance: number | null;
  barcodeEan13: string;
  barcodeEan8: string;
  barcodeCode128: string;
  description: string;
  minPrice: number | null;
  minPriceCurrencyName: string;
  countryName: string;
  vatLabel: string;
  supplierName: string;
  legacySupplierName?: string;
  supplierCounterparty?: ProductSupplier | null;
  weight: number | null;
  volume: number | null;
  modificationCode: string;
  tnvedCode: string;
  sae: string;
  oem: string;
  acea: string;
  apiSpec: string;
  packageVolume: string;
  avito: boolean | null;
  brand: string;
  atf: string;
  ilsac: string;
  aceaExtra: string;
  oemAtf: string;
  mannName: string;
  rosskoPartNumber: string;
  rosskoBrand: string;
  rosskoMin: string;
  supplierAttribute: string;
  oemParts: string;
  cell: string;
  mannCharacteristicName: string;
  imageHref: string;
  photos: ProductPhoto[];
  archived: boolean;
  updatedAt: string;
  stock: StockRow[];
  totalQuantity: number;
  totalAvailable: number;
  markingEnabled: boolean;
  markingMode: ProductMarkingMode;
  markingStatus: string;
  markingSettings: ProductMarkingSettings | null;
  markingConfiguredManually?: boolean;
  markingConfiguredAt?: string | null;
  markingConfiguredByLogin?: string | null;
};

type ProductFormErrors = Partial<Record<keyof ProductForm, string>>;

type ProductSortKey =
  | "name"
  | "article"
  | "code"
  | "available"
  | "quantity"
  | "buyPrice"
  | "salePrice"
  | "margin"
  | "updatedAt";
type SortDirection = "asc" | "desc";
type StockFilter = "all" | "inStock" | "outOfStock";

type ProductFilters = {
  brand: string[];
  sae: string[];
  supplier: string[];
  group: string[];
  entityType: string[];
  apiSpec: string[];
  acea: string[];
  packageVolume: string[];
  stock: StockFilter;
  markingProblems: boolean;
};

type ProductFacetOption = {
  value: string;
  count: number;
};

type ProductFacets = {
  brands: ProductFacetOption[];
  sae: ProductFacetOption[];
  suppliers: ProductFacetOption[];
  groups: ProductFacetOption[];
  entityTypes: ProductFacetOption[];
  apiSpecs: ProductFacetOption[];
  acea: ProductFacetOption[];
  packageVolumes: ProductFacetOption[];
  stock: Record<StockFilter, number>;
};

type ProductFilterOptions = {
  brands: string[];
  sae: string[];
  suppliers: string[];
  groups: string[];
  entityTypes: string[];
  apiSpecs: string[];
  acea: string[];
  packageVolumes: string[];
};

type ProductListMeta = {
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  sort: ProductSortKey;
  direction: SortDirection;
  filters: ProductFilters;
  filterOptions: ProductFilterOptions;
  facets?: ProductFacets;
};
type ProductListResponse = { meta?: ProductListMeta; products?: ProductRow[]; matchedOutsideFilters?: number; error?: string };
type ProductGroupsResponse = { groups?: string[]; error?: string };
type ProductToast = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};
type ProductGroupKind = "oil" | "filter" | "other";
type ActionMenuPosition = {
  top: number;
  left: number;
  placement: "bottom-end" | "top-end";
  arrowLeft: number;
};
type RosskoOemPreviewItem = {
  key: string;
  brand: string;
  partNumber: string;
  name: string;
  oem: string;
  confidence: number;
  source: string;
};
type RosskoOemPreviewResponse = {
  query?: string;
  items?: RosskoOemPreviewItem[];
  rawCount?: number;
  error?: string;
};

type ProductImportMode = "update" | "create" | "upsert" | "validate";
type ProductImportErrorMode = "validRows" | "allOrNothing";
type ProductImportPreviewFilter = "all" | "new" | "changed" | "errors" | "conflicts";
type ProductImportRow = {
  rowNumber: number;
  matchedProductId: string | null;
  matchedProductName: string | null;
  action: "create" | "update" | "skip" | "conflict";
  status: "pending" | "ok" | "warning" | "error" | "conflict" | "skipped";
  changedFields: Array<{ field: string; label: string; oldValue: unknown; newValue: unknown }>;
  errors: string[];
  warnings: string[];
};
type ProductImportJob = {
  id: string;
  fileName: string;
  mode: string;
  status: string;
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  conflictRows: number;
  rollbackAt?: string | null;
  createdAt: string;
  rows: ProductImportRow[];
};
type ProductImportHistoryItem = Omit<ProductImportJob, "rows">;

type ProductForm = {
  name: string;
  article: string;
  code: string;
  externalCode: string;
  groupPath: string;
  uomName: string;
  entityType: string;
  salePrice: string;
  buyPrice: string;
  currencyName: string;
  minimumBalance: string;
  barcodeEan13: string;
  barcodeEan8: string;
  barcodeCode128: string;
  description: string;
  minPrice: string;
  minPriceCurrencyName: string;
  countryName: string;
  vatLabel: string;
  supplierName: string;
  supplierCounterpartyId: string;
  weight: string;
  volume: string;
  modificationCode: string;
  tnvedCode: string;
  sae: string;
  oem: string;
  acea: string;
  apiSpec: string;
  packageVolume: string;
  avito: string;
  brand: string;
  atf: string;
  ilsac: string;
  aceaExtra: string;
  oemAtf: string;
  mannName: string;
  rosskoPartNumber: string;
  rosskoBrand: string;
  rosskoMin: string;
  supplierAttribute: string;
  oemParts: string;
  cell: string;
  mannCharacteristicName: string;
  markingEnabled: string;
  markingMode: string;
  markingStatus: string;
  markingDeclaredVolumeLiters: string;
  markingNonDrainableRemainderPercent: string;
  markingAllowRepeatedBarrelCode: string;
  markingPartialWithdrawalEnabled: string;
  markingAllowSaleWithoutActiveBarrel: string;
  markingActiveBarrelName: string;
  markingActiveBarrelCode: string;
  markingActiveBarrelGtin: string;
  markingVerificationStatus: string;
  markingCurrentVolumeLiters: string;
};

type ProductSupplier = {
  id: string;
  displayName: string;
  inn: string;
  legalForm: string;
  status: string;
};

type SupplierOption = ProductSupplier & {
  phone: string;
  contactPerson: string;
};

type QuickSupplierForm = {
  name: string;
  legalForm: "LEGAL_ENTITY" | "SOLE_PROPRIETOR" | "OTHER";
  inn: string;
  phone: string;
  contactPerson: string;
};

type ProductFieldRenderOptions = {
  type?: "text" | "number" | "textarea" | "money";
  placeholder?: string;
  required?: boolean;
  full?: boolean;
  rows?: number;
  step?: string;
  aliases?: string[];
  hint?: string;
};

type ProductEditorBufferedInputProps = {
  id: string;
  value: string;
  className: string;
  placeholder?: string;
  type?: "text" | "number";
  step?: string;
  rows?: number;
  onCommit: (value: string) => void;
};

type ProductEditorSectionId = "main" | "pricing" | "marking" | "codes" | "oil" | "extra" | "technical";

const emptyForm: ProductForm = {
  name: "",
  article: "",
  code: "",
  externalCode: "",
  groupPath: "",
  uomName: "",
  entityType: "product",
  salePrice: "",
  buyPrice: "",
  currencyName: "руб.",
  minimumBalance: "",
  barcodeEan13: "",
  barcodeEan8: "",
  barcodeCode128: "",
  description: "",
  minPrice: "",
  minPriceCurrencyName: "руб.",
  countryName: "",
  vatLabel: "",
  supplierName: "",
  supplierCounterpartyId: "",
  weight: "",
  volume: "",
  modificationCode: "",
  tnvedCode: "",
  sae: "",
  oem: "",
  acea: "",
  apiSpec: "",
  packageVolume: "",
  avito: "",
  brand: "",
  atf: "",
  ilsac: "",
  aceaExtra: "",
  oemAtf: "",
  mannName: "",
  rosskoPartNumber: "",
  rosskoBrand: "",
  rosskoMin: "",
  supplierAttribute: "",
  oemParts: "",
  cell: "",
  mannCharacteristicName: "",
  markingEnabled: "false",
  markingMode: "NOT_MARKED",
  markingStatus: "NOT_MARKED",
  markingDeclaredVolumeLiters: "",
  markingNonDrainableRemainderPercent: "",
  markingAllowRepeatedBarrelCode: "true",
  markingPartialWithdrawalEnabled: "true",
  markingAllowSaleWithoutActiveBarrel: "false",
  markingActiveBarrelName: "",
  markingActiveBarrelCode: "",
  markingActiveBarrelGtin: "",
  markingVerificationStatus: "",
  markingCurrentVolumeLiters: "",
};

const productFormKeys = Object.keys(emptyForm) as Array<keyof ProductForm>;

function isProductFormDirty(current: ProductForm, baseline: ProductForm) {
  return productFormKeys.some((key) => current[key] !== baseline[key]);
}

const searchImpactFields = new Set<keyof ProductForm>([
  "name",
  "article",
  "code",
  "brand",
  "groupPath",
  "barcodeEan13",
  "oem",
  "oemParts",
]);

const shipmentImpactFields = new Set<keyof ProductForm>([
  "name",
  "entityType",
  "salePrice",
  "uomName",
  "minimumBalance",
  "cell",
  "markingEnabled",
  "markingMode",
  "markingActiveBarrelCode",
  "markingCurrentVolumeLiters",
]);

const criticalFieldLabels: Partial<Record<keyof ProductForm, string>> = {
  name: "название",
  article: "артикул",
  code: "код",
  groupPath: "группа",
  salePrice: "цена продажи",
  buyPrice: "закупочная цена",
  uomName: "единица",
  minimumBalance: "неснижаемый остаток",
  barcodeEan13: "EAN",
  oem: "OEM",
  markingMode: "маркировка",
  markingActiveBarrelCode: "код бочки",
};

const technicalFieldLabels: Array<{ key: keyof ProductForm; label: string; type?: "number" | "textarea"; aliases?: string[] }> = [
  { key: "supplierAttribute", label: "Supplier raw field", aliases: ["supplier"] },
];

const productEditorSections: Array<{ id: ProductEditorSectionId; label: string; aliases: string[] }> = [
  {
    id: "main",
    label: "Основное",
    aliases: ["главное", "название", "артикул", "код", "штрихкод", "тип", "бренд", "группа", "единица", "поставщик"],
  },
  {
    id: "pricing",
    label: "Склад",
    aliases: ["остаток", "доступно", "резерв", "ячейк", "склад", "минимальный остаток"],
  },
  {
    id: "marking",
    label: "Маркировка",
    aliases: ["маркировка", "честный знак", "aqsi", "разлив", "розлив", "бочка", "код маркировки", "gtin"],
  },
  {
    id: "codes",
    label: "Доп. коды",
    aliases: ["коды", "штрихкод", "barcode", "ean", "ean8", "code128", "rossko", "внешний артикул"],
  },
  {
    id: "oil",
    label: "Характеристики",
    aliases: ["характеристики", "масло", "фильтр", "жидкость", "sae", "api", "acea", "ilsac", "atf", "объем", "фасовка", "oem", "кроссы", "аналоги"],
  },
  {
    id: "extra",
    label: "Служебные",
    aliases: ["описание", "страна", "тн вэд", "вес", "авито", "справочная информация", "ндс", "минимальная цена", "валюта"],
  },
  {
    id: "technical",
    label: "Тех. поля",
    aliases: ["технические", "uuid", "id", "external", "moysklad", "интеграции", "служебные"],
  },
];

const sortOptions: Array<{ key: ProductSortKey; label: string; defaultDirection: SortDirection }> = [
  { key: "name", label: "Название", defaultDirection: "asc" },
  { key: "article", label: "Артикул", defaultDirection: "asc" },
  { key: "code", label: "Код", defaultDirection: "asc" },
  { key: "available", label: "Остаток", defaultDirection: "desc" },
  { key: "quantity", label: "Остаток общий", defaultDirection: "desc" },
  { key: "buyPrice", label: "Цена закупки", defaultDirection: "desc" },
  { key: "salePrice", label: "Цена продажи", defaultDirection: "desc" },
  { key: "margin", label: "Маржа", defaultDirection: "desc" },
  { key: "updatedAt", label: "Недавно изменённые", defaultDirection: "desc" },
];

const emptyFilters: ProductFilters = {
  brand: [],
  sae: [],
  supplier: [],
  group: [],
  entityType: [],
  apiSpec: [],
  acea: [],
  packageVolume: [],
  stock: "all",
  markingProblems: false,
};

const emptyFilterOptions: ProductFilterOptions = {
  brands: [],
  sae: [],
  suppliers: [],
  groups: [],
  entityTypes: [],
  apiSpecs: [],
  acea: [],
  packageVolumes: [],
};

const emptyFacets: ProductFacets = {
  brands: [],
  sae: [],
  suppliers: [],
  groups: [],
  entityTypes: [],
  apiSpecs: [],
  acea: [],
  packageVolumes: [],
  stock: { all: 0, inStock: 0, outOfStock: 0 },
};

const stockOptions: Array<{ value: StockFilter; label: string }> = [
  { value: "all", label: "Все остатки" },
  { value: "inStock", label: "В наличии" },
  { value: "outOfStock", label: "Нет на остатке" },
];
const PRODUCT_PAGE_LIMIT = 50;
const NEW_GROUP_VALUE = "__new_group__";
const BRAND_ORDER = ["Shell", "Mobil", "ZIC", "Total", "Lukoil", "Bardahl", "ELF", "BMW", "Mann", "ZF", "VAG"];
const FILTER_SIDEBAR_STORAGE_KEY = "inventory-products-filter-sidebar-collapsed";
const FILTER_MOBILE_QUERY = "(max-width: 1180px)";
const ACTION_MENU_GAP = 8;
const ACTION_MENU_VIEWPORT_PADDING = 12;
const ACTION_MENU_ARROW_SIZE = 10;
const PRODUCT_EDITOR_INPUT_COMMIT_DELAY_MS = 120;

function ProductEditorBufferedInput({
  id,
  value,
  className,
  placeholder,
  type = "text",
  step,
  rows,
  onCommit,
}: ProductEditorBufferedInputProps) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const pendingValueRef = useRef(value);
  const committedValueRef = useRef(value);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    committedValueRef.current = value;
    pendingValueRef.current = value;
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  useEffect(() => () => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
  }, []);

  function commitNow(nextValue = pendingValueRef.current) {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    if (committedValueRef.current === nextValue) return;
    committedValueRef.current = nextValue;
    onCommit(nextValue);
  }

  function scheduleCommit(nextValue: string) {
    pendingValueRef.current = nextValue;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => commitNow(nextValue), PRODUCT_EDITOR_INPUT_COMMIT_DELAY_MS);
  }

  const commonProps = {
    id,
    value: draft,
    placeholder,
    className,
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
      commitNow();
    },
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const nextValue = event.target.value;
      setDraft(nextValue);
      scheduleCommit(nextValue);
    },
  };

  if (rows) {
    return <textarea {...commonProps} rows={rows} />;
  }

  return (
    <input
      {...commonProps}
      type={type}
      step={step}
    />
  );
}

function ProductEditorBufferedMoneyInput({
  id,
  value,
  className,
  placeholder,
  onCommit,
}: Omit<ProductEditorBufferedInputProps, "type" | "step" | "rows">) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const pendingValueRef = useRef(value);
  const committedValueRef = useRef(value);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    committedValueRef.current = value;
    pendingValueRef.current = value;
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  useEffect(() => () => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
  }, []);

  function commitNow(nextValue = pendingValueRef.current) {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    if (committedValueRef.current === nextValue) return;
    committedValueRef.current = nextValue;
    onCommit(nextValue);
  }

  function scheduleCommit(nextValue: string) {
    pendingValueRef.current = nextValue;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => commitNow(nextValue), PRODUCT_EDITOR_INPUT_COMMIT_DELAY_MS);
  }

  return (
    <MoneyInput
      id={id}
      value={draft}
      placeholder={placeholder}
      className={className}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        commitNow();
      }}
      onValueChange={(_value, nextDraft) => {
        setDraft(nextDraft);
        scheduleCommit(nextDraft);
      }}
    />
  );
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function formatMoneyWhole(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Math.round(n).toLocaleString("ru-RU");
}

function formatQty(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function shortGroupLabel(value: string) {
  const label = value.split("/").filter(Boolean).at(-1)?.trim() || value.trim();
  const cleaned = label
    .replace(/^Фильтры\s+/i, "Фильтр ")
    .replace(/^Масло в канистрах\s+/i, "")
    .replace(/^Масло\s+/i, "")
    .replace(/\s+/g, " ");
  const normalized = cleaned.toLowerCase().replace(/ё/g, "е");
  if (normalized === "моторное") return "Моторное масло";
  if (normalized === "масляные фильтры" || normalized === "масляные фильтры акпп") return "Фильтр масляный";
  if (normalized === "трансмисионное" || normalized === "трансмиссионное") return "Трансмиссионное";
  if (normalized === "моторное в бочках на розлив") return "Моторное в бочках на розлив";
  if (normalized === "трансмисионное в бочках на розлив" || normalized === "трансмиссионное в бочках на розлив") {
    return "Трансмиссионное в бочках на розлив";
  }
  return cleaned;
}

function normalizedGroupLabel(value: string) {
  return shortGroupLabel(value).toLowerCase().replace(/ё/g, "е").trim();
}

function categoryPriority(value: string) {
  const label = normalizedGroupLabel(value);
  if (label === "моторное масло") return 0;
  if (label === "фильтр масляный") return 1;
  if (label === "трансмиссионное") return 2;
  if (label === "расходник") return 3;
  return 20;
}

function brandPriority(value: string) {
  const normalized = value.trim().toLowerCase();
  const index = BRAND_ORDER.findIndex((brand) => brand.toLowerCase() === normalized);
  return index === -1 ? 50 : index;
}

function displayBrandLabel(value: string) {
  return BRAND_ORDER.find((brand) => brand.toLowerCase() === value.trim().toLowerCase()) ?? value;
}

function uniqueGroupsByLabel(groups: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    const key = normalizedGroupLabel(group);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(group);
  }
  return result;
}

type MultiFilterKey = Exclude<keyof ProductFilters, "stock" | "markingProblems">;
type FacetKey = "group" | "brand" | "sae" | "supplier" | "apiSpec" | "acea" | "packageVolume" | "entityType";
type FacetOrderState = Record<FacetKey, Map<string, number>>;
type FacetPreviewPinState = Record<FacetKey, Set<string>>;

const facetLabels: Record<FacetKey, { title: string; search: string; all: string }> = {
  group: { title: "Категория", search: "Найти категорию", all: "Показать все категории" },
  brand: { title: "Бренд", search: "Найти бренд", all: "Показать все бренды" },
  sae: { title: "SAE / Вязкость", search: "Найти вязкость", all: "Показать все вязкости" },
  supplier: { title: "Поставщик", search: "Найти поставщика", all: "Показать всех поставщиков" },
  apiSpec: { title: "API", search: "Найти API", all: "Показать все API" },
  acea: { title: "ACEA", search: "Найти ACEA", all: "Показать все ACEA" },
  packageVolume: { title: "Фасовка", search: "Найти фасовку", all: "Показать все фасовки" },
  entityType: { title: "Тип", search: "Найти тип", all: "Показать все типы" },
};

function facetOptionsKey(key: FacetKey): keyof ProductFacets {
  if (key === "group") return "groups";
  if (key === "brand") return "brands";
  if (key === "supplier") return "suppliers";
  if (key === "apiSpec") return "apiSpecs";
  if (key === "packageVolume") return "packageVolumes";
  if (key === "entityType") return "entityTypes";
  return key;
}

function fallbackFilterOptionsKey(key: FacetKey): keyof ProductFilterOptions {
  if (key === "group") return "groups";
  if (key === "brand") return "brands";
  if (key === "supplier") return "suppliers";
  if (key === "apiSpec") return "apiSpecs";
  if (key === "packageVolume") return "packageVolumes";
  if (key === "entityType") return "entityTypes";
  return key;
}

function filterLabel(key: FacetKey, value: string) {
  if (key === "group") return shortGroupLabel(value);
  if (key === "brand") return displayBrandLabel(value);
  if (key === "entityType") return entityTypeLabel(value);
  return value;
}

function filterPriority(key: FacetKey, value: string) {
  if (key === "group") return categoryPriority(value);
  if (key === "brand") return brandPriority(value);
  return 20;
}

function createFacetOrderState(): FacetOrderState {
  return {
    group: new Map(),
    brand: new Map(),
    sae: new Map(),
    supplier: new Map(),
    apiSpec: new Map(),
    acea: new Map(),
    packageVolume: new Map(),
    entityType: new Map(),
  };
}

function createFacetPreviewPinState(): FacetPreviewPinState {
  return {
    group: new Set(),
    brand: new Set(),
    sae: new Set(),
    supplier: new Set(),
    apiSpec: new Set(),
    acea: new Set(),
    packageVolume: new Set(),
    entityType: new Set(),
  };
}

function facetStableKey(key: FacetKey, value: string) {
  return key === "group" ? normalizedGroupLabel(value) : normalizeFieldSearch(filterLabel(key, value));
}

function compareFacetInitialOrder(key: FacetKey, a: ProductFacetOption, b: ProductFacetOption) {
  const priorityDiff = filterPriority(key, a.value) - filterPriority(key, b.value);
  if (priorityDiff !== 0) return priorityDiff;
  const countDiff = b.count - a.count;
  if (countDiff !== 0) return countDiff;
  return filterLabel(key, a.value).localeCompare(filterLabel(key, b.value), "ru", { numeric: true, sensitivity: "base" });
}

function selectedFilterValues(filters: ProductFilters, key: FacetKey) {
  return filters[key as MultiFilterKey];
}

function usefulProductMetaLines(row: ProductRow) {
  const compactMeta = [shortGroupLabel(row.groupPath), displayBrandLabel(row.brand), row.packageVolume]
    .filter((value) => value && value !== "-")
    .join(" · ");
  return [compactMeta].filter(Boolean);
}

function formatFileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}

function normalizeFieldSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productEditorSectionElementId(sectionId: ProductEditorSectionId) {
  return `product-editor-${sectionId}`;
}

function sectionMatchesSearch(section: { label: string; aliases: string[] }, needle: string) {
  if (!needle) return false;
  const haystack = normalizeFieldSearch([section.label, ...section.aliases].join(" "));
  return haystack.includes(needle) || needle.includes(haystack);
}

function matchedEditorSection(needle: string): ProductEditorSectionId | null {
  if (!needle) return null;
  if (/(маркир|честн|aqsi|акси|разлив|розлив|бочк|gtin|datamatrix|дата\s*матрикс)/i.test(needle)) return "marking";
  if (/(oem|еом|ean|штрих|barcode|code128|код|rossko|росско|крос)/i.test(needle)) return "codes";
  if (/(sae|вязк|api|acea|ilsac|atf|объем|объ[её]м|фасов)/i.test(needle)) return "oil";
  if (/(цен|марж|остат|доступ|резерв|поставщик|ндс|ячейк|валют|склад)/i.test(needle)) return "pricing";
  if (/(опис|страна|тн|тнвэд|вес|авито|модификац|коммент)/i.test(needle)) return "extra";
  if (/(uuid|id|external|moysklad|мойсклад|raw|legacy|служеб|техничес)/i.test(needle)) return "technical";
  return productEditorSections.find((section) => sectionMatchesSearch(section, needle))?.id ?? null;
}

function entityTypeLabel(value: string) {
  if (value === "service") return "Услуга";
  if (value === "variant") return "Модификация";
  if (value === "bundle") return "Комплект";
  return "Товар";
}

function compactHeaderValue(value: string | null | undefined, fallback = "не указан") {
  return value?.trim() || fallback;
}

function productGroupKindFromGroup(groupPath: string): ProductGroupKind {
  const group = normalizeFieldSearch(groupPath);
  if (!group) return "other";
  if (
    /(^|\s)(масл|масло|oil|жидк|fluid|atf|трансмисс|редуктор|гур|антифриз|тормозн)/.test(group)
    && !/фильтр/.test(group)
  ) {
    return "oil";
  }
  if (/фильтр|filter/.test(group)) return "filter";
  return "other";
}

function productGroupKind(form: ProductForm): ProductGroupKind {
  return productGroupKindFromGroup(form.groupPath);
}

function isOilProduct(form: ProductForm) {
  return productGroupKind(form) === "oil";
}

function isFilterProduct(form: ProductForm) {
  return productGroupKind(form) === "filter";
}

function filledLabels(form: ProductForm, fields: Array<{ key: keyof ProductForm; label: string }>) {
  return fields
    .filter((field) => String(form[field.key] ?? "").trim())
    .map((field) => field.label);
}

const oilCharacteristicFields: Array<{ key: keyof ProductForm; label: string }> = [
  { key: "sae", label: "SAE" },
  { key: "apiSpec", label: "API" },
  { key: "acea", label: "ACEA" },
  { key: "aceaExtra", label: "ACEA A/B" },
  { key: "ilsac", label: "ILSAC" },
  { key: "atf", label: "ATF" },
  { key: "packageVolume", label: "Фасовка" },
  { key: "volume", label: "Объём" },
  { key: "oemAtf", label: "Допуски производителя" },
];

const filterCharacteristicFields: Array<{ key: keyof ProductForm; label: string }> = [
  { key: "oem", label: "OEM" },
  { key: "oemParts", label: "OEM Parts / кросс-номера / аналоги" },
  { key: "mannCharacteristicName", label: "Применимость / примечание" },
];

function hiddenCharacteristicLabels(form: ProductForm) {
  if (isOilProduct(form)) return filledLabels(form, filterCharacteristicFields);
  if (isFilterProduct(form)) return filledLabels(form, oilCharacteristicFields);
  return filledLabels(form, [...oilCharacteristicFields, ...filterCharacteristicFields]);
}

function mergeTextList(existing: string, additions: string[]) {
  const normalized = new Set<string>();
  const result: string[] = [];
  for (const raw of [existing, ...additions].join("\n").split(/[\n,;]+/)) {
    const value = raw.trim();
    if (!value) continue;
    const key = normalizeFieldSearch(value);
    if (normalized.has(key)) continue;
    normalized.add(key);
    result.push(value);
  }
  return result.join("\n");
}

function isMarkingEnabled(form: ProductForm): boolean {
  return form.markingEnabled === "true";
}

function formMarkingMode(form: ProductForm): ProductMarkingMode {
  if (!isMarkingEnabled(form)) return "NOT_MARKED";
  const mode = normalizeProductMarkingMode(form.markingMode);
  return mode === "NOT_MARKED" ? "REQUIRES_CHECK" : mode;
}

function formMarkingSettings(form: ProductForm): ProductMarkingSettings {
  return normalizeProductMarkingSettings({
    allowRepeatedBarrelCode: form.markingAllowRepeatedBarrelCode === "true",
    partialWithdrawalEnabled: form.markingPartialWithdrawalEnabled === "true",
    allowSaleWithoutActiveBarrel: form.markingAllowSaleWithoutActiveBarrel === "true",
    declaredVolumeLiters: form.markingDeclaredVolumeLiters,
    nonDrainableRemainderPercent: form.markingNonDrainableRemainderPercent,
    activeBarrelName: form.markingActiveBarrelName,
    activeBarrelMarkingCode: form.markingActiveBarrelCode,
    activeBarrelGtin: form.markingActiveBarrelGtin,
    verificationStatus: form.markingVerificationStatus,
    currentVolumeLiters: form.markingCurrentVolumeLiters,
  });
}

function formMarkingStatus(form: ProductForm) {
  return deriveProductMarkingStatus({
    markingEnabled: isMarkingEnabled(form),
    markingMode: formMarkingMode(form),
    uomName: form.uomName,
    settings: formMarkingSettings(form),
  });
}

function applyMarkingDefaultsForGroup(form: ProductForm, groupPath: string): Partial<ProductForm> {
  const groupDefault = productMarkingDefaultForGroup(groupPath);
  if (groupDefault === "PACKAGED") {
    return {
      groupPath,
      markingEnabled: "true",
      markingMode: "PACKAGED_MARKED_GOOD",
    };
  }
  if (groupDefault === "BULK_OIL") {
    return {
      groupPath,
      markingEnabled: "true",
      markingMode: "BULK_OIL_FROM_MARKED_BARREL",
      uomName: form.uomName.trim() ? form.uomName : "л",
      markingAllowRepeatedBarrelCode: "true",
      markingPartialWithdrawalEnabled: "true",
      markingAllowSaleWithoutActiveBarrel: form.markingActiveBarrelCode.trim() ? "false" : "true",
      markingVerificationStatus: form.markingVerificationStatus || "Требует настройки",
    };
  }
  return { groupPath };
}

function isMarkingScenarioManuallyChanged(form: ProductForm, baseline: ProductForm) {
  return (
    form.markingEnabled !== baseline.markingEnabled ||
    form.markingMode !== baseline.markingMode ||
    form.markingActiveBarrelCode !== baseline.markingActiveBarrelCode ||
    form.markingCurrentVolumeLiters !== baseline.markingCurrentVolumeLiters
  );
}

function markingModeSelectLabel(mode: ProductMarkingMode) {
  if (mode === "PACKAGED_MARKED_GOOD") return "Обычная упаковка — код списывается целиком";
  if (mode === "BULK_OIL_FROM_MARKED_BARREL") return "Масло на разлив из бочки — списывается объём в литрах";
  if (mode === "REQUIRES_CHECK") return "Требует настройки";
  return productMarkingModeLabel(mode);
}

function likelyBulkOilMarkingHint(form: ProductForm): boolean {
  const text = [form.name, form.groupPath, form.packageVolume].join(" ").toLowerCase().replace(/ё/g, "е");
  return isOilProduct(form) && isLiterSaleUnit(form.uomName) && /розлив|разлив|бочк|налив|bulk/.test(text);
}

function validateProductForm(values: ProductForm): ProductFormErrors {
  const errors: ProductFormErrors = {};
  if (!values.name.trim()) errors.name = "Введите название товара";
  if (!values.entityType.trim()) errors.entityType = "Выберите тип";
  if (!values.salePrice.trim()) errors.salePrice = "Укажите цену продажи";
  if (!values.uomName.trim()) errors.uomName = "Укажите единицу измерения";
  if (!values.article.trim() && !values.code.trim()) {
    errors.article = "Укажите артикул или код";
    errors.code = "Укажите артикул или код";
  }
  if (isMarkingEnabled(values) && formMarkingMode(values) === "BULK_OIL_FROM_MARKED_BARREL" && !isLiterSaleUnit(values.uomName)) {
    errors.uomName = "Для масла на разлив единица должна быть «л»";
    errors.markingMode = "Единица товара должна быть «л»";
  }
  if (
    isMarkingEnabled(values) &&
    formMarkingMode(values) === "PACKAGED_MARKED_GOOD" &&
    (productMarkingDefaultForGroup(values.groupPath) === "BULK_OIL" || isLiterSaleUnit(values.uomName))
  ) {
    errors.markingMode = "Для разливного товара нельзя выбрать обычную упаковку: есть риск полного вывода кода.";
  }
  return errors;
}

function marginValue(row: ProductRow) {
  return row.buyPrice == null ? null : row.salePrice - row.buyPrice;
}

function reserveValue(row: ProductRow) {
  return Math.max(0, row.totalQuantity - row.totalAvailable);
}

function marginPercent(row: ProductRow) {
  const margin = marginValue(row);
  if (margin == null || row.salePrice <= 0) return null;
  return Math.round((margin / row.salePrice) * 100);
}

function productMarkingListBadge(row: ProductRow) {
  const mode = normalizeProductMarkingMode(row.markingMode);
  const hasProblem = productHasMarkingProblem({
    markingEnabled: row.markingEnabled,
    markingMode: mode,
    markingStatus: row.markingStatus,
    groupPath: row.groupPath,
    uomName: row.uomName,
    settings: row.markingSettings,
  });
  if (!row.markingEnabled || mode === "NOT_MARKED") {
    return hasProblem
      ? { label: "Требует настройки", tone: "warning", title: "Товар похож на разливной, но маркировка не настроена" }
      : { label: "Не маркируется", tone: "muted", title: "Код маркировки в чек не передаётся" };
  }
  if (row.markingStatus === "CONFIG_ERROR" || row.markingStatus === "BARREL_BLOCKED" || row.markingStatus === "CODE_MAY_BE_WITHDRAWN") {
    return { label: "Ошибка", tone: "danger", title: "Настройка маркировки опасна или бочка заблокирована" };
  }
  if (mode === "PACKAGED_MARKED_GOOD") {
    return hasProblem
      ? { label: "Ошибка", tone: "danger", title: "Товар в литрах или группе разлива настроен как обычная упаковка" }
      : { label: "Упаковка", tone: "ready", title: "Обычная маркированная упаковка: код списывается целиком" };
  }
  if (mode === "BULK_OIL_FROM_MARKED_BARREL") {
    const ready = row.markingStatus === "BULK_OIL_READY";
    return {
      label: ready ? "Разлив" : "Разлив: настройка",
      tone: ready ? "ready" : "warning",
      title: ready
        ? "Масло на разлив: код бочки используется до исчерпания объёма"
        : "Масло на разлив требует активной бочки, остатка или проверки",
    };
  }
  return { label: "Требует настройки", tone: "warning", title: "Продажа будет заблокирована до проверки маркировки" };
}

function formFromProduct(product: ProductRow): ProductForm {
  const markingSettings = normalizeProductMarkingSettings(product.markingSettings);
  return {
    name: product.name,
    article: product.article,
    code: product.code,
    externalCode: product.externalCode,
    groupPath: product.groupPath,
    uomName: product.uomName,
    entityType: product.entityType || "product",
    salePrice: product.salePrice ? String(product.salePrice) : "",
    buyPrice: product.buyPrice == null ? "" : String(product.buyPrice),
    currencyName: product.currencyName || "руб.",
    minimumBalance: product.minimumBalance == null ? "" : String(product.minimumBalance),
    barcodeEan13: product.barcodeEan13,
    barcodeEan8: product.barcodeEan8,
    barcodeCode128: product.barcodeCode128,
    description: product.description,
    minPrice: product.minPrice == null ? "" : String(product.minPrice),
    minPriceCurrencyName: product.minPriceCurrencyName || "руб.",
    countryName: product.countryName,
    vatLabel: product.vatLabel,
    supplierName: product.supplierName,
    supplierCounterpartyId: product.supplierCounterparty?.id ?? "",
    weight: product.weight == null ? "" : String(product.weight),
    volume: product.volume == null ? "" : String(product.volume),
    modificationCode: product.modificationCode,
    tnvedCode: product.tnvedCode,
    sae: product.sae,
    oem: product.oem,
    acea: product.acea,
    apiSpec: product.apiSpec,
    packageVolume: product.packageVolume,
    avito: product.avito == null ? "" : product.avito ? "true" : "false",
    brand: product.brand,
    atf: product.atf,
    ilsac: product.ilsac,
    aceaExtra: product.aceaExtra,
    oemAtf: product.oemAtf,
    mannName: product.mannName,
    rosskoPartNumber: product.rosskoPartNumber,
    rosskoBrand: product.rosskoBrand,
    rosskoMin: product.rosskoMin,
    supplierAttribute: product.supplierAttribute,
    oemParts: product.oemParts,
    cell: product.cell,
    mannCharacteristicName: product.mannCharacteristicName,
    markingEnabled: product.markingEnabled ? "true" : "false",
    markingMode: product.markingEnabled ? normalizeProductMarkingMode(product.markingMode) : "NOT_MARKED",
    markingStatus: product.markingStatus || "NOT_MARKED",
    markingDeclaredVolumeLiters:
      markingSettings.declaredVolumeLiters == null ? "" : String(markingSettings.declaredVolumeLiters),
    markingNonDrainableRemainderPercent:
      markingSettings.nonDrainableRemainderPercent == null ? "" : String(markingSettings.nonDrainableRemainderPercent),
    markingAllowRepeatedBarrelCode: markingSettings.allowRepeatedBarrelCode ? "true" : "false",
    markingPartialWithdrawalEnabled: markingSettings.partialWithdrawalEnabled ? "true" : "false",
    markingAllowSaleWithoutActiveBarrel: markingSettings.allowSaleWithoutActiveBarrel ? "true" : "false",
    markingActiveBarrelName: markingSettings.activeBarrelName,
    markingActiveBarrelCode: markingSettings.activeBarrelMarkingCode,
    markingActiveBarrelGtin: markingSettings.activeBarrelGtin,
    markingVerificationStatus: markingSettings.verificationStatus,
    markingCurrentVolumeLiters:
      markingSettings.currentVolumeLiters == null ? "" : String(markingSettings.currentVolumeLiters),
  };
}

function supplierLegalFormLabel(value: string) {
  if (value === "SOLE_PROPRIETOR") return "ИП";
  if (value === "OTHER") return "Другое";
  return "Юрлицо";
}

function SupplierCombobox({
  value,
  displayName,
  selectedSupplier,
  onChange,
}: {
  value: string;
  displayName: string;
  selectedSupplier: ProductSupplier | null;
  onChange: (supplier: SupplierOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickForm, setQuickForm] = useState<QuickSupplierForm>({
    name: "",
    legalForm: "LEGAL_ENTITY",
    inn: "",
    phone: "",
    contactPerson: "",
  });
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<SupplierOption[]>([]);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState<ProductSupplier | null>(selectedSupplier);

  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    if (selectedSupplier?.id === value) setSelected(selectedSupplier);
  }, [selectedSupplier, value]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(async () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams({ limit: "30" });
        if (query.trim()) params.set("search", query.trim());
        const res = await fetch(`/api/suppliers?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await readJson<{ suppliers?: SupplierOption[]; error?: string }>(res);
        if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить поставщиков");
        if (!controller.signal.aborted) setOptions(Array.isArray(data?.suppliers) ? data.suppliers : []);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить поставщиков");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 12;
      const width = Math.min(Math.max(rect.width, 320), window.innerWidth - viewportPadding * 2);
      setPosition({
        top: Math.min(rect.bottom + 6, window.innerHeight - viewportPadding),
        left: Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding),
        width,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selectSupplier = (supplier: SupplierOption | null) => {
    setSelected(supplier);
    onChange(supplier);
    setOpen(false);
    setQuery("");
  };

  const createSupplier = async (allowDuplicate = false) => {
    const name = quickForm.name.trim();
    if (!name) {
      setQuickError("Укажите название поставщика");
      return;
    }
    setQuickSaving(true);
    setQuickError(null);
    try {
      const res = await fetch("/api/suppliers/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...quickForm, name, allowDuplicate }),
      });
      const data = await readJson<SupplierOption & { error?: string; candidates?: SupplierOption[] }>(res);
      if (res.status === 409) {
        setDuplicates(Array.isArray(data?.candidates) ? data.candidates : []);
        setQuickError(data?.error ?? "Похожий поставщик уже существует");
        return;
      }
      if (!res.ok || !data) throw new Error(data?.error ?? "Не удалось создать поставщика");
      selectSupplier(data);
      setQuickOpen(false);
      setQuickForm({ name: "", legalForm: "LEGAL_ENTITY", inn: "", phone: "", contactPerson: "" });
      setDuplicates([]);
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : "Не удалось создать поставщика");
    } finally {
      setQuickSaving(false);
    }
  };

  const popup = open && typeof document !== "undefined" && position
    ? createPortal(
        <div
          ref={popupRef}
          className="product-supplier-popover"
          role="listbox"
          aria-label="Поставщики"
          style={{ top: position.top, left: position.left, width: position.width }}
        >
          <div className="product-supplier-popover__search">
            <Search aria-hidden className="eco-icon" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Название, ИНН, контакт или телефон"
              aria-label="Поиск поставщика"
            />
          </div>
          <div className="product-supplier-popover__results">
            {loading ? <p className="product-supplier-popover__hint"><Loader2 className="eco-icon eco-spin" /> Ищем поставщиков…</p> : null}
            {loadError ? <p className="product-supplier-popover__error">{loadError}</p> : null}
            {!loading && !loadError && options.length === 0 ? <p className="product-supplier-popover__hint">Поставщики не найдены.</p> : null}
            {options.map((supplier) => (
              <button key={supplier.id} type="button" role="option" aria-selected={supplier.id === value} onClick={() => selectSupplier(supplier)}>
                <Building2 aria-hidden className="eco-icon" />
                <span>
                  <b>{supplier.displayName}</b>
                  <em>{supplier.inn ? `ИНН ${supplier.inn}` : supplier.contactPerson || supplierLegalFormLabel(supplier.legalForm)}</em>
                </span>
              </button>
            ))}
          </div>
          <div className="product-supplier-popover__actions">
            <button type="button" onClick={() => selectSupplier(null)}>Без поставщика</button>
            <button type="button" onClick={() => { setQuickOpen(true); setOpen(false); setQuickError(null); setDuplicates([]); }}>
              <Plus aria-hidden className="eco-icon" /> Создать нового поставщика
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="product-editor-field product-supplier-field" ref={triggerRef}>
      <span className="product-editor-label"><span>Поставщик</span></span>
      <div className="product-supplier-control">
        <button
          type="button"
          className={`product-supplier-control__trigger ${value ? "is-selected" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => { setQuery(""); setOpen((current) => !current); }}
        >
          <Building2 aria-hidden className="eco-icon" />
          <span>
            <b>{displayName || "Выберите поставщика"}</b>
            {selected?.inn ? <em>ИНН {selected.inn}</em> : null}
          </span>
        </button>
        {value ? (
          <div className="product-supplier-control__selected-actions">
            <button type="button" onClick={() => window.open(`/inventory/counterparties?search=${encodeURIComponent(displayName)}`, "_blank", "noopener,noreferrer")}>Открыть карточку</button>
            <button type="button" onClick={() => selectSupplier(null)} aria-label="Очистить поставщика"><X aria-hidden className="eco-icon" /></button>
          </div>
        ) : null}
      </div>
      {selected?.status === "ARCHIVED" ? <span className="product-editor-hint is-warning">Поставщик архивирован. Связь сохранена, выберите другого при необходимости.</span> : null}
      {popup}
      {quickOpen && typeof document !== "undefined" ? createPortal(
        <div className="product-supplier-modal-backdrop" role="presentation" onMouseDown={() => !quickSaving && setQuickOpen(false)}>
          <section className="product-supplier-modal" role="dialog" aria-modal="true" aria-labelledby="quick-supplier-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>Быстрое создание</span>
                <h3 id="quick-supplier-title">Новый поставщик</h3>
              </div>
              <button type="button" onClick={() => setQuickOpen(false)} aria-label="Закрыть"><X aria-hidden className="eco-icon" /></button>
            </header>
            <p>Поставщик будет создан в текущем филиале и сразу выбран в карточке товара.</p>
            <div className="product-supplier-modal__grid">
              <label>Название *<input value={quickForm.name} onChange={(event) => setQuickForm((form) => ({ ...form, name: event.target.value }))} autoFocus /></label>
              <label>Юридическая форма<select value={quickForm.legalForm} onChange={(event) => setQuickForm((form) => ({ ...form, legalForm: event.target.value as QuickSupplierForm["legalForm"] }))}><option value="LEGAL_ENTITY">ООО / АО / юрлицо</option><option value="SOLE_PROPRIETOR">ИП</option><option value="OTHER">Другое</option></select></label>
              <label>ИНН<input inputMode="numeric" value={quickForm.inn} onChange={(event) => setQuickForm((form) => ({ ...form, inn: event.target.value }))} /></label>
              <label>Телефон<input type="tel" value={quickForm.phone} onChange={(event) => setQuickForm((form) => ({ ...form, phone: event.target.value }))} /></label>
              <label className="is-full">Контактное лицо<input value={quickForm.contactPerson} onChange={(event) => setQuickForm((form) => ({ ...form, contactPerson: event.target.value }))} /></label>
            </div>
            {quickError ? <div className="product-supplier-modal__error">{quickError}</div> : null}
            {duplicates.length ? <div className="product-supplier-modal__duplicates">{duplicates.map((supplier) => <button key={supplier.id} type="button" onClick={() => { selectSupplier(supplier); setQuickOpen(false); }}><b>{supplier.displayName}</b><span>{supplier.inn ? `ИНН ${supplier.inn}` : "без ИНН"}</span></button>)}</div> : null}
            <footer>
              <button type="button" className="eco-btn eco-btn--ghost" onClick={() => setQuickOpen(false)} disabled={quickSaving}>Отмена</button>
              {duplicates.length ? <button type="button" className="eco-btn" onClick={() => void createSupplier(true)} disabled={quickSaving}>Всё равно создать</button> : null}
              <button type="button" className="eco-btn eco-btn--primary" onClick={() => void createSupplier()} disabled={quickSaving}>{quickSaving ? "Создаём…" : "Создать и выбрать"}</button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

export default function ProductsClient() {
  const searchParams = useSearchParams();
  const initialProductId = searchParams.get("product")?.trim() ?? "";
  const initialSearch = searchParams.get("search")?.trim() ?? "";
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [meta, setMeta] = useState<ProductListMeta | null>(null);
  const [matchedOutsideFilters, setMatchedOutsideFilters] = useState(0);
  const [search, setSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<ProductFilters>(emptyFilters);
  const [sort, setSort] = useState<ProductSortKey>("name");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [toast, setToast] = useState<ProductToast | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeProduct, setActiveProduct] = useState<ProductRow | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [formBaseline, setFormBaseline] = useState<ProductForm>(emptyForm);
  const [markingTouched, setMarkingTouched] = useState(false);
  const [formErrors, setFormErrors] = useState<ProductFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formSearch, setFormSearch] = useState("");
  const [editorGroupOptions, setEditorGroupOptions] = useState<string[]>([]);
  const [editorGroupsLoading, setEditorGroupsLoading] = useState(false);
  const [editorGroupsLoaded, setEditorGroupsLoaded] = useState(false);
  const [editorGroupsError, setEditorGroupsError] = useState<string | null>(null);
  const [extraOpen, setExtraOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [facetDialog, setFacetDialog] = useState<FacetKey | null>(null);
  const [facetDraftValues, setFacetDraftValues] = useState<string[]>([]);
  const [facetSearch, setFacetSearch] = useState("");
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [filtersSidebarReady, setFiltersSidebarReady] = useState(false);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<ActionMenuPosition | null>(null);
  const [archiveCandidate, setArchiveCandidate] = useState<ProductRow | null>(null);
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ProductImportMode>("upsert");
  const [importAllowNameMatching, setImportAllowNameMatching] = useState(true);
  const [importEmptyCellsClear, setImportEmptyCellsClear] = useState(false);
  const [importErrorMode, setImportErrorMode] = useState<ProductImportErrorMode>("validRows");
  const [importPreviewFilter, setImportPreviewFilter] = useState<ProductImportPreviewFilter>("all");
  const [importExcludedRows, setImportExcludedRows] = useState<number[]>([]);
  const [importJob, setImportJob] = useState<ProductImportJob | null>(null);
  const [importHistory, setImportHistory] = useState<ProductImportHistoryItem[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [rosskoPreviewOpen, setRosskoPreviewOpen] = useState(false);
  const [rosskoPreviewLoading, setRosskoPreviewLoading] = useState(false);
  const [rosskoPreviewError, setRosskoPreviewError] = useState<string | null>(null);
  const [rosskoPreviewQuery, setRosskoPreviewQuery] = useState("");
  const [rosskoPreviewItems, setRosskoPreviewItems] = useState<RosskoOemPreviewItem[]>([]);
  const [rosskoSelectedKeys, setRosskoSelectedKeys] = useState<string[]>([]);
  const facetOrderRef = useRef<FacetOrderState>(createFacetOrderState());
  const facetPreviewPinsRef = useRef<FacetPreviewPinState>(createFacetPreviewPinState());
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const loadMoreTargetRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const initialLoadStartedRef = useRef(false);

  const setActionMenuButtonRef = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) {
      actionMenuButtonRefs.current.set(id, node);
    } else {
      actionMenuButtonRefs.current.delete(id);
    }
  }, []);

  const updateActionMenuPosition = useCallback((rowId: string | null) => {
    if (!rowId || typeof window === "undefined") return;
    const reference = actionMenuButtonRefs.current.get(rowId);
    const floating = actionMenuRef.current;
    if (!reference?.isConnected || !floating) return;

    const referenceRect = reference.getBoundingClientRect();
    const floatingRect = floating.getBoundingClientRect();
    const floatingWidth = floatingRect.width || 236;
    const floatingHeight = floatingRect.height || 1;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = viewportWidth - floatingWidth - ACTION_MENU_VIEWPORT_PADDING;
    const maxTop = viewportHeight - floatingHeight - ACTION_MENU_VIEWPORT_PADDING;
    const bottomTop = referenceRect.bottom + ACTION_MENU_GAP;
    const topTop = referenceRect.top - floatingHeight - ACTION_MENU_GAP;
    const fitsBelow = bottomTop + floatingHeight + ACTION_MENU_VIEWPORT_PADDING <= viewportHeight;
    const placement: ActionMenuPosition["placement"] = fitsBelow || topTop < ACTION_MENU_VIEWPORT_PADDING
      ? "bottom-end"
      : "top-end";
    const nextTop = clampNumber(
      placement === "bottom-end" ? bottomTop : topTop,
      ACTION_MENU_VIEWPORT_PADDING,
      Math.max(ACTION_MENU_VIEWPORT_PADDING, maxTop)
    );
    const nextLeft = clampNumber(
      referenceRect.right - floatingWidth,
      ACTION_MENU_VIEWPORT_PADDING,
      Math.max(ACTION_MENU_VIEWPORT_PADDING, maxLeft)
    );
    const referenceCenter = referenceRect.left + referenceRect.width / 2;
    const arrowLeft = clampNumber(
      referenceCenter - nextLeft - ACTION_MENU_ARROW_SIZE / 2,
      14,
      Math.max(14, floatingWidth - ACTION_MENU_ARROW_SIZE - 14)
    );

    setActionMenuPosition((prev) => {
      const next = { top: nextTop, left: nextLeft, placement, arrowLeft };
      if (
        prev
        && Math.abs(prev.top - next.top) < 0.5
        && Math.abs(prev.left - next.left) < 0.5
        && Math.abs(prev.arrowLeft - next.arrowLeft) < 0.5
        && prev.placement === next.placement
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const loadEditorGroups = useCallback(async (force = false) => {
    if (!force && (editorGroupsLoaded || editorGroupsLoading)) return;
    setEditorGroupsLoading(true);
    setEditorGroupsError(null);
    try {
      const res = await fetch("/api/local-inventory/product-groups", { cache: "no-store" });
      const data = await readJson<ProductGroupsResponse>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить группы товаров");
      const groups = Array.isArray(data?.groups)
        ? data.groups.map((group) => group.trim()).filter(Boolean)
        : [];
      setEditorGroupOptions(groups);
      setEditorGroupsLoaded(true);
    } catch (e) {
      setEditorGroupsError(e instanceof Error ? e.message : "Не удалось загрузить группы товаров");
    } finally {
      setEditorGroupsLoading(false);
    }
  }, [editorGroupsLoaded, editorGroupsLoading]);

  const editingProduct = useMemo(
    () => activeProduct ?? rows.find((row) => row.id === editingId) ?? null,
    [activeProduct, editingId, rows]
  );
  const activeActionRow = useMemo(
    () => rows.find((row) => row.id === activeActionMenuId) ?? null,
    [activeActionMenuId, rows]
  );
  const editingName = editingProduct?.name ?? "";
  const filterOptions = meta?.filterOptions ?? emptyFilterOptions;
  const facets = meta?.facets ?? emptyFacets;
  const groupOptions = useMemo(() => {
    const source = editorGroupOptions.length ? editorGroupOptions : filterOptions.groups;
    const values = new Set(source);
    const currentGroup = form.groupPath.trim();
    if (currentGroup) values.add(currentGroup);
    return [...values].sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));
  }, [editorGroupOptions, filterOptions.groups, form.groupPath]);

  const activeFiltersCount = useMemo(
    () => Object.entries(filters).reduce((count, [key, value]) => {
      if (key === "stock") return count + (value !== "all" ? 1 : 0);
      if (key === "markingProblems") return count + (value === true ? 1 : 0);
      return count + (Array.isArray(value) ? value.length : 0);
    }, 0),
    [filters]
  );
  const hasActiveSearchOrFilters = Boolean(search.trim()) || activeFiltersCount > 0;
  const totalProductsLabel = (meta?.total ?? rows.length).toLocaleString("ru-RU");
  const visibleProductsLabel = `${rows.length.toLocaleString("ru-RU")}${meta?.hasMore ? "+" : ""}`;
  const filtersLayoutClass = [
    "eco-inventory-layout",
    filtersCollapsed ? "is-filter-collapsed" : "",
    filtersDrawerOpen ? "is-filter-drawer-open" : "",
  ].filter(Boolean).join(" ");
  const formDirty = useMemo(
    () => isProductFormDirty(form, formBaseline),
    [form, formBaseline]
  );
  const changedCriticalFields = useMemo(
    () => Object.entries(criticalFieldLabels)
      .filter(([key]) => form[key as keyof ProductForm] !== formBaseline[key as keyof ProductForm])
      .map(([, label]) => label)
      .filter(Boolean),
    [form, formBaseline]
  );
  const formSearchNeedle = useMemo(() => normalizeFieldSearch(formSearch), [formSearch]);
  const technicalFieldsMatched = useMemo(
    () => technicalFieldLabels.some((field) => {
      if (!formSearchNeedle) return false;
      const haystack = normalizeFieldSearch([field.key, field.label, ...(field.aliases ?? [])].join(" "));
      return haystack.includes(formSearchNeedle);
    }),
    [formSearchNeedle]
  );
  const highlightedEditorSections = useMemo(
    () => {
      const sections = new Set(
        productEditorSections
        .filter((section) => sectionMatchesSearch(section, formSearchNeedle))
        .map((section) => section.id)
      );
      const matched = matchedEditorSection(formSearchNeedle);
      if (matched) sections.add(matched);
      return sections;
    },
    [formSearchNeedle]
  );
  const matchedEditorSectionId = useMemo(() => matchedEditorSection(formSearchNeedle), [formSearchNeedle]);
  const salePriceDraft = useMemo(() => parseMoneyInput(form.salePrice), [form.salePrice]);
  const buyPriceDraft = useMemo(
    () => form.buyPrice.trim() ? parseMoneyInput(form.buyPrice) : null,
    [form.buyPrice]
  );
  const marginDraft = buyPriceDraft == null ? null : salePriceDraft - buyPriceDraft;
  const marginDraftPercent = marginDraft == null || salePriceDraft <= 0
    ? null
    : Math.round((marginDraft / salePriceDraft) * 100);
  const groupKind = productGroupKind(form);
  const hiddenFieldsForGroup = useMemo(() => hiddenCharacteristicLabels(form), [form]);
  const completionItems = useMemo(() => {
    const items = [
      { label: "Название", ok: Boolean(form.name.trim()) },
      { label: "Группа", ok: Boolean(form.groupPath.trim()) },
      { label: "Бренд", ok: Boolean(form.brand.trim()) },
      { label: "Код / штрихкод", ok: Boolean(form.code.trim() || form.barcodeEan13.trim() || form.barcodeEan8.trim() || form.barcodeCode128.trim()) },
      { label: "Единица", ok: Boolean(form.uomName.trim()) },
      { label: "Цена", ok: parseMoneyInput(form.salePrice) > 0 },
      { label: "Поставщик", ok: Boolean(form.supplierName.trim()) },
    ];
    if (groupKind === "oil") {
      items.push(
        { label: "SAE", ok: Boolean(form.sae.trim()) },
        { label: "Объём / фасовка", ok: Boolean(form.packageVolume.trim() || form.volume.trim()) },
        { label: "Маркировка", ok: !isMarkingEnabled(form) || formMarkingStatus(form) !== "CONFIG_ERROR" }
      );
    } else if (groupKind === "filter") {
      items.push(
        { label: "Артикул", ok: Boolean(form.article.trim()) },
        { label: "OEM Parts / аналоги", ok: Boolean(form.oemParts.trim() || form.oem.trim()) },
        { label: "Ячейка", ok: Boolean(form.cell.trim()) }
      );
    }
    return items;
  }, [form, groupKind]);
  const missingCompletionCount = completionItems.filter((item) => !item.ok).length;

  function buildListParams(
    nextSearch = search,
    nextSort = sort,
    nextDirection = direction,
    nextFilters = filters,
    offset = 0
  ) {
    const params = new URLSearchParams({ limit: String(PRODUCT_PAGE_LIMIT), offset: String(offset) });
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    params.set("sort", nextSort);
    params.set("direction", nextDirection);
    for (const [key, value] of Object.entries(nextFilters)) {
      if (key === "stock") {
        const stockValue = value as StockFilter;
        if (stockValue !== "all") params.set(key, stockValue);
      } else if (key === "markingProblems") {
        if (value === true) params.set(key, "1");
      } else if (Array.isArray(value)) {
        value.filter(Boolean).forEach((item) => params.append(key, item));
      }
    }
    return params;
  }

  async function load(nextSearch = search, nextSort = sort, nextDirection = direction, nextFilters = filters) {
    listAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setError(null);
    try {
      const params = buildListParams(nextSearch, nextSort, nextDirection, nextFilters);
      params.set("context", "products");
      const res = await fetch(`/api/catalog/search?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await readJson<ProductListResponse>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить товары");
      setRows(Array.isArray(data?.products) ? data.products : []);
      setMeta(data?.meta ?? null);
      setMatchedOutsideFilters(data?.matchedOutsideFilters ?? 0);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("[inventory-products] list load failed:", e);
      setError("Не удалось выполнить поиск");
      setRows([]);
      setMeta(null);
      setMatchedOutsideFilters(0);
    } finally {
      if (listAbortRef.current === controller) {
        listAbortRef.current = null;
        setLoading(false);
      }
    }
  }

  async function loadMore() {
    if (!meta?.hasMore || loading || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    try {
      const params = buildListParams(search, sort, direction, filters, rows.length);
      params.set("context", "products");
      const res = await fetch(`/api/catalog/search?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await readJson<ProductListResponse>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить товары");
      const nextProducts = Array.isArray(data?.products) ? data.products : [];
      setRows((prev) => {
        const seen = new Set(prev.map((row) => row.id));
        return [...prev, ...nextProducts.filter((row) => !seen.has(row.id))];
      });
      setMeta(data?.meta ?? null);
      setMatchedOutsideFilters(data?.matchedOutsideFilters ?? 0);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("[inventory-products] load more failed:", e);
      setError("Не удалось выполнить поиск");
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    return () => {
      listAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    try {
      setFiltersCollapsed(window.localStorage.getItem(FILTER_SIDEBAR_STORAGE_KEY) === "1");
    } catch {
      // localStorage can be unavailable in private or restricted contexts.
    } finally {
      setFiltersSidebarReady(true);
    }
  }, []);

  useEffect(() => {
    if (!filtersSidebarReady) return;
    try {
      window.localStorage.setItem(FILTER_SIDEBAR_STORAGE_KEY, filtersCollapsed ? "1" : "0");
    } catch {
      // Persisting the UI preference is optional.
    }
  }, [filtersCollapsed, filtersSidebarReady]);

  useEffect(() => {
    if (!activeActionMenuId) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      const reference = activeActionMenuId ? actionMenuButtonRefs.current.get(activeActionMenuId) : null;
      if (target instanceof Node && actionMenuRef.current?.contains(target)) return;
      if (target instanceof Node && reference?.contains(target)) return;
      setActiveActionMenuId(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveActionMenuId(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeActionMenuId]);

  useEffect(() => {
    if (!activeActionMenuId) {
      setActionMenuPosition(null);
      return;
    }
    if (!activeActionRow) {
      setActiveActionMenuId(null);
      setActionMenuPosition(null);
      return;
    }

    let frame = 0;
    function scheduleUpdate() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => updateActionMenuPosition(activeActionMenuId));
    }

    scheduleUpdate();
    const resizeObserver = typeof ResizeObserver !== "undefined" && actionMenuRef.current
      ? new ResizeObserver(scheduleUpdate)
      : null;
    if (actionMenuRef.current) resizeObserver?.observe(actionMenuRef.current);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [activeActionMenuId, activeActionRow, updateActionMenuPosition]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && exportMenuRef.current?.contains(target)) return;
      setExportMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setExportMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!archiveCandidate) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !archiveSaving) setArchiveCandidate(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [archiveCandidate, archiveSaving]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!formOpen || !matchedEditorSectionId || !formSearchNeedle) return;
    if (matchedEditorSectionId === "extra") setExtraOpen(true);
    if (matchedEditorSectionId === "technical") setTechnicalOpen(true);
    const timer = window.setTimeout(() => {
      document
        .getElementById(productEditorSectionElementId(matchedEditorSectionId))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [formOpen, formSearchNeedle, matchedEditorSectionId]);

  useEffect(() => {
    if (!formOpen) return;
    void loadEditorGroups();
  }, [formOpen, loadEditorGroups]);

  useEffect(() => {
    const delay = initialLoadStartedRef.current ? 320 : 0;
    initialLoadStartedRef.current = true;
    const timer = window.setTimeout(() => {
      void load(search, sort, direction, filters);
    }, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sort, direction, filters]);

  useEffect(() => {
    if (!initialProductId) return;
    let cancelled = false;
    async function openLinkedProduct() {
      setError(null);
      try {
        const res = await fetch(`/api/local-inventory/products/${encodeURIComponent(initialProductId)}`, {
          cache: "no-store",
        });
        const product = await readJson<ProductRow & { error?: string }>(res);
        if (!res.ok || !product) throw new Error(product?.error ?? "Товар не найден в локальной БД");
        if (cancelled) return;
        setRows((prev) => [product, ...prev.filter((row) => row.id !== product.id)]);
        openProductEditor(product);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void openLinkedProduct();
    return () => {
      cancelled = true;
    };
  }, [initialProductId]);

  useEffect(() => {
    const target = loadMoreTargetRef.current;
    if (!target || !meta?.hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.hasMore, rows.length, loading, loadingMore, search, sort, direction, filters]);


  function updateForm(patch: Partial<ProductForm>) {
    setForm((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [key, value] of Object.entries(patch) as Array<[keyof ProductForm, string]>) {
        if (next[key] !== value) {
          next[key] = value;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setFormError((prev) => (prev ? null : prev));
    setFormErrors((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(patch) as Array<keyof ProductForm>) {
        if (key in next) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  function updateMarkingForm(patch: Partial<ProductForm>) {
    setMarkingTouched(true);
    updateForm(patch);
  }

  function handleGroupPathChange(groupPath: string) {
    const groupDefault = productMarkingDefaultForGroup(groupPath);
    if (groupDefault === "NONE") {
      updateForm({ groupPath });
      return;
    }

    const defaults = applyMarkingDefaultsForGroup(form, groupPath);
    const manualScenario = isMarkingScenarioManuallyChanged(form, formBaseline);
    const scenarioAlreadyMatches =
      groupDefault === "PACKAGED"
        ? isMarkingEnabled(form) && formMarkingMode(form) === "PACKAGED_MARKED_GOOD"
        : isMarkingEnabled(form) && formMarkingMode(form) === "BULK_OIL_FROM_MARKED_BARREL";

    if (!manualScenario && !scenarioAlreadyMatches) {
      updateForm(defaults);
      setInfo(
        groupDefault === "PACKAGED"
          ? "Для группы канистр включена маркировка обычной упаковки."
          : "Для группы масла на разлив включён сценарий бочки. Продажа будет заблокирована до активной бочки."
      );
      return;
    }

    const message = groupDefault === "PACKAGED"
      ? "Для этой группы обычно используется маркировка обычной упаковки. Включить сценарий “Обычная упаковка — код списывается целиком”?"
      : "Для масла на разлив нужен отдельный сценарий бочки. Обычная маркированная упаковка здесь опасна: код может быть списан целиком. Настроить как масло на разлив?";

    if (window.confirm(message)) {
      updateForm(defaults);
      return;
    }

    updateForm(
      groupDefault === "BULK_OIL"
        ? { groupPath, markingEnabled: "false", markingMode: "NOT_MARKED" }
        : { groupPath }
    );
  }

  function resetForm() {
    setEditingId(null);
    setActiveProduct(null);
    setForm(emptyForm);
    setFormBaseline(emptyForm);
    setMarkingTouched(false);
    setFormErrors({});
    setFormError(null);
    setFormSearch("");
    setExtraOpen(false);
    setTechnicalOpen(false);
    setNewGroupMode(false);
    setUploadingPhotos(false);
    setDeletingPhotoId(null);
    setFormOpen(false);
  }

  function openNewProduct() {
    setEditingId(null);
    setActiveProduct(null);
    setForm(emptyForm);
    setFormBaseline(emptyForm);
    setMarkingTouched(false);
    setFormErrors({});
    setFormError(null);
    setFormSearch("");
    setExtraOpen(false);
    setTechnicalOpen(false);
    setNewGroupMode(false);
    setUploadingPhotos(false);
    setDeletingPhotoId(null);
    setInfo(null);
    setError(null);
    setFormOpen(true);
  }

  function openSimilarProduct(product: ProductRow) {
    const nextForm = {
      ...formFromProduct(product),
      name: `Копия: ${product.name}`,
      article: "",
      code: "",
      externalCode: "",
      barcodeEan13: "",
      barcodeEan8: "",
      barcodeCode128: "",
      rosskoPartNumber: "",
    };
    setEditingId(null);
    setActiveProduct(null);
    setForm(nextForm);
    setFormBaseline(emptyForm);
    setMarkingTouched(false);
    setFormErrors({});
    setFormError("Проверьте артикул или код перед сохранением похожего товара.");
    setFormSearch("");
    setExtraOpen(false);
    setTechnicalOpen(false);
    setNewGroupMode(false);
    setUploadingPhotos(false);
    setDeletingPhotoId(null);
    setInfo(null);
    setError(null);
    setFormOpen(true);
  }

  function openProductEditor(product: ProductRow) {
    const nextForm = formFromProduct(product);
    setEditingId(product.id);
    setActiveProduct(product);
    setForm(nextForm);
    setFormBaseline(nextForm);
    setMarkingTouched(false);
    setFormErrors({});
    setFormError(null);
    setFormSearch("");
    setExtraOpen(false);
    setTechnicalOpen(false);
    setNewGroupMode(false);
    setUploadingPhotos(false);
    setDeletingPhotoId(null);
    setInfo(null);
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (formDirty && !window.confirm("Закрыть карточку без сохранения изменений?")) return;
    resetForm();
  }

  function changeSort(key: ProductSortKey) {
    const option = sortOptions.find((item) => item.key === key);
    const nextDirection = sort === key
      ? direction === "asc" ? "desc" : "asc"
      : option?.defaultDirection ?? "asc";
    setSort(key);
    setDirection(nextDirection);
  }

  function closeFilterDrawerOnMobile() {
    if (typeof window !== "undefined" && window.matchMedia(FILTER_MOBILE_QUERY).matches) {
      setFiltersDrawerOpen(false);
    }
  }

  function pinFacetPreviewValue(key: FacetKey, value: string) {
    const stableKey = facetStableKey(key, value);
    if (stableKey) facetPreviewPinsRef.current[key].add(stableKey);
  }

  function changeStockFilter(value: StockFilter) {
    setFilters((prev) => ({ ...prev, stock: value }));
    closeFilterDrawerOnMobile();
  }

  function toggleMarkingProblemsFilter() {
    setFilters((prev) => ({ ...prev, markingProblems: !prev.markingProblems }));
    closeFilterDrawerOnMobile();
  }

  function toggleFilterValue(key: MultiFilterKey, value: string) {
    pinFacetPreviewValue(key, value);
    setFilters((prev) => {
      const nextValues = prev[key].includes(value)
        ? prev[key].filter((item) => item !== value)
        : [...prev[key], value];
      return { ...prev, [key]: nextValues };
    });
    closeFilterDrawerOnMobile();
  }

  function resetFilters() {
    setFilters(emptyFilters);
  }

  function resetAll() {
    setSearch("");
    setFilters(emptyFilters);
  }

  function buildExportParams(scope: "all" | "current" | "selected" | "active" | "archived") {
    const params = new URLSearchParams();
    params.set("scope", scope);
    if (scope === "selected") params.set("ids", selectedProductIds.join(","));
    if (scope === "current") {
      if (search.trim()) params.set("search", search.trim());
      for (const [key, value] of Object.entries(filters)) {
        if (key === "stock") {
          const stockValue = value as StockFilter;
          if (stockValue !== "all") params.set(key, stockValue);
        } else if (key === "markingProblems") {
          if (value === true) params.set(key, "1");
        } else if (Array.isArray(value)) {
          value.filter(Boolean).forEach((item) => params.append(key, item));
        }
      }
    }
    return params;
  }

  function downloadProductsExport(scope: "all" | "current" | "selected" | "active" | "archived") {
    if (scope === "selected" && selectedProductIds.length === 0) {
      setToast({ message: "Выберите товары чекбоксами перед экспортом." });
      return;
    }
    const params = buildExportParams(scope);
    window.location.href = `/api/products/export?${params.toString()}`;
    setExportMenuOpen(false);
  }

  function downloadTemplate() {
    window.location.href = "/api/products/export-template";
    setExportMenuOpen(false);
  }

  function resetImportWizard() {
    setImportFile(null);
    setImportJob(null);
    setImportExcludedRows([]);
    setImportPreviewFilter("all");
    setImportError(null);
    if (importFileInputRef.current) importFileInputRef.current.value = "";
  }

  function openImportWizard() {
    resetImportWizard();
    setImportOpen(true);
    void loadImportHistory();
  }

  function openImportHistory() {
    resetImportWizard();
    setImportOpen(true);
    void loadImportHistory();
  }

  function importOptions() {
    return {
      mode: importMode,
      allowNameMatching: importAllowNameMatching,
      emptyCellsClear: importEmptyCellsClear,
      errorMode: importErrorMode,
      excludedRowIds: importExcludedRows.map(String),
    };
  }

  async function validateImportFile() {
    if (!importFile) {
      setImportError("Выберите Excel-файл .xlsx");
      return;
    }
    setImportBusy(true);
    setImportError(null);
    try {
      const body = new FormData();
      body.append("file", importFile);
      body.append("options", JSON.stringify(importOptions()));
      const res = await fetch("/api/products/import/validate", { method: "POST", body });
      const data = await readJson<ProductImportJob & { error?: string }>(res);
      if (!res.ok || !data) throw new Error(data?.error ?? "Не удалось проверить файл");
      setImportJob(data);
      setImportExcludedRows([]);
      void loadImportHistory();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }

  async function executeImportJob() {
    if (!importJob) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const res = await fetch("/api/products/import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: importJob.id, options: importOptions() }),
      });
      const data = await readJson<ProductImportJob & { error?: string }>(res);
      if (!res.ok || !data) throw new Error(data?.error ?? "Не удалось выполнить импорт");
      setImportJob(data);
      setToast({ message: `Импорт завершён: создано ${data.createdRows}, обновлено ${data.updatedRows}.` });
      void loadImportHistory();
      void load(search, sort, direction, filters);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }

  async function rollbackImportJob() {
    if (!importJob || !window.confirm("Отменить изменения этого импорта?")) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const res = await fetch(`/api/products/import/${encodeURIComponent(importJob.id)}/rollback`, { method: "POST" });
      const data = await readJson<{ rolledBack?: number; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось отменить импорт");
      const fresh = await fetch(`/api/products/import/${encodeURIComponent(importJob.id)}`, { cache: "no-store" });
      const job = await readJson<ProductImportJob>(fresh);
      if (job) setImportJob(job);
      setToast({ message: `Откат выполнен: ${data?.rolledBack ?? 0} строк.` });
      void loadImportHistory();
      void load(search, sort, direction, filters);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }

  async function loadImportHistory() {
    try {
      const res = await fetch("/api/products/import?limit=20", { cache: "no-store" });
      const data = await readJson<{ jobs?: ProductImportHistoryItem[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить историю");
      setImportHistory(Array.isArray(data?.jobs) ? data.jobs : []);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openImportJobDetails(jobId: string) {
    setImportBusy(true);
    setImportError(null);
    try {
      const res = await fetch(`/api/products/import/${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = await readJson<ProductImportJob & { error?: string }>(res);
      if (!res.ok || !data) throw new Error(data?.error ?? "Не удалось открыть импорт");
      setImportJob(data);
      setImportExcludedRows([]);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }

  function toggleImportRow(rowNumber: number) {
    setImportExcludedRows((prev) => (
      prev.includes(rowNumber) ? prev.filter((item) => item !== rowNumber) : [...prev, rowNumber]
    ));
  }

  function toggleProductSelection(id: string) {
    setSelectedProductIds((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ));
  }

  function toggleVisibleProductsSelection() {
    const visibleIds = rows.map((row) => row.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedProductIds.includes(id));
    setSelectedProductIds((prev) => (
      allSelected
        ? prev.filter((id) => !visibleIds.includes(id))
        : [...new Set([...prev, ...visibleIds])]
    ));
  }

  function removeFilterValue(key: MultiFilterKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: prev[key].filter((item) => item !== value) }));
  }

  function openFacetDialog(key: FacetKey) {
    setFacetDialog(key);
    setFacetDraftValues([...selectedFilterValues(filters, key)]);
    setFacetSearch("");
  }

  function closeFacetDialog() {
    setFacetDialog(null);
    setFacetDraftValues([]);
    setFacetSearch("");
  }

  function toggleFacetDraftValue(value: string) {
    setFacetDraftValues((prev) => (
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    ));
  }

  function applyFacetDialog() {
    if (!facetDialog) return;
    setFilters((prev) => ({ ...prev, [facetDialog]: facetDraftValues }));
    closeFacetDialog();
    closeFilterDrawerOnMobile();
  }

  function clearFacetDialog() {
    setFacetDraftValues([]);
  }

  function sortIndicator(key: ProductSortKey) {
    if (sort !== key) return "↕";
    return direction === "asc" ? "↑" : "↓";
  }

  function sortHeader(label: string, key: ProductSortKey, align: "left" | "right" = "left") {
    return (
      <button
        type="button"
        onClick={() => changeSort(key)}
        className={`eco-product-sort ${align === "right" ? "is-right" : ""}`}
      >
        <span>{label}</span>
        <span className={`eco-product-sort-indicator ${sort === key ? "is-active" : ""}`}>{sortIndicator(key)}</span>
      </button>
    );
  }

  function rememberFacetOrder(key: FacetKey, options: ProductFacetOption[]) {
    const order = facetOrderRef.current[key];
    const seededOptions = [...options].sort((a, b) => compareFacetInitialOrder(key, a, b));
    for (const option of seededOptions) {
      const stableKey = facetStableKey(key, option.value);
      if (!stableKey || order.has(stableKey)) continue;
      order.set(stableKey, order.size);
    }
  }

  function getFacetOptions(key: FacetKey) {
    const facetKey = facetOptionsKey(key);
    const fromFacets = facets[facetKey];
    const rawOptions = Array.isArray(fromFacets) && fromFacets.length
      ? fromFacets
      : (filterOptions[fallbackFilterOptionsKey(key)] as string[]).map((value) => ({ value, count: 0 }));
    const options = key === "group"
      ? uniqueGroupsByLabel(rawOptions.map((option) => option.value)).map((value) => {
          const matching = rawOptions.find((option) => normalizedGroupLabel(option.value) === normalizedGroupLabel(value));
          return { value, count: matching?.count ?? 0 };
        })
      : [...rawOptions];
    const selectedValues = selectedFilterValues(filters, key);
    const selectedKeys = new Set(options.map((option) => facetStableKey(key, option.value)));
    for (const value of selectedValues) {
      const stableKey = facetStableKey(key, value);
      if (!stableKey || selectedKeys.has(stableKey)) continue;
      options.push({ value, count: 0 });
      selectedKeys.add(stableKey);
    }
    const cleanedOptions = options.filter((option) => option.value && option.value !== "-");
    rememberFacetOrder(key, cleanedOptions);
    return [...cleanedOptions]
      .sort((a, b) => {
        const order = facetOrderRef.current[key];
        const orderDiff = (order.get(facetStableKey(key, a.value)) ?? Number.MAX_SAFE_INTEGER)
          - (order.get(facetStableKey(key, b.value)) ?? Number.MAX_SAFE_INTEGER);
        if (orderDiff !== 0) return orderDiff;
        return filterLabel(key, a.value).localeCompare(filterLabel(key, b.value), "ru", { numeric: true, sensitivity: "base" });
      });
  }

  function renderFacetFilter(key: FacetKey, previewCount = 6) {
    const options = getFacetOptions(key);
    const selected = selectedFilterValues(filters, key);
    const selectedSet = new Set(selected.map((value) => facetStableKey(key, value)));
    const pinnedSet = facetPreviewPinsRef.current[key];
    const preview = options.filter((option, index) => {
      const stableKey = facetStableKey(key, option.value);
      return index < previewCount || selectedSet.has(stableKey) || pinnedSet.has(stableKey);
    });
    return (
      <div className="eco-filter-group">
        <div className="eco-filter-title">{facetLabels[key].title}</div>
        {preview.length ? (
          <div className="eco-filter-list">
            {preview.map((option) => {
              const active = selected.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`eco-filter-row ${active ? "is-active" : ""}`}
                  onClick={() => toggleFilterValue(key, option.value)}
                >
                  <span className="eco-filter-row-label">
                    <span className={`eco-check ${active ? "is-checked" : ""}`} />
                    {filterLabel(key, option.value)}
                  </span>
                  <span className="ct">{option.count.toLocaleString("ru-RU")}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="eco-filter-empty">Нет значений</div>
        )}
        {options.length > previewCount ? (
          <button type="button" className="eco-filter-more" onClick={() => openFacetDialog(key)}>
            {facetLabels[key].all}
          </button>
        ) : null}
      </div>
    );
  }

  function activeFilterChips() {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (search.trim()) {
      chips.push({ key: "search", label: `Поиск: ${search.trim()}`, onRemove: () => setSearch("") });
    }
    (["group", "brand", "sae", "supplier", "apiSpec", "acea", "packageVolume", "entityType"] as FacetKey[]).forEach((key) => {
      selectedFilterValues(filters, key).forEach((value) => {
        chips.push({
          key: `${key}:${value}`,
          label: `${facetLabels[key].title}: ${filterLabel(key, value)}`,
          onRemove: () => removeFilterValue(key, value),
        });
      });
    });
    if (filters.stock !== "all") {
      chips.push({
        key: "stock",
        label: `Остаток: ${stockOptions.find((option) => option.value === filters.stock)?.label ?? filters.stock}`,
        onRemove: () => changeStockFilter("all"),
      });
    }
    if (filters.markingProblems) {
      chips.push({
        key: "markingProblems",
        label: "Проблемы маркировки",
        onRemove: () => setFilters((prev) => ({ ...prev, markingProblems: false })),
      });
    }
    return chips;
  }

  function emptyStateCopy() {
    if (!search.trim() && activeFiltersCount === 0) {
      return {
        title: "Товаров пока нет",
        text: "Создайте товар или проверьте импорт локального склада.",
      };
    }
    if (search.trim() && activeFiltersCount > 0) {
      if (matchedOutsideFilters > 0) {
        return {
          title: "Есть результаты вне фильтров",
          text: `По запросу "${search.trim()}" найдено ${matchedOutsideFilters.toLocaleString("ru-RU")} товаров вне текущих фильтров.`,
        };
      }
      return {
        title: "Товары не найдены",
        text: `По запросу "${search.trim()}" и выбранным фильтрам ничего не найдено.`,
      };
    }
    if (search.trim()) {
      return {
        title: "Товары не найдены",
        text: `По запросу "${search.trim()}" ничего не найдено.`,
      };
    }
    return {
      title: "Товары не найдены",
      text: "По выбранным фильтрам ничего не найдено.",
    };
  }

  function renderSkeletonRows() {
    return Array.from({ length: 7 }, (_, index) => (
      <tr key={`skeleton-${index}`} className="eco-product-skeleton-row">
        {Array.from({ length: 9 }, (_cell, cellIndex) => (
          <td key={cellIndex}>
            <span className="eco-product-skeleton-line" />
          </td>
        ))}
      </tr>
    ));
  }

  function renderRowActionsMenu(row: ProductRow) {
    const isOpen = activeActionMenuId === row.id;
    return (
      <div className="eco-product-actions-menu-wrap">
        <button
          ref={(node) => setActionMenuButtonRef(row.id, node)}
          type="button"
          className="eco-icon-action"
          title="Действия"
          aria-label="Действия"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={(event) => {
            event.stopPropagation();
            setActionMenuPosition(null);
            setActiveActionMenuId((current) => current === row.id ? null : row.id);
          }}
        >
          <MoreHorizontal aria-hidden className="eco-icon" />
        </button>
      </div>
    );
  }

  function renderActionMenuPortal() {
    if (!activeActionRow || typeof document === "undefined") return null;
    const menuStyle = {
      top: actionMenuPosition?.top ?? -9999,
      left: actionMenuPosition?.left ?? -9999,
      visibility: actionMenuPosition ? "visible" : "hidden",
      "--eco-action-menu-arrow-left": `${actionMenuPosition?.arrowLeft ?? 18}px`,
    } as CSSProperties;

    return createPortal(
      <div
        ref={actionMenuRef}
        className={`eco-product-actions-menu eco-product-actions-menu--floating ${
          actionMenuPosition?.placement === "top-end" ? "is-top" : "is-bottom"
        }`}
        role="menu"
        style={menuStyle}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setActiveActionMenuId(null);
            openProductEditor(activeActionRow);
          }}
        >
          <PackageOpen aria-hidden className="eco-icon" />
          <span>Открыть карточку</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setActiveActionMenuId(null);
            openProductEditor(activeActionRow);
          }}
        >
          <Pencil aria-hidden className="eco-icon" />
          <span>Редактировать</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setActiveActionMenuId(null);
            openSimilarProduct(activeActionRow);
          }}
        >
          <Copy aria-hidden className="eco-icon" />
          <span>Создать похожий</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setActiveActionMenuId(null);
            openProductHistory(activeActionRow);
          }}
        >
          <History aria-hidden className="eco-icon" />
          <span>История / движения</span>
        </button>
        <div className="eco-product-actions-separator" role="separator" />
        {activeActionRow.archived ? (
          <button
            type="button"
            role="menuitem"
            className="is-restore"
            onClick={() => {
              setActiveActionMenuId(null);
              void restoreProduct(activeActionRow);
            }}
          >
            <ArchiveRestore aria-hidden className="eco-icon" />
            <span>Восстановить из архива</span>
          </button>
        ) : (
          <button
            type="button"
            role="menuitem"
            className="is-destructive"
            onClick={() => {
              setActiveActionMenuId(null);
              requestArchive(activeActionRow);
            }}
          >
            <Archive aria-hidden className="eco-icon" />
            <span>В архив</span>
          </button>
        )}
      </div>,
      document.body
    );
  }

  function rosskoPreviewPayload() {
    return {
      article: form.article.trim(),
      code: form.code.trim(),
      oem: form.oem.trim() || form.oemParts.trim(),
      brand: form.brand.trim(),
      category: form.groupPath.trim(),
      productName: form.name.trim(),
      supplierCode: form.rosskoPartNumber.trim(),
    };
  }

  async function requestRosskoOemPreview() {
    setRosskoPreviewOpen(true);
    setRosskoPreviewLoading(true);
    setRosskoPreviewError(null);
    setRosskoPreviewItems([]);
    setRosskoSelectedKeys([]);
    try {
      const res = await fetch("/api/products/rossko/oem-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rosskoPreviewPayload()),
      });
      const data = await readJson<RosskoOemPreviewResponse>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось получить данные ROSSKO");
      const items = Array.isArray(data?.items) ? data.items : [];
      setRosskoPreviewQuery(data?.query ?? "");
      setRosskoPreviewItems(items);
      setRosskoSelectedKeys(items.slice(0, Math.min(items.length, 12)).map((item) => item.key));
      if (!items.length) setRosskoPreviewError("По этому артикулу ROSSKO не нашёл аналогов.");
    } catch (e) {
      setRosskoPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setRosskoPreviewLoading(false);
    }
  }

  function applyRosskoPreview() {
    const selected = rosskoPreviewItems.filter((item) => rosskoSelectedKeys.includes(item.key));
    if (!selected.length) {
      setRosskoPreviewError("Выберите хотя бы один найденный аналог.");
      return;
    }
    updateForm({
      oemParts: mergeTextList(form.oemParts, selected.flatMap((item) => [item.oem, item.partNumber].filter(Boolean))),
      rosskoBrand: form.rosskoBrand || selected.find((item) => item.brand)?.brand || "",
      rosskoPartNumber: form.rosskoPartNumber || selected.find((item) => item.partNumber)?.partNumber || "",
    });
    setRosskoPreviewOpen(false);
  }

  function toggleRosskoPreviewItem(key: string) {
    setRosskoSelectedKeys((prev) => (
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    ));
  }

  async function submit(closeAfter = false) {
    const validation = validateProductForm(form);
    if (Object.keys(validation).length) {
      setFormErrors(validation);
      setFormError("Проверьте обязательные поля перед сохранением.");
      return;
    }

    setSaving(true);
    setError(null);
    setFormError(null);
    setInfo(null);
    try {
      const payload = {
        name: form.name.trim(),
        article: form.article.trim() || undefined,
        code: form.code.trim() || undefined,
        externalCode: form.externalCode.trim() || undefined,
        groupPath: form.groupPath.trim() || undefined,
        uomName: form.uomName.trim() || undefined,
        entityType: form.entityType,
        salePrice: parseMoneyInput(form.salePrice),
        buyPrice: form.buyPrice.trim() ? parseMoneyInput(form.buyPrice) : null,
        currencyName: form.currencyName.trim() || "руб.",
        minimumBalance: form.minimumBalance.trim() || null,
        barcodeEan13: form.barcodeEan13.trim() || undefined,
        barcodeEan8: form.barcodeEan8.trim() || undefined,
        barcodeCode128: form.barcodeCode128.trim() || undefined,
        description: form.description.trim() || undefined,
        minPrice: form.minPrice.trim() ? parseMoneyInput(form.minPrice) : null,
        minPriceCurrencyName: form.minPriceCurrencyName.trim() || undefined,
        countryName: form.countryName.trim() || undefined,
        vatLabel: form.vatLabel.trim() || undefined,
        supplierCounterpartyId: form.supplierCounterpartyId || null,
        weight: form.weight.trim() || null,
        volume: form.volume.trim() || null,
        modificationCode: form.modificationCode.trim() || undefined,
        tnvedCode: form.tnvedCode.trim() || undefined,
        sae: form.sae.trim() || undefined,
        oem: form.oem.trim() || undefined,
        acea: form.acea.trim() || undefined,
        apiSpec: form.apiSpec.trim() || undefined,
        packageVolume: form.packageVolume.trim() || undefined,
        avito: form.avito === "" ? null : form.avito === "true",
        brand: form.brand.trim() || undefined,
        atf: form.atf.trim() || undefined,
        ilsac: form.ilsac.trim() || undefined,
        aceaExtra: form.aceaExtra.trim() || undefined,
        oemAtf: form.oemAtf.trim() || undefined,
        rosskoPartNumber: form.rosskoPartNumber.trim() || undefined,
        rosskoBrand: form.rosskoBrand.trim() || undefined,
        rosskoMin: form.rosskoMin.trim() || undefined,
        supplierAttribute: form.supplierAttribute.trim() || undefined,
        oemParts: form.oemParts.trim() || undefined,
        cell: form.cell.trim() || undefined,
        mannCharacteristicName: form.mannCharacteristicName.trim() || undefined,
        markingEnabled: isMarkingEnabled(form),
        markingMode: formMarkingMode(form),
        markingConfiguredManually: Boolean(editingProduct?.markingConfiguredManually) || markingTouched,
        markingSettings: formMarkingMode(form) === "BULK_OIL_FROM_MARKED_BARREL"
          ? {
              allowRepeatedBarrelCode: form.markingAllowRepeatedBarrelCode === "true",
              partialWithdrawalEnabled: form.markingPartialWithdrawalEnabled === "true",
              allowSaleWithoutActiveBarrel: form.markingAllowSaleWithoutActiveBarrel === "true",
              declaredVolumeLiters: form.markingDeclaredVolumeLiters.trim() || null,
              nonDrainableRemainderPercent: form.markingNonDrainableRemainderPercent.trim() || null,
              activeBarrelName: form.markingActiveBarrelName.trim(),
              activeBarrelMarkingCode: form.markingActiveBarrelCode.trim(),
              activeBarrelGtin: form.markingActiveBarrelGtin.trim(),
              verificationStatus: form.markingVerificationStatus.trim(),
              currentVolumeLiters: form.markingCurrentVolumeLiters.trim() || null,
            }
          : null,
      };
      const res = await fetch(
        editingId ? `/api/local-inventory/products/${editingId}` : "/api/local-inventory/products",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await readJson<ProductRow & { error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось сохранить товар");
      if (!data) throw new Error("Сервер не вернул карточку товара");
      const savedForm = formFromProduct(data);
      const savedGroup = data.groupPath?.trim();
      if (savedGroup) {
        setEditorGroupOptions((prev) => (
          prev.includes(savedGroup)
            ? prev
            : [...prev, savedGroup].sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }))
        ));
        setEditorGroupsLoaded(true);
      }
      setRows((prev) => [data, ...prev.filter((row) => row.id !== data.id)]);
      setActiveProduct(data);
      setEditingId(data.id);
      setForm(savedForm);
      setFormBaseline(savedForm);
      setMarkingTouched(false);
      setFormErrors({});
      if (closeAfter) {
        setInfo(editingId ? "Товар обновлён" : "Товар добавлен");
        resetForm();
        await load(search, sort, direction, filters);
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function openProductHistory(row: ProductRow) {
    setActiveActionMenuId(null);
    setToast({ message: `История движений для "${row.name}" пока не подключена` });
  }

  function requestArchive(row: ProductRow) {
    setActiveActionMenuId(null);
    setArchiveCandidate(row);
  }

  async function archiveProduct(row: ProductRow) {
    setError(null);
    setArchiveSaving(true);
    try {
      const res = await fetch(`/api/local-inventory/products/${row.id}`, { method: "DELETE" });
      const data = await readJson<(ProductRow & { error?: string }) | { error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось перенести товар в архив");
      const archivedProduct = data && "id" in data ? data : null;
      if (archivedProduct && editingId === archivedProduct.id) {
        const nextForm = formFromProduct(archivedProduct);
        setActiveProduct(archivedProduct);
        setForm(nextForm);
        setFormBaseline(nextForm);
      }
      setArchiveCandidate(null);
      setToast({
        message: "Товар перенесён в архив",
        actionLabel: "Отменить",
        onAction: () => void restoreProduct(row, { silent: true }),
      });
      await load(search, sort, direction, filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setArchiveSaving(false);
    }
  }

  async function restoreProduct(row: ProductRow, options: { silent?: boolean } = {}) {
    setActiveActionMenuId(null);
    setError(null);
    try {
      const res = await fetch(`/api/local-inventory/products/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      const data = await readJson<ProductRow & { error?: string }>(res);
      if (!res.ok || !data) throw new Error(data?.error ?? "Не удалось восстановить товар из архива");
      setRows((prev) => [data, ...prev.filter((item) => item.id !== data.id)]);
      if (editingId === data.id) {
        const nextForm = formFromProduct(data);
        setActiveProduct(data);
        setForm(nextForm);
        setFormBaseline(nextForm);
      }
      setToast({ message: options.silent ? "Архивация отменена" : "Товар восстановлен из архива" });
      await load(search, sort, direction, filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function refreshProduct(productId: string) {
    const res = await fetch(`/api/local-inventory/products/${encodeURIComponent(productId)}`, {
      cache: "no-store",
    });
    const product = await readJson<ProductRow & { error?: string }>(res);
    if (!res.ok || !product) throw new Error(product?.error ?? "Не удалось обновить карточку товара");
    setRows((prev) => [product, ...prev.filter((row) => row.id !== product.id)]);
    setActiveProduct(product);
    return product;
  }

  async function uploadProductPhotos(fileList: FileList | null) {
    if (!editingId || !fileList?.length) return;
    const files = Array.from(fileList);
    setUploadingPhotos(true);
    setError(null);
    setInfo(null);
    try {
      const formData = new FormData();
      for (const file of files) {
        if (!file.type.startsWith("image/")) throw new Error("Можно прикреплять только изображения");
        formData.append("files", file);
      }
      const res = await fetch(`/api/local-inventory/products/${editingId}/photos`, {
        method: "POST",
        body: formData,
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить фото");
      setInfo(files.length === 1 ? "Фото прикреплено" : `Фото прикреплены: ${files.length}`);
      await refreshProduct(editingId);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingPhotos(false);
    }
  }

  async function deleteProductPhoto(photoId: string) {
    if (!editingId) return;
    setDeletingPhotoId(photoId);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/local-inventory/products/${editingId}/photos/${photoId}`, { method: "DELETE" });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось удалить фото");
      setInfo("Фото удалено");
      await refreshProduct(editingId);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingPhotoId(null);
    }
  }

  function prepareEditorSection(sectionId: ProductEditorSectionId) {
    if (sectionId === "technical") setTechnicalOpen(true);
  }

  function fieldMatches(key: keyof ProductForm, label: string, aliases: string[] = []) {
    if (!formSearchNeedle) return false;
    const haystack = normalizeFieldSearch([key, label, ...aliases].join(" "));
    return haystack.includes(formSearchNeedle) || formSearchNeedle.includes(haystack);
  }

  function renderField(key: keyof ProductForm, label: string, options: ProductFieldRenderOptions = {}) {
    const isHighlighted = fieldMatches(key, label, options.aliases);
    const errorMessage = formErrors[key];
    const tags = [
      searchImpactFields.has(key) ? { label: "поиск", title: "Это поле участвует в поиске товара" } : null,
      shipmentImpactFields.has(key) ? { label: "отгрузка", title: "Это поле важно для продажи и отгрузки" } : null,
    ].filter((tag): tag is { label: string; title: string } => Boolean(tag));
    const fieldClass = [
      "product-editor-field",
      options.full ? "is-full" : "",
      isHighlighted ? "is-highlighted" : "",
      errorMessage ? "has-error" : "",
    ].filter(Boolean).join(" ");
    const inputClass = `eco-input product-editor-input ${errorMessage ? "has-error" : ""}`;
    const inputId = `product-field-${String(key)}`;

    return (
      <label key={key} htmlFor={inputId} className={fieldClass}>
        <span className="product-editor-label">
          <span>
            {label}
            {options.required ? <b aria-hidden="true"> *</b> : null}
          </span>
          {tags.length ? (
            <span className="product-editor-label-tags">
              {tags.map((tag) => <em key={tag.label} title={tag.title}>{tag.label}</em>)}
            </span>
          ) : null}
        </span>
        {options.type === "textarea" ? (
          <ProductEditorBufferedInput
            id={inputId}
            value={form[key]}
            rows={options.rows ?? 3}
            placeholder={options.placeholder}
            className={inputClass}
            onCommit={(value) => {
              if (String(key).startsWith("marking")) setMarkingTouched(true);
              updateForm({ [key]: value } as Partial<ProductForm>);
            }}
          />
        ) : options.type === "money" ? (
          <ProductEditorBufferedMoneyInput
            id={inputId}
            value={form[key]}
            placeholder={options.placeholder}
            className={inputClass}
            onCommit={(value) => {
              if (String(key).startsWith("marking")) setMarkingTouched(true);
              updateForm({ [key]: value } as Partial<ProductForm>);
            }}
          />
        ) : (
          <ProductEditorBufferedInput
            id={inputId}
            type={options.type === "number" ? "number" : "text"}
            step={options.step ?? (options.type === "number" ? "0.001" : undefined)}
            value={form[key]}
            placeholder={options.placeholder}
            className={inputClass}
            onCommit={(value) => {
              if (String(key).startsWith("marking")) setMarkingTouched(true);
              updateForm({ [key]: value } as Partial<ProductForm>);
            }}
          />
        )}
        {options.hint ? <span className="product-editor-hint">{options.hint}</span> : null}
        {errorMessage ? <span className="product-editor-error">{errorMessage}</span> : null}
      </label>
    );
  }

  function renderEntityTypeField() {
    const key: keyof ProductForm = "entityType";
    const errorMessage = formErrors[key];
    return (
      <label className={`product-editor-field ${fieldMatches(key, "Тип", ["товар услуга"]) ? "is-highlighted" : ""} ${errorMessage ? "has-error" : ""}`}>
        <span className="product-editor-label">
          <span>Тип *</span>
          <span className="product-editor-label-tags">
            <em title="Это поле важно для продажи и отгрузки">отгрузка</em>
          </span>
        </span>
        <select
          value={form.entityType}
          onChange={(event) => updateForm({ entityType: event.target.value })}
          className={`eco-input product-editor-input ${errorMessage ? "has-error" : ""}`}
        >
          <option value="product">Товар</option>
          <option value="variant">Модификация</option>
          <option value="bundle">Комплект</option>
          <option value="service">Услуга</option>
        </select>
        {errorMessage ? <span className="product-editor-error">{errorMessage}</span> : null}
      </label>
    );
  }

  function renderGroupField() {
    const key: keyof ProductForm = "groupPath";
    const errorMessage = formErrors[key];
    return (
      <label className={`product-editor-field ${fieldMatches(key, "Группа", ["категория"]) ? "is-highlighted" : ""} ${errorMessage ? "has-error" : ""}`}>
        <span className="product-editor-label">
          <span>Группа</span>
          <span className="product-editor-label-tags">
            <em title="Это поле участвует в поиске товара">поиск</em>
          </span>
        </span>
        <select
          value={newGroupMode ? NEW_GROUP_VALUE : form.groupPath}
          onChange={(event) => {
            if (event.target.value === NEW_GROUP_VALUE) {
              setNewGroupMode(true);
              updateForm({ groupPath: "" });
              return;
            }
            setNewGroupMode(false);
            handleGroupPathChange(event.target.value);
          }}
          className={`eco-input product-editor-input ${errorMessage ? "has-error" : ""}`}
        >
          <option value="">Без группы</option>
          {editorGroupsLoading && groupOptions.length === 0 ? (
            <option value="" disabled>Загружаем группы...</option>
          ) : null}
          {groupOptions.map((group) => (
            <option key={group} value={group}>{group}</option>
          ))}
          <option value={NEW_GROUP_VALUE}>Новая группа...</option>
        </select>
        {newGroupMode ? (
          <ProductEditorBufferedInput
            id="product-field-new-group"
            value={form.groupPath}
            placeholder="Название новой группы"
            className="eco-input product-editor-input"
            onCommit={(value) => updateForm({ groupPath: value })}
          />
        ) : null}
        {editorGroupsLoading ? <span className="product-editor-hint">Загружаем полный список групп...</span> : null}
        {editorGroupsError ? <span className="product-editor-error">{editorGroupsError}</span> : null}
        {errorMessage ? <span className="product-editor-error">{errorMessage}</span> : null}
      </label>
    );
  }

  function renderMarkingToggle(key: keyof ProductForm, label: string, hint?: string) {
    return (
      <label className="eco-toggle-row product-editor-marking-toggle">
        <input
          type="checkbox"
          checked={form[key] === "true"}
          onChange={(event) => updateMarkingForm({ [key]: event.target.checked ? "true" : "false" } as Partial<ProductForm>)}
        />
        <span>
          <b>{label}</b>
          {hint ? <em>{hint}</em> : null}
        </span>
      </label>
    );
  }

  function renderMarkingSection() {
    const enabled = isMarkingEnabled(form);
    const mode = formMarkingMode(form);
    const status = formMarkingStatus(form);
    const settings = formMarkingSettings(form);
    const problems = bulkOilSetupProblems({
      markingEnabled: enabled,
      markingMode: mode,
      uomName: form.uomName,
      settings,
    });
    const hintBulk = likelyBulkOilMarkingHint(form) && mode !== "BULK_OIL_FROM_MARKED_BARREL";
    const dangerousPackagedLiter = enabled && mode === "PACKAGED_MARKED_GOOD" && isLiterSaleUnit(form.uomName);
    const bulkGroupWithWrongMode = enabled && productMarkingDefaultForGroup(form.groupPath) === "BULK_OIL" && mode !== "BULK_OIL_FROM_MARKED_BARREL";
    const errorMessage = formErrors.markingMode;

    return (
      <section id={productEditorSectionElementId("marking")} className="product-editor-section product-editor-marking-section">
        <div className="product-editor-section-head">
          <div>
            <h3>Маркировка</h3>
            <p>Сценарий Честного знака и кассы для этого товара</p>
          </div>
          <span className={`product-editor-type-badge ${status === "CONFIG_ERROR" ? "is-danger" : ""}`}>
            {productMarkingStatusText({ markingEnabled: enabled, markingMode: mode, markingStatus: status })}
          </span>
        </div>

        <details className="product-editor-marking-help">
          <summary>
            <span aria-hidden="true">?</span>
            <b>Что означают эти поля?</b>
          </summary>
          <div>
            <h4>Как работает маркировка товара</h4>
            <p>
              Этот раздел определяет, как товар будет передаваться в кассу и Честный знак при продаже.
              Если настроить сценарий неправильно, код маркировки может быть списан целиком вместо частичной продажи.
            </p>
            <h5>Обычная маркированная упаковка</h5>
            <p>
              Используется для канистр, упаковок и штучных товаров. Один код маркировки соответствует одной упаковке.
              При продаже код списывается целиком.
            </p>
            <p><b>Пример:</b> канистра масла 4 л. Продали одну канистру — один код выбыл полностью.</p>
            <h5>Масло на разлив из бочки</h5>
            <p>
              Используется, когда масло продаётся литрами из одной бочки. У бочки есть один код маркировки.
              Этот код используется несколько раз, пока из бочки продаётся масло.
              При каждой продаже в кассу передаётся проданный объём в литрах, а не вся бочка целиком.
            </p>
            <p><b>Пример:</b> бочка 200 л. Продали 1 л — в кассу уходит 1 л, остаток бочки становится 199 л.</p>
          </div>
        </details>

        <label className="eco-toggle-row product-editor-marking-toggle is-main">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              const checked = event.target.checked;
              updateMarkingForm({
                markingEnabled: checked ? "true" : "false",
                markingMode: checked
                  ? form.markingMode === "NOT_MARKED" ? "REQUIRES_CHECK" : form.markingMode
                  : "NOT_MARKED",
              });
            }}
          />
          <span>
            <b>Товар участвует в маркировке Честный знак</b>
            <em>Включайте, если товар должен передаваться в кассу и Честный знак как маркированный товар</em>
          </span>
        </label>

        {hintBulk ? (
          <div className="product-editor-alert is-warning">
            <AlertCircle aria-hidden className="eco-icon" />
            <span>Похоже, это масло на разлив. Проверьте настройки маркировки и выберите сценарий “Масло на разлив из бочки”.</span>
          </div>
        ) : null}

        {dangerousPackagedLiter || bulkGroupWithWrongMode ? (
          <div className="product-editor-alert is-error">
            <AlertCircle aria-hidden className="eco-icon" />
            <span>
              Товар выглядит как мерный или разливной, но выбран сценарий обычной упаковки.
              При продаже есть риск полного вывода кода маркировки из оборота.
            </span>
          </div>
        ) : null}

        {enabled ? (
          <>
            <label className={`product-editor-field is-full ${errorMessage ? "has-error" : ""}`}>
              <span className="product-editor-label">
                <span>Как списывать код маркировки *</span>
                <span className="product-editor-label-tags">
                  <em title="Это поле определяет payload в AQSI">отгрузка</em>
                </span>
              </span>
              <select
                value={mode}
                onChange={(event) => updateMarkingForm({ markingMode: event.target.value })}
                className={`eco-input product-editor-input ${errorMessage ? "has-error" : ""}`}
              >
                <option value="PACKAGED_MARKED_GOOD">{markingModeSelectLabel("PACKAGED_MARKED_GOOD")}</option>
                <option value="BULK_OIL_FROM_MARKED_BARREL">{markingModeSelectLabel("BULK_OIL_FROM_MARKED_BARREL")}</option>
                <option value="REQUIRES_CHECK">{markingModeSelectLabel("REQUIRES_CHECK")}</option>
              </select>
              <span className="product-editor-hint">
                {mode === "BULK_OIL_FROM_MARKED_BARREL"
                  ? "Один код маркировки относится к бочке, а каждая продажа списывает только литры"
                  : mode === "PACKAGED_MARKED_GOOD"
                    ? "Канистры и упаковки: один код используется один раз и списывается целиком"
                    : "Продажа будет заблокирована до проверки настройки"}
              </span>
              {errorMessage ? <span className="product-editor-error">{errorMessage}</span> : null}
            </label>

            {mode === "BULK_OIL_FROM_MARKED_BARREL" ? (
              <>
                {problems.length > 0 ? (
                  <div className="product-editor-alert is-warning">
                    <AlertCircle aria-hidden className="eco-icon" />
                    <span>{problems.join(" ")}</span>
                  </div>
                ) : null}
                <div className="product-editor-grid product-editor-compact-grid">
                  {renderField("markingDeclaredVolumeLiters", "Объём бочки, л", {
                    type: "number",
                    required: true,
                    placeholder: "200",
                    hint: "Полный объём бочки при открытии, например 200 л. Нужен, чтобы система понимала, сколько всего можно продать из этой бочки.",
                  })}
                  {renderField("markingCurrentVolumeLiters", "Остаток бочки, л", {
                    type: "number",
                    placeholder: "200",
                    hint: "Это локальный остаток масла в выбранной бочке в литрах. Он уменьшается после каждой продажи через Эко-платформу.",
                  })}
                  {renderField("markingNonDrainableRemainderPercent", "Несливаемый остаток, %", {
                    type: "number",
                    placeholder: "0",
                    hint: "Часть масла, которую обычно невозможно продать из бочки до конца. Когда остаток приблизится к ней, бочку нужно закрывать или проверять.",
                  })}
                  {renderField("markingActiveBarrelName", "Активная бочка", {
                    placeholder: "Bardahl XTS 5W-30, бочка 200 л",
                    hint: "Это бочка, из которой сейчас продаётся масло. При продаже система берёт код маркировки именно из неё и уменьшает её остаток.",
                  })}
                  {renderField("markingActiveBarrelGtin", "GTIN бочки, 14 цифр", {
                    placeholder: "14 цифр",
                    hint: "GTIN входит в DataMatrix-код и нужен для проверки, что код маркировки относится к правильному товару.",
                  })}
                  {renderField("markingVerificationStatus", "Статус проверки", {
                    placeholder: "Готово / Требует настройки / Нет активной бочки",
                    hint: "Показывает, можно ли безопасно продавать товар с текущими настройками. Жёлтый или красный статус требует проверки до продажи.",
                  })}
                  {renderField("markingActiveBarrelCode", "Код маркировки бочки", {
                    type: "textarea",
                    rows: 2,
                    full: true,
                    placeholder: "Полный DataMatrix активной бочки",
                    hint: "Для масла на разлив один код используется много раз, но каждый раз в чек передаётся только проданный объём в литрах.",
                  })}
                </div>
                <div className="product-editor-marking-switches">
                  {renderMarkingToggle(
                    "markingAllowRepeatedBarrelCode",
                    "Разрешить повторное использование одного кода бочки до исчерпания объёма",
                    "Только для сценария бочки на разлив. Для обычной упаковки повтор кода запрещён."
                  )}
                  {renderMarkingToggle(
                    "markingPartialWithdrawalEnabled",
                    "Частичное выбытие в литрах",
                    "В AQSI товар должен уходить как Litre, а не Piece"
                  )}
                  {renderMarkingToggle(
                    "markingAllowSaleWithoutActiveBarrel",
                    "Разрешить сохранить без активной бочки",
                    "Это не разрешает продажу без бочки. Это только позволяет сохранить карточку товара."
                  )}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <span className="product-editor-type-badge">Не маркируется</span>
        )}
      </section>
    );
  }

  function clearHiddenCharacteristics() {
    if (groupKind === "oil") {
      updateForm({ oem: "", oemParts: "", mannCharacteristicName: "" });
    } else if (groupKind === "filter") {
      updateForm({
        sae: "",
        apiSpec: "",
        acea: "",
        aceaExtra: "",
        ilsac: "",
        atf: "",
        packageVolume: "",
        volume: "",
        oemAtf: "",
      });
    } else {
      updateForm({
        sae: "",
        apiSpec: "",
        acea: "",
        aceaExtra: "",
        ilsac: "",
        atf: "",
        packageVolume: "",
        volume: "",
        oemAtf: "",
        oem: "",
        oemParts: "",
        mannCharacteristicName: "",
      });
    }
  }

  function renderHiddenCharacteristicsWarning() {
    if (!hiddenFieldsForGroup.length) return null;
    return (
      <div className="product-editor-alert is-warning">
        <AlertCircle aria-hidden className="eco-icon" />
        <span>
          Для выбранной группы скрыты заполненные поля: {hiddenFieldsForGroup.join(", ")}.
          Данные сохранятся в карточке, но не используются в рабочем блоке характеристик.
        </span>
        <button type="button" className="eco-btn eco-btn--sm" onClick={clearHiddenCharacteristics}>
          Очистить скрытые поля
        </button>
      </div>
    );
  }

  function renderAdditionalCodesSection() {
    return (
      <details
        id={productEditorSectionElementId("codes")}
        className="product-editor-section product-editor-extra-details"
        open={highlightedEditorSections.has("codes")}
      >
        <summary>
          <span>
            <b>Дополнительные коды</b>
            <em>EAN, Code128, внешние и поставщицкие legacy-коды</em>
          </span>
        </summary>
        <div className="product-editor-grid">
          {renderField("barcodeEan13", "EAN-13", { placeholder: "460..." })}
          {renderField("barcodeEan8", "EAN-8", { placeholder: "8 цифр" })}
          {renderField("barcodeCode128", "Code128", { placeholder: "Code128" })}
          {renderField("externalCode", "Внешний код", { placeholder: "legacy / external" })}
          {renderField("rosskoPartNumber", "Код поставщика / ROSSKO", { placeholder: "supplier part number" })}
          {renderField("rosskoBrand", "Бренд поставщика / ROSSKO", { placeholder: "supplier brand" })}
          {renderField("rosskoMin", "Минимум ROSSKO", { placeholder: "мин." })}
        </div>
      </details>
    );
  }

  function renderGroupCharacteristicsSection() {
    if (groupKind === "oil") {
      return (
        <section id={productEditorSectionElementId("oil")} className="product-editor-section is-oil">
          <div className="product-editor-section-head">
            <div>
              <h3>Характеристики масла</h3>
              <p>Вязкость, допуски, фасовка и объём для масел и технических жидкостей</p>
            </div>
            <span className="product-editor-type-badge">Масло / жидкость</span>
          </div>
          {renderHiddenCharacteristicsWarning()}
          <div className="product-editor-grid">
            {renderField("sae", "SAE / вязкость", { placeholder: "5W-30" })}
            {renderField("apiSpec", "API", { placeholder: "SP" })}
            {renderField("acea", "ACEA", { placeholder: "C3" })}
            {renderField("aceaExtra", "ACEA A/B", { placeholder: "A3/B4" })}
            {renderField("ilsac", "ILSAC", { placeholder: "GF-6" })}
            {renderField("atf", "ATF", { placeholder: "Dexron VI" })}
            {renderField("packageVolume", "Фасовка", { placeholder: "канистра 1 л / бочка / разлив" })}
            {renderField("volume", "Объём, л", { type: "number", placeholder: "1" })}
            {renderField("oemAtf", "Допуски производителя", {
              type: "textarea",
              rows: 3,
              full: true,
              placeholder: "MB 229.51, VW 504/507...",
            })}
          </div>
        </section>
      );
    }

    if (groupKind === "filter") {
      return (
        <section id={productEditorSectionElementId("oil")} className="product-editor-section">
          <div className="product-editor-section-head">
            <div>
              <h3>Применимость и аналоги</h3>
              <p>OEM, MANN/POMAN, аналоги и кросс-номера в одном поле поиска</p>
            </div>
            <button
              type="button"
              className="eco-btn eco-btn--sm"
              onClick={() => void requestRosskoOemPreview()}
              disabled={rosskoPreviewLoading}
            >
              {rosskoPreviewLoading ? <Loader2 aria-hidden className="eco-icon animate-spin" /> : <Search aria-hidden className="eco-icon" />}
              Заполнить через ROSSKO
            </button>
          </div>
          {renderHiddenCharacteristicsWarning()}
          <div className="product-editor-grid">
            {renderField("oem", "OEM", {
              type: "textarea",
              rows: 3,
              full: true,
              placeholder: "Разделяйте значения пробелом, запятой или новой строкой",
            })}
            {renderField("oemParts", "OEM Parts / кросс-номера / аналоги", {
              type: "textarea",
              rows: 4,
              full: true,
              placeholder: "Разделяйте значения запятой, точкой с запятой или новой строкой",
              hint: "Сюда добавляются OEM, MANN/POMAN, аналоги и кросс-номера, по которым товар должен находиться в поиске.",
            })}
            {renderField("mannCharacteristicName", "Применимость / примечание", {
              type: "textarea",
              rows: 3,
              full: true,
              placeholder: "Применимость, размеры, заметки по фильтру",
            })}
          </div>
        </section>
      );
    }

    return (
      <section id={productEditorSectionElementId("oil")} className="product-editor-section">
        <div className="product-editor-section-head">
          <div>
            <h3>Характеристики группы</h3>
            <p>Выберите группу, чтобы показать релевантные поля масла или фильтра</p>
          </div>
          <span className="product-editor-type-badge">Прочий товар</span>
        </div>
        {renderHiddenCharacteristicsWarning()}
        <div className="product-editor-empty-note">
          Для прочих товаров характеристики масла и фильтров скрыты. Данные не удаляются и остаются доступными в служебном блоке.
        </div>
      </section>
    );
  }

  function renderAvitoField() {
    const key: keyof ProductForm = "avito";
    return (
      <label className={`product-editor-field ${fieldMatches(key, "Авито") ? "is-highlighted" : ""}`}>
        <span className="product-editor-label">
          <span>Авито</span>
        </span>
        <select
          value={form.avito}
          onChange={(event) => updateForm({ avito: event.target.value })}
          className="eco-input product-editor-input"
        >
          <option value="">Не указано</option>
          <option value="true">Да</option>
          <option value="false">Нет</option>
        </select>
      </label>
    );
  }

  function renderEditorActionButtons(placement: "side" | "footer" = "footer") {
    const className = placement === "side" ? "product-editor-action-stack" : "product-editor-footer-actions";
    return (
      <div className={className}>
        <button type="button" className="eco-btn" onClick={closeForm}>
          <RotateCcw aria-hidden className="eco-icon" />
          Отмена
        </button>
        <button
          type="button"
          onClick={() => void submit(false)}
          disabled={saving || !formDirty}
          className="eco-btn eco-btn--primary"
        >
          {saving ? <Loader2 aria-hidden className="eco-icon animate-spin" /> : <Save aria-hidden className="eco-icon" />}
          {saving ? "Сохраняем..." : "Сохранить"}
        </button>
        <button
          type="button"
          onClick={() => void submit(true)}
          disabled={saving || !formDirty}
          className="eco-btn"
        >
          Сохранить и закрыть
        </button>
      </div>
    );
  }

  function renderPhotoSection(compact = false) {
    return (
      <section className={`product-editor-side-card product-editor-photo-section ${compact ? "is-compact" : ""}`}>
        <div className="product-editor-section-head">
          <div>
            <h3>Фото</h3>
            <p>Миниатюры для карточки и поиска</p>
          </div>
          <label className={`eco-btn eco-btn--sm ${editingId && !uploadingPhotos ? "" : "is-disabled"}`}>
            <ImagePlus aria-hidden className="eco-icon" />
            {uploadingPhotos ? "Загрузка..." : "Прикрепить"}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={!editingId || uploadingPhotos}
              className="sr-only"
              onChange={(event) => {
                void uploadProductPhotos(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {editingProduct?.photos.length ? (
          <div className="product-editor-photo-grid">
            {editingProduct.photos.map((photo) => (
              <div key={photo.id} className="product-editor-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.fileName || "Фото товара"} />
                <div>
                  <span>{photo.fileName || "Фото товара"}</span>
                  <em>{formatFileSize(photo.sizeBytes)}</em>
                  <button
                    type="button"
                    onClick={() => void deleteProductPhoto(photo.id)}
                    disabled={deletingPhotoId === photo.id}
                    aria-label="Удалить фото"
                  >
                    {deletingPhotoId === photo.id ? <Loader2 aria-hidden className="eco-icon animate-spin" /> : <Trash2 aria-hidden className="eco-icon" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="product-editor-photo-empty">
            <strong>Фото не прикреплено</strong>
            <span>{editingId ? "Добавьте фото товара для карточки и поиска" : "Фото можно прикрепить после создания товара"}</span>
          </div>
        )}
      </section>
    );
  }

  function renderEditorArchiveAction() {
    if (!editingProduct) return null;
    if (editingProduct.archived) {
      return (
        <button type="button" className="eco-btn product-editor-restore-action" onClick={() => void restoreProduct(editingProduct)}>
          <ArchiveRestore aria-hidden className="eco-icon" />
          Восстановить
        </button>
      );
    }
    return (
      <button type="button" className="eco-btn eco-btn--danger product-editor-archive-action" onClick={() => requestArchive(editingProduct)}>
        <Archive aria-hidden className="eco-icon" />
        Перенести в архив
      </button>
    );
  }

  function renderRosskoPreviewModal() {
    if (!rosskoPreviewOpen) return null;
    return (
      <div className="eco-modal-backdrop" role="presentation" onMouseDown={() => setRosskoPreviewOpen(false)}>
        <section
          className="eco-modal eco-product-rossko-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Предпросмотр ROSSKO"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="eco-modal-head">
            <div>
              <div className="product-editor-kicker">ROSSKO / OEM Parts</div>
              <h3>Предпросмотр аналогов</h3>
              {rosskoPreviewQuery ? <p>Исходный запрос: {rosskoPreviewQuery}</p> : null}
            </div>
            <button type="button" className="eco-icon-action" onClick={() => setRosskoPreviewOpen(false)} aria-label="Закрыть">
              <X aria-hidden className="eco-icon" />
            </button>
          </header>

          <div className="eco-product-rossko-body">
            {rosskoPreviewLoading ? (
              <div className="eco-products-empty">
                <Loader2 aria-hidden className="eco-icon animate-spin" />
                <strong>Ищем аналоги в ROSSKO</strong>
              </div>
            ) : rosskoPreviewError ? (
              <div className="eco-products-empty is-error">
                <strong>{rosskoPreviewItems.length ? "Проверьте выбор" : "ROSSKO ничего не нашёл"}</strong>
                <span>{rosskoPreviewError}</span>
                <div className="eco-products-empty-actions">
                  <button type="button" className="eco-btn eco-btn--sm" onClick={() => void requestRosskoOemPreview()}>
                    Попробовать другой код
                  </button>
                  <button type="button" className="eco-btn eco-btn--sm" onClick={() => setRosskoPreviewOpen(false)}>
                    Оставить пустым
                  </button>
                </div>
              </div>
            ) : (
              <>
                {rosskoPreviewItems.length > 24 ? (
                  <div className="product-editor-alert is-warning">
                    <AlertCircle aria-hidden className="eco-icon" />
                    <span>ROSSKO вернул много вариантов. Автоматически ничего не записываем, выберите нужные вручную.</span>
                  </div>
                ) : null}
                <div className="eco-product-rossko-list">
                  {rosskoPreviewItems.map((item) => {
                    const checked = rosskoSelectedKeys.includes(item.key);
                    return (
                      <button
                        type="button"
                        key={item.key}
                        className={`eco-product-rossko-row ${checked ? "is-active" : ""}`}
                        onClick={() => toggleRosskoPreviewItem(item.key)}
                      >
                        <span className={`eco-check ${checked ? "is-checked" : ""}`} />
                        <span>
                          <b>{[item.brand, item.partNumber].filter(Boolean).join(" ") || "Аналог"}</b>
                          <em>{item.name || item.oem || "Без описания"}</em>
                        </span>
                        <small>{item.confidence}% · {item.source}</small>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <footer className="eco-product-import-footer">
            <button type="button" className="eco-btn" onClick={() => setRosskoPreviewOpen(false)}>
              Отмена
            </button>
            <button
              type="button"
              className="eco-btn"
              onClick={() => setRosskoSelectedKeys(rosskoPreviewItems.map((item) => item.key))}
              disabled={rosskoPreviewLoading || !rosskoPreviewItems.length}
            >
              Добавить всё
            </button>
            <button
              type="button"
              className="eco-btn eco-btn--primary"
              onClick={applyRosskoPreview}
              disabled={rosskoPreviewLoading || !rosskoPreviewItems.length}
            >
              Добавить выбранное
            </button>
          </footer>
        </section>
      </div>
    );
  }

  function filteredImportRows() {
    if (!importJob) return [];
    if (importPreviewFilter === "new") return importJob.rows.filter((row) => row.action === "create");
    if (importPreviewFilter === "changed") return importJob.rows.filter((row) => row.action === "update" && row.changedFields.length > 0);
    if (importPreviewFilter === "errors") return importJob.rows.filter((row) => row.status === "error");
    if (importPreviewFilter === "conflicts") return importJob.rows.filter((row) => row.status === "conflict");
    return importJob.rows;
  }

  function renderImportWizard() {
    if (!importOpen) return null;
    const rowsForPreview = filteredImportRows();
    const hasBlockingRows = Boolean(importJob && (importJob.errorRows > 0 || importJob.conflictRows > 0));
    const canExecute = Boolean(importJob && importJob.status !== "completed" && importMode !== "validate");
    return (
      <div className="eco-modal-backdrop" role="presentation">
        <section className="eco-modal eco-product-import-modal" role="dialog" aria-modal="true" aria-label="Импорт товаров">
          <header className="eco-modal-head">
            <div>
              <div className="product-editor-kicker">Склад / Товары</div>
              <h3>Импорт товаров</h3>
            </div>
            <button type="button" className="eco-icon-action" onClick={() => setImportOpen(false)} aria-label="Закрыть">
              <X aria-hidden className="eco-icon" />
            </button>
          </header>

          <div className="eco-product-import-grid">
            <div className="eco-product-import-panel">
              <label className="eco-field">
                <span>Excel-файл</span>
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => {
                    setImportFile(event.target.files?.[0] ?? null);
                    setImportJob(null);
                    setImportError(null);
                  }}
                />
              </label>

              <label className="eco-field">
                <span>Режим импорта</span>
                <select className="eco-input" value={importMode} onChange={(event) => setImportMode(event.target.value as ProductImportMode)}>
                  <option value="update">Обновить только существующие</option>
                  <option value="create">Создать только новые</option>
                  <option value="upsert">Создать и обновить</option>
                  <option value="validate">Только проверить</option>
                </select>
              </label>

              <label className="eco-field">
                <span>Ошибки</span>
                <select className="eco-input" value={importErrorMode} onChange={(event) => setImportErrorMode(event.target.value as ProductImportErrorMode)}>
                  <option value="validRows">Импортировать корректные строки</option>
                  <option value="allOrNothing">Отменить весь импорт при любой ошибке</option>
                </select>
              </label>

              <label className="eco-toggle-row">
                <input type="checkbox" checked={importAllowNameMatching} onChange={(event) => setImportAllowNameMatching(event.target.checked)} />
                <span>Разрешить сопоставление по точному названию</span>
              </label>
              <label className="eco-toggle-row">
                <input type="checkbox" checked={importEmptyCellsClear} onChange={(event) => setImportEmptyCellsClear(event.target.checked)} />
                <span>Пустые ячейки очищают значения</span>
              </label>

              <div className="eco-product-import-actions">
                <button type="button" className="eco-btn" onClick={downloadTemplate}>
                  <FileSpreadsheet aria-hidden className="eco-icon" />
                  Шаблон
                </button>
                <button type="button" className="eco-btn eco-btn--primary" onClick={() => void validateImportFile()} disabled={importBusy}>
                  {importBusy ? <Loader2 aria-hidden className="eco-icon animate-spin" /> : <CheckCircle2 aria-hidden className="eco-icon" />}
                  Проверить
                </button>
              </div>

              {importError ? <div className="eco-product-import-error">{importError}</div> : null}
            </div>

            <div className="eco-product-import-preview">
              {importJob ? (
                <>
                  <div className="eco-product-import-summary">
                    <span>Всего: <b>{importJob.totalRows}</b></span>
                    <span>Создать: <b>{importJob.createdRows}</b></span>
                    <span>Обновить: <b>{importJob.updatedRows}</b></span>
                    <span>Пропущено: <b>{importJob.skippedRows}</b></span>
                    <span>Ошибки: <b>{importJob.errorRows}</b></span>
                    <span>Конфликты: <b>{importJob.conflictRows}</b></span>
                  </div>

                  <div className="eco-product-import-filters">
                    {[
                      ["all", "Все"],
                      ["new", "Новые"],
                      ["changed", "Изменения"],
                      ["errors", "Ошибки"],
                      ["conflicts", "Конфликты"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`eco-pill ${importPreviewFilter === value ? "is-active" : ""}`}
                        onClick={() => setImportPreviewFilter(value as ProductImportPreviewFilter)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="eco-product-import-table-wrap">
                    <table className="eco-table eco-product-import-table">
                      <thead>
                        <tr>
                          <th>Вкл.</th>
                          <th>Строка</th>
                          <th>Действие</th>
                          <th>Найденный товар</th>
                          <th>Изменения</th>
                          <th>Сообщения</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowsForPreview.slice(0, 160).map((row) => {
                          const excluded = importExcludedRows.includes(row.rowNumber);
                          return (
                            <tr key={row.rowNumber} className={row.status === "error" || row.status === "conflict" ? "is-problem" : ""}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={!excluded}
                                  onChange={() => toggleImportRow(row.rowNumber)}
                                  disabled={row.status === "error" || row.status === "conflict"}
                                  aria-label={`Импортировать строку ${row.rowNumber}`}
                                />
                              </td>
                              <td>{row.rowNumber}</td>
                              <td>{row.action}</td>
                              <td>{row.matchedProductName || row.matchedProductId || "—"}</td>
                              <td>
                                {row.changedFields.length
                                  ? row.changedFields.slice(0, 4).map((field) => `${field.label}: ${field.oldValue ?? ""} → ${field.newValue ?? ""}`).join("; ")
                                  : "—"}
                              </td>
                              <td>{[...row.errors, ...row.warnings].join("; ") || row.status}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {rowsForPreview.length > 160 ? <div className="eco-product-import-limit">Показаны первые 160 строк предпросмотра.</div> : null}
                  </div>

                  <footer className="eco-product-import-footer">
                    <a className="eco-btn" href={`/api/products/import/${encodeURIComponent(importJob.id)}/report`}>
                      <Download aria-hidden className="eco-icon" />
                      Отчёт
                    </a>
                    {importJob.status === "completed" && !importJob.rollbackAt ? (
                      <button type="button" className="eco-btn eco-btn--danger" onClick={() => void rollbackImportJob()} disabled={importBusy}>
                        <RotateCcw aria-hidden className="eco-icon" />
                        Отменить импорт
                      </button>
                    ) : null}
                    {canExecute ? (
                      <button
                        type="button"
                        className="eco-btn eco-btn--primary"
                        onClick={() => void executeImportJob()}
                        disabled={importBusy || (importErrorMode === "allOrNothing" && hasBlockingRows)}
                      >
                        {importBusy ? <Loader2 aria-hidden className="eco-icon animate-spin" /> : <Upload aria-hidden className="eco-icon" />}
                        Подтвердить импорт
                      </button>
                    ) : null}
                  </footer>
                </>
              ) : (
                <div className="eco-products-empty">
                  <strong>Загрузите Excel-файл</strong>
                  <span>После проверки здесь появится сводка, изменения по строкам, ошибки и конфликты.</span>
                  {importHistory.length ? (
                    <div className="eco-product-import-history">
                      {importHistory.map((job) => (
                        <button key={job.id} type="button" onClick={() => void openImportJobDetails(job.id)}>
                          <span>
                            <b>{job.fileName}</b>
                            <small>{new Date(job.createdAt).toLocaleString("ru-RU")} · {job.status}</small>
                          </span>
                          <em>{job.createdRows} создано · {job.updatedRows} обновлено · {job.errorRows + job.conflictRows} проблем</em>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="eco-products-page">
      {formOpen && (
        <div className="product-editor-backdrop">
          <section role="dialog" aria-modal="true" className="product-editor-drawer">
            <header className="product-editor-header">
              <div className="product-editor-title-block">
                <div className="product-editor-kicker">{editingId ? "Редактирование товара" : "Новый товар"}</div>
                <h2>{form.name.trim() || editingName || "Новая карточка товара"}</h2>
                <div className="product-editor-meta-line">
                  <span>Артикул {compactHeaderValue(form.article)}</span>
                  <span>Код {compactHeaderValue(form.code)}</span>
                  <span className="product-editor-type-badge">{entityTypeLabel(form.entityType)}</span>
                  {editingProduct?.archived ? (
                    <span className="product-editor-archive-badge">Архив</span>
                  ) : editingId ? (
                    <span>Активен</span>
                  ) : (
                    <span>Новый</span>
                  )}
                </div>
              </div>
              <div className="product-editor-header-actions">
                <span className={`product-editor-save-state ${saving ? "is-saving" : formDirty ? "is-dirty" : "is-saved"}`}>
                  {saving ? <Loader2 aria-hidden className="eco-icon animate-spin" /> : formDirty ? <AlertCircle aria-hidden className="eco-icon" /> : <CheckCircle2 aria-hidden className="eco-icon" />}
                  {saving ? "Сохраняем..." : formDirty ? "Есть изменения" : "Сохранено"}
                </span>
                <button type="button" className="product-editor-icon-button" onClick={closeForm} aria-label="Закрыть">
                  <X aria-hidden className="eco-icon" />
                </button>
              </div>
            </header>

            <nav className="product-editor-nav" aria-label="Разделы карточки товара">
              {productEditorSections.map((section) => (
                <a
                  key={section.id}
                  href={`#${productEditorSectionElementId(section.id)}`}
                  onClick={() => prepareEditorSection(section.id)}
                  className={`product-editor-nav-button ${highlightedEditorSections.has(section.id) ? "is-highlighted" : ""}`}
                >
                  {section.label}
                </a>
              ))}
            </nav>

            <div className="product-editor-scroll">
              <div className="product-editor-search">
                <Search aria-hidden className="eco-icon" />
                <input
                  value={formSearch}
                  onChange={(event) => setFormSearch(event.target.value)}
                  placeholder="Найти поле..."
                  className="eco-input"
                />
                {formSearch ? (
                  <button
                    type="button"
                    className="product-editor-search-clear"
                    onClick={() => setFormSearch("")}
                    aria-label="Очистить поиск по полям"
                  >
                    <X aria-hidden className="eco-icon" />
                  </button>
                ) : null}
              </div>

              {formError ? (
                <div className="product-editor-alert is-error">
                  <AlertCircle aria-hidden className="eco-icon" />
                  <span>{formError}</span>
                </div>
              ) : null}

              {changedCriticalFields.length > 0 ? (
                <div className="product-editor-alert is-warning">
                  <AlertCircle aria-hidden className="eco-icon" />
                  <span>
                    Изменены рабочие поля: {changedCriticalFields.join(", ")}. Проверьте поиск, склад и отгрузку перед сохранением.
                  </span>
                </div>
              ) : null}

              <div className="product-editor-workspace">
                <div className="product-editor-main-flow">
                  <section id={productEditorSectionElementId("main")} className="product-editor-section product-editor-main-card">
                    <div className="product-editor-section-head">
                      <div>
                        <h3>Главное</h3>
                        <p>Продажа, поиск, склад и отгрузка</p>
                      </div>
                      <div className="product-editor-kpi-row">
                        <span>
                          <b>{formatQty(editingProduct?.totalAvailable ?? 0)}</b>
                          доступно
                        </span>
                        <span>
                          <b>{formatMoneyWhole(salePriceDraft)}</b>
                          ₽ продажа
                        </span>
                      </div>
                    </div>
                    <div className="product-editor-grid">
                      {renderField("name", "Название товара", { required: true, full: true, placeholder: "Например: Mobil 1 ESP 5W-30, 1 л" })}
                      {renderField("article", "Артикул", { required: true, placeholder: "156202" })}
                      {renderField("code", "Код / штрихкод", { required: true, placeholder: "30015649815" })}
                      {renderEntityTypeField()}
                      {renderField("brand", "Бренд", { placeholder: "Mobil" })}
                      {renderGroupField()}
                      {renderField("uomName", "Единица", { required: true, placeholder: "шт" })}
                      {renderField("salePrice", "Цена продажи", { type: "money", required: true, placeholder: "0,00" })}
                      {renderField("buyPrice", "Цена закупки", { type: "money", placeholder: "0,00" })}
                      <SupplierCombobox
                        value={form.supplierCounterpartyId}
                        displayName={form.supplierName}
                        selectedSupplier={editingProduct?.supplierCounterparty ?? null}
                        onChange={(supplier) => updateForm({
                          supplierCounterpartyId: supplier?.id ?? "",
                          supplierName: supplier?.displayName ?? "",
                        })}
                      />
                      {renderField("cell", "Основная ячейка", { placeholder: "A-12" })}
                      {renderField("minimumBalance", "Неснижаемый остаток", { type: "number", placeholder: "0" })}
                    </div>
                  </section>

                  <section id={productEditorSectionElementId("pricing")} className="product-editor-section product-editor-pricing-card">
                    <div className="product-editor-section-head">
                      <div>
                        <h3>Складская сводка</h3>
                        <p>Остатки и размещение без дублирования цен</p>
                      </div>
                    </div>
                    <div className="product-editor-stock-grid">
                      <span><b>{formatQty(editingProduct?.totalQuantity ?? 0)}</b>остаток</span>
                      <span><b>{formatQty(editingProduct?.totalAvailable ?? 0)}</b>доступно</span>
                      <span><b>{formatQty(editingProduct ? reserveValue(editingProduct) : 0)}</b>резерв</span>
                    </div>
                    {editingProduct?.stock.length ? (
                      <div className="product-editor-stock-list">
                        {editingProduct.stock.map((stockRow) => (
                          <div key={stockRow.storeId}>
                            <span>{stockRow.storeName || "Склад"}</span>
                            <b>{formatQty(stockRow.available)}</b>
                            <em>{stockRow.slotName || "без ячейки"}</em>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="product-editor-summary-grid product-editor-stock-summary">
                      <span><em>Основная ячейка</em><b>{compactHeaderValue(form.cell, "не указана")}</b></span>
                      <span><em>Минимальный остаток</em><b>{compactHeaderValue(form.minimumBalance, "не задан")}</b></span>
                      <span><em>Поставщик</em><b>{compactHeaderValue(form.supplierName, "не указан")}</b></span>
                    </div>
                  </section>

                  {renderMarkingSection()}

                  {renderAdditionalCodesSection()}

                  {renderGroupCharacteristicsSection()}

                  <details
                    id={productEditorSectionElementId("extra")}
                    className="product-editor-section product-editor-extra-details"
                    open={extraOpen || highlightedEditorSections.has("extra")}
                    onToggle={(event) => setExtraOpen(event.currentTarget.open)}
                  >
                    <summary>
                      <span>
                        <b>Служебные данные</b>
                        <em>Документы, импорт, налоги и legacy-поля. По умолчанию скрыто.</em>
                      </span>
                    </summary>
                    <div className="product-editor-grid">
                      {renderField("currencyName", "Валюта", { placeholder: "руб." })}
                      {renderField("minPrice", "Минимальная цена", { type: "money", placeholder: "0,00" })}
                      {renderField("minPriceCurrencyName", "Валюта мин. цены", { placeholder: "руб." })}
                      {renderField("vatLabel", "НДС", { placeholder: "Без НДС / 20%" })}
                      {renderField("description", "Описание", { type: "textarea", rows: 4, full: true, placeholder: "Краткое описание товара" })}
                      {renderField("countryName", "Страна", { placeholder: "Россия" })}
                      {renderField("tnvedCode", "Код ТН ВЭД", { placeholder: "Код классификации" })}
                      {renderField("modificationCode", "Код модификации", { placeholder: "Код модификации" })}
                      {renderField("weight", "Вес", { type: "number", placeholder: "0" })}
                      {renderAvitoField()}
                    </div>
                  </details>

                  <details
                    id={productEditorSectionElementId("technical")}
                    className="product-editor-section product-editor-technical"
                    open={technicalOpen || technicalFieldsMatched}
                    onToggle={(event) => setTechnicalOpen(event.currentTarget.open)}
                  >
                    <summary>
                      <span>
                        <b>Технические поля</b>
                        <em>ID, интеграции и редко редактируемые значения</em>
                      </span>
                    </summary>
                    <div className="product-editor-readonly-grid">
                      {editingId ? <span><b>local id</b><em>{editingId}</em></span> : null}
                      {editingProduct?.moyskladId ? <span><b>moysklad id</b><em>{editingProduct.moyskladId}</em></span> : null}
                    </div>
                    <div className="product-editor-grid">
                      {technicalFieldLabels.map((field) => renderField(field.key, field.label, {
                        type: field.type,
                        full: field.type === "textarea",
                        rows: field.type === "textarea" ? 3 : undefined,
                        aliases: field.aliases,
                      }))}
                    </div>
                  </details>
                </div>

                <aside className="product-editor-summary-rail" aria-label="Сводка товара">
                  <section className="product-editor-side-card product-editor-summary-card">
                    <div className="product-editor-side-title">
                      <span>Сводка</span>
                      <b className={editingProduct?.archived ? "is-archive" : editingId ? "is-active" : "is-new"}>
                        {editingProduct?.archived ? "Архив" : editingId ? "Активен" : "Новый"}
                      </b>
                    </div>
                    <div className="product-editor-summary-name">{form.name.trim() || "Новая карточка товара"}</div>
                    <div className="product-editor-summary-grid">
                      <span><em>Тип</em><b>{entityTypeLabel(form.entityType)}</b></span>
                      <span><em>Бренд</em><b>{compactHeaderValue(form.brand, "не указан")}</b></span>
                      <span className="is-wide"><em>Группа</em><b>{compactHeaderValue(shortGroupLabel(form.groupPath), "без группы")}</b></span>
                      <span><em>Остаток</em><b>{formatQty(editingProduct?.totalQuantity ?? 0)}</b></span>
                      <span><em>Доступно</em><b>{formatQty(editingProduct?.totalAvailable ?? 0)}</b></span>
                      <span><em>Продажа</em><b>{formatMoneyWhole(salePriceDraft)} ₽</b></span>
                      <span><em>Закупка</em><b>{buyPriceDraft == null ? "—" : `${formatMoneyWhole(buyPriceDraft)} ₽`}</b></span>
                      <span><em>Маржа</em><b>{marginDraft == null ? "—" : `${formatMoneyWhole(marginDraft)} ₽${marginDraftPercent == null ? "" : ` · ${marginDraftPercent}%`}`}</b></span>
                    </div>
                  </section>

                  <section className="product-editor-side-card">
                    <div className="product-editor-side-title">
                      <span>Заполненность</span>
                      <b className={missingCompletionCount ? "is-warning" : "is-active"}>
                        {missingCompletionCount ? `Не хватает ${missingCompletionCount}` : "Готово"}
                      </b>
                    </div>
                    <div className="product-editor-completion-list">
                      {completionItems.map((item) => (
                        <span key={item.label} className={item.ok ? "is-ok" : "is-missing"}>
                          {item.ok ? <CheckCircle2 aria-hidden className="eco-icon" /> : <AlertCircle aria-hidden className="eco-icon" />}
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </section>

                  <section className="product-editor-side-card">
                    <div className="product-editor-side-title">
                      <span>Действия</span>
                    </div>
                    {renderEditorActionButtons("side")}
                    {renderEditorArchiveAction()}
                  </section>

                  {renderPhotoSection(true)}
                </aside>
              </div>
            </div>

            <footer className="product-editor-footer">
              <div className="product-editor-footer-note">
                {saving ? "Сохраняем карточку..." : formDirty ? "Есть несохранённые изменения" : "Изменений нет"}
              </div>
              {renderEditorActionButtons("footer")}
            </footer>
          </section>
        </div>
      )}

      {facetDialog && (
        <div className="eco-facet-dialog-backdrop">
          <section role="dialog" aria-modal="true" className="eco-facet-dialog">
            <header className="eco-facet-dialog-head">
              <div>
                <div className="eco-products-breadcrumb">Фильтр</div>
                <h3>{facetLabels[facetDialog].title}</h3>
              </div>
              <button type="button" className="eco-icon-action" onClick={closeFacetDialog} aria-label="Закрыть фильтр">
                <X aria-hidden className="eco-icon" />
              </button>
            </header>
            <div className="eco-search-wrap eco-facet-search">
              <Search aria-hidden className="eco-icon" />
              <input
                value={facetSearch}
                onChange={(event) => setFacetSearch(event.target.value)}
                placeholder={facetLabels[facetDialog].search}
                className="eco-input"
                autoFocus
              />
            </div>
            <div className="eco-facet-dialog-list">
              {getFacetOptions(facetDialog)
                .filter((option) => normalizeFieldSearch(filterLabel(facetDialog, option.value)).includes(normalizeFieldSearch(facetSearch)))
                .map((option) => {
                  const active = facetDraftValues.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`eco-filter-row ${active ? "is-active" : ""}`}
                      onClick={() => toggleFacetDraftValue(option.value)}
                    >
                      <span className="eco-filter-row-label">
                        <span className={`eco-check ${active ? "is-checked" : ""}`} />
                        {filterLabel(facetDialog, option.value)}
                      </span>
                      <span className="ct">{option.count.toLocaleString("ru-RU")}</span>
                    </button>
                  );
                })}
              {getFacetOptions(facetDialog).length === 0 ? (
                <div className="eco-filter-empty">Нет значений</div>
              ) : null}
            </div>
            <footer className="eco-facet-dialog-footer">
              <button type="button" className="eco-btn" onClick={clearFacetDialog}>
                Сбросить
              </button>
              <button type="button" className="eco-btn eco-btn--primary" onClick={applyFacetDialog}>
                Применить
              </button>
            </footer>
          </section>
        </div>
      )}

      {renderActionMenuPortal()}

      {archiveCandidate && (
        <div
          className="eco-product-confirm-backdrop"
          onMouseDown={() => {
            if (!archiveSaving) setArchiveCandidate(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            className="eco-product-confirm"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="eco-product-confirm-icon">
              <Archive aria-hidden className="eco-icon" />
            </div>
            <div className="eco-product-confirm-copy">
              <h3>Перенести товар в архив?</h3>
              <p>
                Товар “{archiveCandidate.name}” будет скрыт из основного списка и поиска по активным товарам.
                История отгрузок, приёмок и движений сохранится.
              </p>
            </div>
            <footer className="eco-product-confirm-actions">
              <button
                type="button"
                className="eco-btn"
                onClick={() => setArchiveCandidate(null)}
                disabled={archiveSaving}
              >
                Отмена
              </button>
              <button
                type="button"
                className="eco-btn eco-btn--danger"
                onClick={() => void archiveProduct(archiveCandidate)}
                disabled={archiveSaving}
              >
                {archiveSaving ? <Loader2 aria-hidden className="eco-icon animate-spin" /> : <Archive aria-hidden className="eco-icon" />}
                {archiveSaving ? "Переносим..." : "Перенести в архив"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {renderRosskoPreviewModal()}

      {renderImportWizard()}

      {toast ? (
        <div className="eco-product-toast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              onClick={() => {
                const action = toast.onAction;
                setToast(null);
                action?.();
              }}
            >
              <Undo2 aria-hidden className="eco-icon" />
              {toast.actionLabel}
            </button>
          ) : null}
          <button type="button" className="eco-product-toast-close" onClick={() => setToast(null)} aria-label="Закрыть уведомление">
            <X aria-hidden className="eco-icon" />
          </button>
        </div>
      ) : null}

      {!formOpen ? (
      <section className="eco-products-shell">
        <div className="eco-products-head">
          <div className="eco-products-head-copy">
            <div className="eco-title-row eco-products-title-row">
              <h1 className="eco-page-title">Товары</h1>
              <span className="eco-products-count-badge">{visibleProductsLabel} / {totalProductsLabel}</span>
            </div>
          </div>
          <div className="eco-products-actions">
            <div className="eco-product-export-menu" ref={exportMenuRef}>
              <button
                type="button"
                className="eco-btn"
                onClick={() => setExportMenuOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
              >
                <Download aria-hidden className="eco-icon" />
                Экспорт
              </button>
              {exportMenuOpen ? (
                <div className="eco-product-export-popover" role="menu">
                  <button type="button" role="menuitem" onClick={() => downloadProductsExport("all")}>Все товары</button>
                  <button type="button" role="menuitem" onClick={() => downloadProductsExport("current")}>Текущая выборка</button>
                  <button type="button" role="menuitem" onClick={() => downloadProductsExport("selected")}>Выбранные строки ({selectedProductIds.length})</button>
                  <button type="button" role="menuitem" onClick={() => downloadProductsExport("active")}>Только активные</button>
                  <button type="button" role="menuitem" onClick={() => downloadProductsExport("archived")}>Архивные</button>
                  <button type="button" role="menuitem" onClick={downloadTemplate}>Скачать пустой шаблон</button>
                  <button type="button" role="menuitem" onClick={openImportHistory}>История экспортов/импортов</button>
                </div>
              ) : null}
            </div>
            <button type="button" className="eco-btn" onClick={openImportWizard}>
              <Upload aria-hidden className="eco-icon" />
              Импорт
            </button>
            <button
              type="button"
              onClick={openNewProduct}
              className="eco-btn eco-btn--primary"
            >
              <Plus aria-hidden className="eco-icon" />
              Новый товар
            </button>
          </div>
        </div>

        <div className={filtersLayoutClass}>
          <div className="eco-filter-slot">
            <button
              type="button"
              className="eco-filter-drawer-backdrop"
              onClick={() => setFiltersDrawerOpen(false)}
              aria-label="Закрыть фильтры"
            />
            <button
              type="button"
              className="eco-filter-reopen"
              onClick={() => setFiltersCollapsed(false)}
              title="Фильтры"
              aria-label="Показать фильтры"
            >
              <SlidersHorizontal aria-hidden className="eco-icon" />
              <span>Фильтры</span>
              {activeFiltersCount > 0 ? <b>{activeFiltersCount}</b> : null}
            </button>
            <aside className="eco-filter-rail" aria-label="Фильтры товаров">
              <div className="eco-filter-panel-head">
                <div className="eco-filter-panel-title">
                  <span>Фильтры</span>
                  {activeFiltersCount > 0 ? <b>{activeFiltersCount}</b> : null}
                </div>
                <button
                  type="button"
                  className="eco-filter-collapse"
                  onClick={() => setFiltersCollapsed(true)}
                >
                  <PanelLeftClose aria-hidden className="eco-icon" />
                  <span>Скрыть фильтры</span>
                </button>
                <button
                  type="button"
                  className="eco-filter-close-mobile"
                  onClick={() => setFiltersDrawerOpen(false)}
                  aria-label="Закрыть фильтры"
                >
                  <X aria-hidden className="eco-icon" />
                </button>
              </div>
            <div className="eco-filter-group">
              <div className="eco-filter-title">
                Поиск
                {hasActiveSearchOrFilters ? (
                  <button type="button" onClick={resetAll} className="text-[var(--eco-rust)]">× очистить всё</button>
                ) : null}
              </div>
              <div className="eco-search-wrap w-full">
                {loading ? <Loader2 aria-hidden className="eco-icon animate-spin" /> : <Search aria-hidden className="eco-icon" />}
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setSearch("");
                  }}
                  placeholder="Название, артикул, OEM, бренд..."
                  className="eco-input"
                />
                {search.trim() ? (
                  <button type="button" className="eco-search-clear" onClick={() => setSearch("")} aria-label="Очистить поиск">
                    <X aria-hidden className="eco-icon" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="eco-filter-group">
              <div className="eco-filter-title">Маркировка</div>
              <button
                type="button"
                className={`eco-filter-row ${filters.markingProblems ? "is-active" : ""}`}
                onClick={toggleMarkingProblemsFilter}
              >
                <span className="eco-filter-row-label">
                  <span className={`eco-check ${filters.markingProblems ? "is-checked" : ""}`} />
                  Проблемы маркировки
                </span>
              </button>
            </div>

            {renderFacetFilter("group", 7)}
            {renderFacetFilter("brand", 8)}
            {renderFacetFilter("sae", 8)}

            <div className="eco-filter-group">
              <div className="eco-filter-title">Остаток</div>
              {stockOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`eco-filter-row ${filters.stock === option.value ? "is-active" : ""}`}
                  onClick={() => changeStockFilter(option.value)}
                >
                  <span className="eco-filter-row-label">
                    <span className={`eco-check ${filters.stock === option.value ? "is-checked" : ""}`} />
                    {option.label}
                  </span>
                  <span className="ct">{(facets.stock[option.value] ?? 0).toLocaleString("ru-RU")}</span>
                </button>
              ))}
            </div>
            </aside>
          </div>

          <div className="eco-inventory-main">
            <button type="button" className="eco-filter-mobile-toggle" onClick={() => setFiltersDrawerOpen(true)}>
              <SlidersHorizontal aria-hidden className="eco-icon" />
              <span>Фильтры</span>
              {activeFiltersCount > 0 ? <b>{activeFiltersCount}</b> : null}
            </button>

        {(hasActiveSearchOrFilters || selectedProductIds.length > 0) ? (
          <div className="eco-products-strip">
            <div className="eco-products-chips">
              {activeFilterChips().map((chip) => (
                <button key={chip.key} type="button" className="eco-pill is-active eco-filter-chip" onClick={chip.onRemove}>
                  <span>{chip.label}</span>
                  <X aria-hidden className="eco-icon" />
                </button>
              ))}
              {hasActiveSearchOrFilters && (
                <button type="button" className="eco-pill is-dashed" onClick={resetAll}>
                  × Сбросить всё
                </button>
              )}
            </div>
            <div className="eco-products-strip-meta">
              {selectedProductIds.length > 0 ? <span>Выбрано: {selectedProductIds.length.toLocaleString("ru-RU")}</span> : null}
              <span>{visibleProductsLabel} из {totalProductsLabel}</span>
            </div>
          </div>
        ) : null}

        {((error && !(error === "Не удалось выполнить поиск" && rows.length === 0)) || info) && (
          <div className={`eco-products-notice ${error ? "is-error" : "is-success"}`}>
            {error || info}
          </div>
        )}

        <div className="eco-table-wrap">
          <table className="eco-table eco-product-table">
            <thead>
              <tr>
                <th style={{ width: 42 }}>
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && rows.every((row) => selectedProductIds.includes(row.id))}
                    onChange={toggleVisibleProductsSelection}
                    aria-label="Выбрать видимые товары"
                  />
                </th>
                <th>{sortHeader("Название / категория", "name")}</th>
                <th>Ячейка</th>
                <th style={{ textAlign: "right" }}>{sortHeader("Остаток", "quantity", "right")}</th>
                <th style={{ textAlign: "right" }}>{sortHeader("Доступно", "available", "right")}</th>
                <th style={{ textAlign: "right" }}>{sortHeader("Закуп.", "buyPrice", "right")}</th>
                <th style={{ textAlign: "right" }}>{sortHeader("Цена", "salePrice", "right")}</th>
                <th style={{ textAlign: "right" }}>{sortHeader("Маржа", "margin", "right")}</th>
                <th style={{ width: 84 }} />
              </tr>
            </thead>
            <tbody>
              {loading && (
                renderSkeletonRows()
              )}
              {!loading && error === "Не удалось выполнить поиск" && rows.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="eco-products-empty is-error">
                      <strong>Не удалось выполнить поиск</strong>
                      <span>Попробуйте обновить страницу или изменить запрос.</span>
                      <button type="button" className="eco-btn eco-btn--sm" onClick={() => void load(search, sort, direction, filters)}>
                        Повторить
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {!loading && !(error === "Не удалось выполнить поиск" && rows.length === 0) && rows.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="eco-products-empty">
                      <strong>{emptyStateCopy().title}</strong>
                      <span>{emptyStateCopy().text}</span>
                      <div className="eco-products-empty-actions">
                        {activeFiltersCount > 0 ? (
                          <button type="button" className="eco-btn eco-btn--sm" onClick={resetFilters}>
                            Сбросить фильтры
                          </button>
                        ) : null}
                        {search.trim() ? (
                          <button type="button" className="eco-btn eco-btn--sm" onClick={() => setSearch("")}>
                            Очистить поиск
                          </button>
                        ) : null}
                        <button type="button" className="eco-btn eco-btn--primary eco-btn--sm" onClick={openNewProduct}>
                          Создать товар
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {!loading && !(error === "Не удалось выполнить поиск" && rows.length === 0) && rows.map((row) => {
                const markingBadge = productMarkingListBadge(row);
                return (
                <tr key={row.id} className={row.archived ? "is-archived" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedProductIds.includes(row.id)}
                      onChange={() => toggleProductSelection(row.id)}
                      aria-label={`Выбрать ${row.name}`}
                    />
                  </td>
                  <td className="eco-product-name-cell">
                    <div className="eco-product-title">{row.name}</div>
                    <div className="eco-product-meta">
                      {usefulProductMetaLines(row).map((line) => (
                        <span key={line}>{line}</span>
                      ))}
                      {markingBadge.tone !== "muted" ? (
                        <span
                          className={`eco-product-marking-badge is-${markingBadge.tone}`}
                          title={markingBadge.title}
                        >
                          {markingBadge.label}
                        </span>
                      ) : null}
                      {row.archived ? <span className="eco-product-archive-badge">В архиве</span> : null}
                    </div>
                  </td>
                  <td className="eco-product-cell">{row.cell || "—"}</td>
                  <td className="eco-product-number">
                    <span className={`eco-stock-badge ${row.totalQuantity > 0 ? "is-positive" : "is-empty"}`}>{formatQty(row.totalQuantity)}</span>
                  </td>
                  <td className="eco-product-number">
                    {formatQty(row.totalAvailable)}
                  </td>
                  <td className="eco-product-number is-muted">
                    {row.buyPrice == null ? "—" : formatMoneyWhole(row.buyPrice)}
                  </td>
                  <td className="eco-product-price">
                    <strong>{formatMoneyWhole(row.salePrice)}</strong>
                    <span>₽</span>
                  </td>
                  <td className="eco-product-margin">
                    {marginPercent(row) == null ? "—" : `${marginPercent(row)}%`}
                  </td>
                  <td className="eco-product-actions">
                    <button
                      type="button"
                      onClick={() => openProductEditor(row)}
                      className="eco-icon-action"
                      aria-label="Править"
                      title="Редактировать"
                    >
                      <Pencil aria-hidden className="eco-icon" />
                    </button>
                    {renderRowActionsMenu(row)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div ref={loadMoreTargetRef} className="eco-products-load-sentinel" />
        {meta && rows.length > 0 && (
          <div className="eco-products-footer">
            <span>
              Показано {rows.length} из {meta.total}
            </span>
            {meta.hasMore ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading || loadingMore}
                className="eco-btn eco-btn--sm"
              >
                {loadingMore ? "Загружаю..." : "Показать ещё"}
              </button>
            ) : (
              <span>Все найденные товары загружены.</span>
            )}
          </div>
        )}
          </div>
        </div>
      </section>
      ) : null}
    </div>
  );
}
