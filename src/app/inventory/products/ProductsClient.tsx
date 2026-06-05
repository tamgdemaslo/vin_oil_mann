"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  History,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  PackageOpen,
  PanelLeftClose,
  Pencil,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import MoneyInput, { parseMoneyInput } from "@/components/MoneyInput";

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
type ProductListResponse = { meta?: ProductListMeta; products?: ProductRow[]; error?: string };
type ProductToast = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

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

type ProductEditorSectionId = "main" | "pricing" | "codes" | "oil" | "extra" | "technical";

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
};

const searchImpactFields = new Set<keyof ProductForm>([
  "name",
  "article",
  "code",
  "brand",
  "groupPath",
  "barcodeEan13",
  "oem",
]);

const shipmentImpactFields = new Set<keyof ProductForm>([
  "name",
  "entityType",
  "salePrice",
  "uomName",
  "minimumBalance",
  "cell",
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
};

const technicalFieldLabels: Array<{ key: keyof ProductForm; label: string; type?: "number" | "textarea"; aliases?: string[] }> = [
  { key: "externalCode", label: "Внешний код", aliases: ["external code"] },
  { key: "modificationCode", label: "Код модификации" },
  { key: "supplierAttribute", label: "Supplier raw field", aliases: ["supplier"] },
  { key: "mannCharacteristicName", label: "Характеристика Mann" },
  { key: "oemAtf", label: "OEM ATF", type: "textarea" },
];

const productEditorSections: Array<{ id: ProductEditorSectionId; label: string; aliases: string[] }> = [
  {
    id: "main",
    label: "Основное",
    aliases: ["главное", "название", "артикул", "код", "тип", "бренд", "группа", "единица", "ean", "oem"],
  },
  {
    id: "pricing",
    label: "Цены и склад",
    aliases: ["цена", "закупка", "валюта", "минимальная цена", "остаток", "доступно", "резерв", "поставщик", "ндс", "ячейка"],
  },
  {
    id: "codes",
    label: "Коды и OEM",
    aliases: ["коды", "штрихкод", "barcode", "ean8", "code128", "oem", "кроссы", "rossko", "внешний артикул"],
  },
  {
    id: "oil",
    label: "Характеристики",
    aliases: ["характеристики", "масло", "жидкость", "sae", "api", "acea", "ilsac", "atf", "объем", "фасовка"],
  },
  {
    id: "extra",
    label: "Дополнительно",
    aliases: ["описание", "страна", "тн вэд", "вес", "авито", "справочная информация"],
  },
  {
    id: "technical",
    label: "Технические",
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

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
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

type MultiFilterKey = Exclude<keyof ProductFilters, "stock">;
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

function isOilProduct(form: ProductForm) {
  return [form.groupPath, form.name, form.sae, form.apiSpec, form.acea, form.packageVolume]
    .join(" ")
    .toLowerCase()
    .replace(/ё/g, "е")
    .match(/масл|oil|sae|вязк|atf|трансмисс/) != null;
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

function formFromProduct(product: ProductRow): ProductForm {
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
  };
}

export default function ProductsClient() {
  const searchParams = useSearchParams();
  const initialProductId = searchParams.get("product")?.trim() ?? "";
  const initialSearch = searchParams.get("search")?.trim() ?? "";
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [meta, setMeta] = useState<ProductListMeta | null>(null);
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
  const [formErrors, setFormErrors] = useState<ProductFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formSearch, setFormSearch] = useState("");
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
  const [archiveCandidate, setArchiveCandidate] = useState<ProductRow | null>(null);
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const facetOrderRef = useRef<FacetOrderState>(createFacetOrderState());
  const facetPreviewPinsRef = useRef<FacetPreviewPinState>(createFacetPreviewPinState());
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const loadMoreTargetRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const initialLoadStartedRef = useRef(false);

  const editingProduct = useMemo(
    () => activeProduct ?? rows.find((row) => row.id === editingId) ?? null,
    [activeProduct, editingId, rows]
  );
  const editingName = editingProduct?.name ?? "";
  const filterOptions = meta?.filterOptions ?? emptyFilterOptions;
  const facets = meta?.facets ?? emptyFacets;
  const groupOptions = useMemo(() => {
    const values = new Set(filterOptions.groups);
    const currentGroup = form.groupPath.trim();
    if (currentGroup) values.add(currentGroup);
    return [...values].sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));
  }, [filterOptions.groups, form.groupPath]);

  const activeFiltersCount = useMemo(
    () => Object.entries(filters).reduce((count, [key, value]) => {
      if (key === "stock") return count + (value !== "all" ? 1 : 0);
      return count + (Array.isArray(value) ? value.length : 0);
    }, 0),
    [filters]
  );
  const hasActiveSearchOrFilters = Boolean(search.trim()) || activeFiltersCount > 0;
  const filtersLayoutClass = [
    "eco-inventory-layout",
    filtersCollapsed ? "is-filter-collapsed" : "",
    filtersDrawerOpen ? "is-filter-drawer-open" : "",
  ].filter(Boolean).join(" ");
  const formDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(formBaseline),
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
  const completionItems = useMemo(() => [
    { label: "Название", ok: Boolean(form.name.trim()) },
    { label: "Артикул или код", ok: Boolean(form.article.trim() || form.code.trim()) },
    { label: "Цена", ok: parseMoneyInput(form.salePrice) > 0 },
    { label: "Группа", ok: Boolean(form.groupPath.trim()) },
    { label: "Единица", ok: Boolean(form.uomName.trim()) },
    { label: "Поставщик", ok: Boolean(form.supplierName.trim()) },
    {
      label: "OEM / EAN",
      ok: Boolean(
        form.oem.trim()
        || form.oemParts.trim()
        || form.barcodeEan13.trim()
        || form.barcodeEan8.trim()
        || form.barcodeCode128.trim()
      ),
    },
  ], [form]);
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
      const res = await fetch(`/api/local-inventory/products?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await readJson<ProductListResponse>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить товары");
      setRows(Array.isArray(data?.products) ? data.products : []);
      setMeta(data?.meta ?? null);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("[inventory-products] list load failed:", e);
      setError("Не удалось выполнить поиск");
      setRows([]);
      setMeta(null);
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
      const res = await fetch(`/api/local-inventory/products?${params.toString()}`, {
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
      if (target instanceof Node && actionMenuRef.current?.contains(target)) return;
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
    setForm((prev) => ({ ...prev, ...patch }));
    setFormError(null);
    setFormErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch) as Array<keyof ProductForm>) {
        delete next[key];
      }
      return next;
    });
  }

  function resetForm() {
    setEditingId(null);
    setActiveProduct(null);
    setForm(emptyForm);
    setFormBaseline(emptyForm);
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
        {Array.from({ length: 8 }, (_cell, cellIndex) => (
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
      <div className="eco-product-actions-menu-wrap" ref={isOpen ? actionMenuRef : null}>
        <button
          type="button"
          className="eco-icon-action"
          title="Действия"
          aria-label="Действия"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={(event) => {
            event.stopPropagation();
            setActiveActionMenuId((current) => current === row.id ? null : row.id);
          }}
        >
          <MoreHorizontal aria-hidden className="eco-icon" />
        </button>
        {isOpen ? (
          <div className="eco-product-actions-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setActiveActionMenuId(null);
                openProductEditor(row);
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
                openProductEditor(row);
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
                openSimilarProduct(row);
              }}
            >
              <Copy aria-hidden className="eco-icon" />
              <span>Создать похожий</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openProductHistory(row)}>
              <History aria-hidden className="eco-icon" />
              <span>История / движения</span>
            </button>
            <div className="eco-product-actions-separator" role="separator" />
            {row.archived ? (
              <button
                type="button"
                role="menuitem"
                className="is-restore"
                onClick={() => void restoreProduct(row)}
              >
                <ArchiveRestore aria-hidden className="eco-icon" />
                <span>Восстановить из архива</span>
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="is-destructive"
                onClick={() => requestArchive(row)}
              >
                <Archive aria-hidden className="eco-icon" />
                <span>В архив</span>
              </button>
            )}
          </div>
        ) : null}
      </div>
    );
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
        supplierName: form.supplierName.trim() || undefined,
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
        mannName: form.mannName.trim() || undefined,
        rosskoPartNumber: form.rosskoPartNumber.trim() || undefined,
        rosskoBrand: form.rosskoBrand.trim() || undefined,
        rosskoMin: form.rosskoMin.trim() || undefined,
        supplierAttribute: form.supplierAttribute.trim() || undefined,
        oemParts: form.oemParts.trim() || undefined,
        cell: form.cell.trim() || undefined,
        mannCharacteristicName: form.mannCharacteristicName.trim() || undefined,
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
      setRows((prev) => [data, ...prev.filter((row) => row.id !== data.id)]);
      setActiveProduct(data);
      setEditingId(data.id);
      setForm(savedForm);
      setFormBaseline(savedForm);
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
          <textarea
            id={inputId}
            value={form[key]}
            rows={options.rows ?? 3}
            placeholder={options.placeholder}
            onChange={(event) => updateForm({ [key]: event.target.value } as Partial<ProductForm>)}
            className={inputClass}
          />
        ) : options.type === "money" ? (
          <MoneyInput
            id={inputId}
            value={form[key]}
            placeholder={options.placeholder}
            onValueChange={(value, draft) => updateForm({ [key]: draft ? String(value) : "" } as Partial<ProductForm>)}
            className={inputClass}
          />
        ) : (
          <input
            id={inputId}
            type={options.type === "number" ? "number" : "text"}
            step={options.step ?? (options.type === "number" ? "0.001" : undefined)}
            value={form[key]}
            placeholder={options.placeholder}
            onChange={(event) => updateForm({ [key]: event.target.value } as Partial<ProductForm>)}
            className={inputClass}
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
            updateForm({ groupPath: event.target.value });
          }}
          className={`eco-input product-editor-input ${errorMessage ? "has-error" : ""}`}
        >
          <option value="">Без группы</option>
          {groupOptions.map((group) => (
            <option key={group} value={group}>{group}</option>
          ))}
          <option value={NEW_GROUP_VALUE}>Новая группа...</option>
        </select>
        {newGroupMode ? (
          <input
            value={form.groupPath}
            onChange={(event) => updateForm({ groupPath: event.target.value })}
            placeholder="Название новой группы"
            className="eco-input product-editor-input"
          />
        ) : null}
        {errorMessage ? <span className="product-editor-error">{errorMessage}</span> : null}
      </label>
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

  return (
    <div className="space-y-5">
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
                      {renderField("code", "Код", { required: true, placeholder: "30015649815" })}
                      {renderEntityTypeField()}
                      {renderField("brand", "Бренд", { placeholder: "Mobil" })}
                      {renderGroupField()}
                      {renderField("uomName", "Единица", { required: true, placeholder: "шт" })}
                      {renderField("salePrice", "Цена продажи", { type: "money", required: true, placeholder: "0,00" })}
                      {renderField("buyPrice", "Цена закупки", { type: "money", placeholder: "0,00" })}
                      {renderField("minimumBalance", "Неснижаемый остаток", { type: "number", placeholder: "0" })}
                      {renderField("cell", "Ячейка склада", { placeholder: "A-12" })}
                      {renderField("barcodeEan13", "EAN / штрихкод", { placeholder: "460..." })}
                      {renderField("oem", "OEM / основные кроссы", {
                        type: "textarea",
                        full: true,
                        rows: 3,
                        placeholder: "Разделяйте значения пробелом, запятой или новой строкой",
                        hint: "Разделяйте значения пробелом, запятой или новой строкой",
                      })}
                    </div>
                  </section>

                  <section id={productEditorSectionElementId("pricing")} className="product-editor-section product-editor-pricing-card">
                    <div className="product-editor-section-head">
                      <div>
                        <h3>Цены и склад</h3>
                        <p>Складские показатели и финансовые параметры перед продажей</p>
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
                    <div className="product-editor-grid product-editor-compact-grid">
                      {renderField("currencyName", "Валюта", { placeholder: "руб." })}
                      {renderField("minPrice", "Минимальная цена", { type: "money", placeholder: "0,00" })}
                      {renderField("minPriceCurrencyName", "Валюта мин. цены", { placeholder: "руб." })}
                      {renderField("vatLabel", "НДС", { placeholder: "Без НДС / 20%" })}
                      {renderField("supplierName", "Поставщик", { full: true, placeholder: "Название поставщика" })}
                    </div>
                  </section>

                  <section id={productEditorSectionElementId("codes")} className="product-editor-section">
                    <div className="product-editor-section-head">
                      <div>
                        <h3>Коды и OEM</h3>
                        <p>Поля, которые помогают находить товар и сопоставлять поставщиков</p>
                      </div>
                    </div>
                    <div className="product-editor-grid">
                      {renderField("barcodeEan8", "Штрихкод EAN8", { placeholder: "EAN8" })}
                      {renderField("barcodeCode128", "Штрихкод Code128", { placeholder: "Code128" })}
                      {renderField("oemParts", "OEM parts", {
                        type: "textarea",
                        full: true,
                        rows: 4,
                        placeholder: "Разделяйте значения пробелом, запятой или новой строкой",
                        hint: "Длинные списки можно вводить строками или через запятую",
                      })}
                      {renderField("rosskoPartNumber", "rossko_part_number", { placeholder: "Внешний артикул" })}
                      {renderField("rosskoBrand", "rossko_brand", { placeholder: "Бренд Rossko" })}
                      {renderField("rosskoMin", "rossko_min", { placeholder: "Минимум Rossko" })}
                    </div>
                  </section>

                  <section id={productEditorSectionElementId("oil")} className={`product-editor-section ${isOilProduct(form) ? "is-oil" : ""}`}>
                    <div className="product-editor-section-head">
                      <div>
                        <h3>Характеристики</h3>
                        <p>Вязкость, допуски, фасовка и справочные характеристики</p>
                      </div>
                      {isOilProduct(form) ? <span className="product-editor-type-badge">Масло / жидкость</span> : null}
                    </div>
                    <div className="product-editor-grid">
                      {renderField("sae", "SAE / вязкость", { placeholder: "5W-30" })}
                      {renderField("apiSpec", "API", { placeholder: "SN / SP" })}
                      {renderField("acea", "ACEA", { placeholder: "C3" })}
                      {renderField("aceaExtra", "ACEA A/B", { placeholder: "A3/B4" })}
                      {renderField("ilsac", "ILSAC", { placeholder: "GF-6" })}
                      {renderField("atf", "ATF", { placeholder: "Dexron VI" })}
                      {renderField("packageVolume", "Фасовка", { placeholder: "1 л / 4 л" })}
                      {renderField("volume", "Объём", { type: "number", placeholder: "1" })}
                      {renderField("mannName", "Наименование по Mann", { full: true, placeholder: "Mann reference" })}
                    </div>
                  </section>

                  <details
                    id={productEditorSectionElementId("extra")}
                    className="product-editor-section product-editor-extra-details"
                    open={extraOpen || highlightedEditorSections.has("extra")}
                    onToggle={(event) => setExtraOpen(event.currentTarget.open)}
                  >
                    <summary>
                      <span>
                        <b>Дополнительно</b>
                        <em>Описание, страна, ТН ВЭД и второстепенные параметры</em>
                      </span>
                    </summary>
                    <div className="product-editor-grid">
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

      <section className="eco-products-shell">
        <div className="eco-products-head">
          <div>
            <div className="eco-products-breadcrumb">Главная / Склад / Товары</div>
            <h2 className="eco-page-title">
              Товары
              <span className="muted" style={{ fontSize: 18, fontWeight: 600 }}> · {rows.length} из {meta?.total ?? rows.length}</span>
            </h2>
          </div>
          <div className="eco-products-actions">
            <button type="button" className="eco-btn">
              Выгрузить
            </button>
            <button
              type="button"
              onClick={openNewProduct}
              className="eco-btn eco-btn--primary"
            >
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
          <span className="l-meta">{rows.length}{meta?.hasMore ? "+" : ""} из {meta?.total ?? rows.length} артикулов</span>
        </div>

        {((error && !(error === "Не удалось выполнить поиск" && rows.length === 0)) || info) && (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
              : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
          }`}>
            {error || info}
          </div>
        )}

        <div className="eco-table-wrap">
          <table className="eco-table eco-product-table">
            <thead>
              <tr>
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
                  <td colSpan={8}>
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
                  <td colSpan={8}>
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
              {!loading && !(error === "Не удалось выполнить поиск" && rows.length === 0) && rows.map((row) => (
                <tr key={row.id}>
                  <td className="eco-product-name-cell">
                    <div className="eco-product-title">{row.name}</div>
                    <div className="eco-product-meta">
                      {usefulProductMetaLines(row).map((line) => (
                        <span key={line}>· {line}</span>
                      ))}
                      {row.archived ? <span className="eco-product-archive-badge">В архиве</span> : null}
                    </div>
                  </td>
                  <td className="eco-product-cell">{row.cell || "—"}</td>
                  <td className="eco-product-number">
                    <span className="eco-stock-badge">{formatQty(row.totalQuantity)}</span>
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
              ))}
            </tbody>
          </table>
        </div>
        <div ref={loadMoreTargetRef} className="h-1" />
        {meta && rows.length > 0 && (
          <div className="mt-3 flex flex-col gap-2 text-sm text-zinc-500 dark:text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Показано {rows.length} из {meta.total}
            </span>
            {meta.hasMore ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading || loadingMore}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
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
    </div>
  );
}
