"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MoreHorizontal, Pencil, Search } from "lucide-react";
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
  brand: string;
  sae: string;
  supplier: string;
  group: string;
  entityType: string;
  apiSpec: string;
  acea: string;
  packageVolume: string;
  stock: StockFilter;
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
};
type ProductListResponse = { meta?: ProductListMeta; products?: ProductRow[]; error?: string };

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

const productExtraFields: Array<{ key: keyof ProductForm; label: string; type?: "number" | "textarea" }> = [
  { key: "externalCode", label: "Внешний код" },
  { key: "groupPath", label: "Группы" },
  { key: "uomName", label: "Единица" },
  { key: "minimumBalance", label: "Неснижаемый остаток", type: "number" },
  { key: "barcodeEan13", label: "Штрихкод EAN13" },
  { key: "barcodeEan8", label: "Штрихкод EAN8" },
  { key: "barcodeCode128", label: "Штрихкод Code128" },
  { key: "description", label: "Описание", type: "textarea" },
  { key: "minPrice", label: "Минимальная цена", type: "number" },
  { key: "minPriceCurrencyName", label: "Валюта мин. цены" },
  { key: "countryName", label: "Страна" },
  { key: "vatLabel", label: "НДС" },
  { key: "supplierName", label: "Поставщик" },
  { key: "weight", label: "Вес", type: "number" },
  { key: "volume", label: "Объём", type: "number" },
  { key: "modificationCode", label: "Код модификации" },
  { key: "tnvedCode", label: "Код ТН ВЭД" },
  { key: "brand", label: "Brand" },
  { key: "sae", label: "SAE" },
  { key: "oem", label: "OEM", type: "textarea" },
  { key: "acea", label: "ACEA" },
  { key: "apiSpec", label: "API" },
  { key: "packageVolume", label: "Объём упаковки" },
  { key: "atf", label: "ATF" },
  { key: "ilsac", label: "ILSAC" },
  { key: "aceaExtra", label: "ACEA (!)" },
  { key: "oemAtf", label: "OEM ATF", type: "textarea" },
  { key: "mannName", label: "Наиминование по Mann" },
  { key: "rosskoPartNumber", label: "rossko_part_number" },
  { key: "rosskoBrand", label: "rossko_brand" },
  { key: "rosskoMin", label: "rossko_min" },
  { key: "supplierAttribute", label: "Supplier" },
  { key: "oemParts", label: "OEM PARTS", type: "textarea" },
  { key: "cell", label: "Ячейка" },
  { key: "mannCharacteristicName", label: "Характеристика: Нименование по Mann" },
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
  brand: "",
  sae: "",
  supplier: "",
  group: "",
  entityType: "",
  apiSpec: "",
  acea: "",
  packageVolume: "",
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

const stockOptions: Array<{ value: StockFilter; label: string }> = [
  { value: "all", label: "Все остатки" },
  { value: "inStock", label: "В наличии" },
  { value: "outOfStock", label: "Нет на остатке" },
];
const PRODUCT_PAGE_LIMIT = 50;
const NEW_GROUP_VALUE = "__new_group__";
const DEFAULT_GROUP_LABEL = "Моторное масло";
const BRAND_ORDER = ["Shell", "Mobil", "ZIC", "Total", "Lukoil", "Bardahl", "ELF", "BMW", "Mann", "ZF", "VAG"];
const PINNED_CATEGORY_LABELS = ["Моторное масло", "Фильтр масляный", "Трансмиссионное", "Расходник"];

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

function findDefaultGroup(groups: string[]) {
  return groups.find((group) => normalizedGroupLabel(group) === normalizedGroupLabel(DEFAULT_GROUP_LABEL)) ?? "";
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

function uniqueSortedStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));
}

function usefulProductMetaLines(row: ProductRow) {
  const compactMeta = [displayBrandLabel(row.brand), row.packageVolume]
    .filter((value) => value && value !== "-")
    .join(" · ");
  return [compactMeta || shortGroupLabel(row.groupPath)].filter(Boolean);
}

function formatFileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
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
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [meta, setMeta] = useState<ProductListMeta | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ProductFilters>(emptyFilters);
  const [sort, setSort] = useState<ProductSortKey>("name");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const loadMoreTargetRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const defaultGroupAppliedRef = useRef(false);

  const editingProduct = useMemo(
    () => rows.find((row) => row.id === editingId) ?? null,
    [editingId, rows]
  );
  const editingName = editingProduct?.name ?? "";
  const filterOptions = meta?.filterOptions ?? emptyFilterOptions;
  const groupOptions = useMemo(() => {
    const values = new Set(filterOptions.groups);
    const currentGroup = form.groupPath.trim();
    if (currentGroup) values.add(currentGroup);
    return [...values].sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));
  }, [filterOptions.groups, form.groupPath]);
  const visibleGroupOptions = useMemo(() => {
    const pinnedLabels = new Set(PINNED_CATEGORY_LABELS.map((label) => normalizedGroupLabel(label)));
    const groups = uniqueGroupsByLabel(filterOptions.groups).filter((group) => pinnedLabels.has(normalizedGroupLabel(group)));
    return groups.sort((a, b) => {
      const priorityDiff = categoryPriority(a) - categoryPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return shortGroupLabel(a).localeCompare(shortGroupLabel(b), "ru", { numeric: true, sensitivity: "base" });
    });
  }, [filterOptions.groups]);
  const visibleBrandOptions = useMemo(() => {
    const brands = uniqueSortedStrings(filterOptions.brands.concat(filters.brand)).filter((brand) => brand !== "-");
    return brands.sort((a, b) => {
      const priorityDiff = brandPriority(a) - brandPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" });
    });
  }, [filterOptions.brands, filters.brand]);

  const activeFiltersCount = useMemo(
    () => Object.entries(filters).filter(([key, value]) => key === "stock" ? value !== "all" : Boolean(value)).length,
    [filters]
  );

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
        if (value !== "all") params.set(key, value);
      } else if (value) {
        params.set(key, value);
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
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  async function syncMoySklad() {
    setSyncing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/local-inventory/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeProducts: true,
          includeStores: true,
          includeStock: true,
          includeCounterparties: false,
          includeDemands: false,
          wait: false,
        }),
      });
      const data = await readJson<{ started?: boolean; status?: { message?: string | null }; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось запустить синхронизацию");
      setInfo(data?.started === false ? (data?.status?.message ?? "Синхронизация уже выполняется") : "Синхронизация МойСклад запущена");
      await load(search, sort, direction, filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void load("");
    return () => {
      listAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (defaultGroupAppliedRef.current || !filterOptions.groups.length || filters.group || search.trim()) return;
    const defaultGroup = findDefaultGroup(filterOptions.groups);
    if (!defaultGroup) return;
    defaultGroupAppliedRef.current = true;
    const nextFilters = { ...emptyFilters, group: defaultGroup };
    setFilters(nextFilters);
    void load(search, sort, direction, nextFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterOptions.groups, filters.group, search, sort, direction]);

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
        setEditingId(product.id);
        setForm(formFromProduct(product));
        setNewGroupMode(false);
        setUploadingPhotos(false);
        setDeletingPhotoId(null);
        setInfo(null);
        setFormOpen(true);
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
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setNewGroupMode(false);
    setUploadingPhotos(false);
    setDeletingPhotoId(null);
    setFormOpen(false);
  }

  function openNewProduct() {
    setEditingId(null);
    setForm(emptyForm);
    setNewGroupMode(false);
    setUploadingPhotos(false);
    setDeletingPhotoId(null);
    setInfo(null);
    setError(null);
    setFormOpen(true);
  }

  function changeSort(key: ProductSortKey) {
    const option = sortOptions.find((item) => item.key === key);
    const nextDirection = sort === key
      ? direction === "asc" ? "desc" : "asc"
      : option?.defaultDirection ?? "asc";
    setSort(key);
    setDirection(nextDirection);
    void load(search, key, nextDirection, filters);
  }

  function changeFilter(key: keyof ProductFilters, value: string) {
    const nextFilters = { ...filters, [key]: key === "stock" ? value as StockFilter : value };
    setFilters(nextFilters);
    void load(search, sort, direction, nextFilters);
  }

  function resetFilters() {
    setFilters(emptyFilters);
    void load(search, sort, direction, emptyFilters);
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

  async function submit() {
    setSaving(true);
    setError(null);
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
      setInfo(editingId ? "Товар обновлён" : "Товар добавлен");
      resetForm();
      await load(search, sort, direction, filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function archive(row: ProductRow) {
    if (!window.confirm(`Архивировать товар "${row.name}"?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/local-inventory/products/${row.id}`, { method: "DELETE" });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось архивировать товар");
      await load(search, sort, direction, filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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
      await load(search, sort, direction, filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      await load(search, sort, direction, filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingPhotoId(null);
    }
  }

  return (
    <div className="space-y-5">
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-3 py-6 backdrop-blur-sm sm:px-6">
          <section
            role="dialog"
            aria-modal="true"
            className="w-full max-w-3xl rounded-lg border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
        <div>
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {editingId ? "Редактирование товара" : "Новый товар"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {editingId ? editingName : "Карточка будет создана только в локальной БД."}
          </p>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Название *</span>
            <input
              value={form.name}
              onChange={(event) => updateForm({ name: event.target.value })}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Артикул</span>
              <input
                value={form.article}
                onChange={(event) => updateForm({ article: event.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Код</span>
              <input
                value={form.code}
                onChange={(event) => updateForm({ code: event.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Тип</span>
            <select
              value={form.entityType}
              onChange={(event) => updateForm({ entityType: event.target.value })}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="product">Товар</option>
              <option value="variant">Модификация</option>
              <option value="bundle">Комплект</option>
              <option value="service">Услуга</option>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Цена продажи</span>
              <MoneyInput
                value={form.salePrice}
                onValueChange={(salePrice, draft) => updateForm({ salePrice: draft ? String(salePrice) : "" })}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Цена закупки</span>
              <MoneyInput
                value={form.buyPrice}
                onValueChange={(buyPrice, draft) => updateForm({ buyPrice: draft ? String(buyPrice) : "" })}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Валюта</span>
            <input
              value={form.currencyName}
              onChange={(event) => updateForm({ currencyName: event.target.value })}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Фотографии</h3>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {editingId ? "Можно прикрепить несколько изображений к карточке товара." : "Фото можно добавить после создания товара."}
                </p>
              </div>
              <label
                className={`inline-flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium ${
                  editingId && !uploadingPhotos
                    ? "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    : "pointer-events-none border-zinc-200 text-zinc-400 dark:border-zinc-800"
                }`}
              >
                {uploadingPhotos ? "Загрузка..." : "Прикрепить фото"}
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
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {editingProduct.photos.map((photo) => (
                  <div key={photo.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="aspect-square bg-zinc-100 dark:bg-zinc-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt={photo.fileName || "Фото товара"} className="h-full w-full object-cover" />
                    </div>
                    <div className="space-y-2 p-2">
                      <div className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">
                        {photo.fileName || "Фото товара"}
                      </div>
                      <div className="text-xs text-zinc-500">{formatFileSize(photo.sizeBytes)}</div>
                      <button
                        type="button"
                        onClick={() => void deleteProductPhoto(photo.id)}
                        disabled={deletingPhotoId === photo.id}
                        className="w-full rounded-lg border border-red-200 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        {deletingPhotoId === photo.id ? "Удаление..." : "Удалить"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
                Фото пока не прикреплены.
              </div>
            )}
          </section>
          <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" open={Boolean(editingId)}>
            <summary className="cursor-pointer text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              Дополнительные поля
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="text-xs font-medium text-zinc-500">Авито</span>
                <select
                  value={form.avito}
                  onChange={(event) => updateForm({ avito: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="">Не указано</option>
                  <option value="true">Да</option>
                  <option value="false">Нет</option>
                </select>
              </label>
              {productExtraFields.map((field) => (
                <label
                  key={field.key}
                  className={`block text-sm ${field.type === "textarea" || field.key === "groupPath" ? "sm:col-span-2" : ""}`}
                >
                  <span className="text-xs font-medium text-zinc-500">{field.label}</span>
                  {field.key === "groupPath" ? (
                    <div className="mt-1 space-y-2">
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
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                      >
                        <option value="">Без группы</option>
                        {groupOptions.map((group) => (
                          <option key={group} value={group}>{group}</option>
                        ))}
                        <option value={NEW_GROUP_VALUE}>Новая группа...</option>
                      </select>
                      {newGroupMode && (
                        <input
                          value={form.groupPath}
                          onChange={(event) => updateForm({ groupPath: event.target.value })}
                          placeholder="Название новой группы"
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                        />
                      )}
                    </div>
                  ) : field.type === "textarea" ? (
                    <textarea
                      value={form[field.key]}
                      rows={2}
                      onChange={(event) => updateForm({ [field.key]: event.target.value } as Partial<ProductForm>)}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  ) : field.key === "minPrice" ? (
                    <MoneyInput
                      value={form.minPrice}
                      onValueChange={(minPrice, draft) =>
                        updateForm({ minPrice: draft ? String(minPrice) : "" })
                      }
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      step={field.type === "number" ? "0.001" : undefined}
                      value={form[field.key]}
                      onChange={(event) => updateForm({ [field.key]: event.target.value } as Partial<ProductForm>)}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  )}
                </label>
              ))}
            </div>
          </details>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950"
          >
            {saving ? "Сохранение..." : editingId ? "Сохранить" : "Добавить"}
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Отмена
          </button>
        </div>
      </section>
        </div>
      )}

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
            <button type="button" className="eco-btn" onClick={() => void syncMoySklad()} disabled={syncing}>
              {syncing ? "Синхр..." : "Синхр. МойСклад"}
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

        <div className="eco-inventory-layout">
          <aside className="eco-filter-rail">
            <div className="eco-filter-group">
              <div className="eco-filter-title">
                Поиск
                <button type="button" onClick={resetFilters} className="text-[var(--eco-rust)]">× очистить</button>
              </div>
              <div className="eco-search-wrap w-full">
                <Search aria-hidden className="eco-icon" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void load(search, sort, direction, filters);
                  }}
                  placeholder="Артикул, OEM, бренд…"
                  className="eco-input"
                />
              </div>
            </div>

            <div className="eco-filter-group">
              <div className="eco-filter-title">Категория</div>
              {visibleGroupOptions.slice(0, 5).map((group) => (
                <button key={group} type="button" className="eco-filter-row" onClick={() => changeFilter("group", filters.group === group ? "" : group)}>
                  <span className="flex items-center gap-2">
                    <span className={`eco-check ${filters.group === group ? "is-checked" : ""}`} />
                    {shortGroupLabel(group)}
                  </span>
                  <span className="ct">—</span>
                </button>
              ))}
            </div>

            <div className="eco-filter-group">
              <div className="eco-filter-title">Бренд</div>
              {visibleBrandOptions.slice(0, 8).map((brand) => (
                <button key={brand} type="button" className="eco-filter-row" onClick={() => changeFilter("brand", filters.brand === brand ? "" : brand)}>
                  <span className="flex items-center gap-2">
                    <span className={`eco-check ${filters.brand === brand ? "is-checked" : ""}`} />
                    {displayBrandLabel(brand)}
                  </span>
                  <span className="ct">—</span>
                </button>
              ))}
            </div>

            <div className="eco-filter-group">
              <div className="eco-filter-title">SAE / Вязкость</div>
              <div className="flex flex-wrap gap-1">
                {filterOptions.sae.slice(0, 12).map((sae) => (
                  <button
                    key={sae}
                    type="button"
                    className={`eco-pill ${filters.sae === sae ? "is-active" : ""}`}
                    onClick={() => changeFilter("sae", filters.sae === sae ? "" : sae)}
                    style={{ height: 24, fontSize: 11 }}
                  >
                    {sae}
                  </button>
                ))}
              </div>
            </div>

            <div className="eco-filter-group">
              <div className="eco-filter-title">Остаток</div>
              {stockOptions.map((option) => (
                <button key={option.value} type="button" className="eco-filter-row" onClick={() => changeFilter("stock", option.value)}>
                  <span className="flex items-center gap-2">
                    <span className={`eco-check ${filters.stock === option.value ? "is-checked" : ""}`} />
                    {option.label}
                  </span>
                  <span className="ct">—</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="eco-inventory-main">

        <div className="eco-products-strip">
          <div className="eco-products-chips">
            {filters.group && <span className="eco-pill is-active">{shortGroupLabel(filters.group)}</span>}
            {filters.brand && <span className="eco-pill is-active">{displayBrandLabel(filters.brand)}</span>}
            {filters.sae && <span className="eco-pill is-active">{filters.sae}</span>}
            {filters.stock !== "all" && <span className="eco-pill is-active">{stockOptions.find((option) => option.value === filters.stock)?.label}</span>}
            {activeFiltersCount > 0 && (
              <button type="button" className="eco-pill is-dashed" onClick={resetFilters}>
                × Сбросить всё
              </button>
            )}
          </div>
          <span className="l-meta">{rows.length}{meta?.hasMore ? "+" : ""} из {meta?.total ?? rows.length} артикулов</span>
        </div>

        {(error || info) && (
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
                <th style={{ width: 36 }}><span className="eco-check" /></th>
                <th>{sortHeader("Артикул", "article")}</th>
                <th>{sortHeader("Название", "name")}</th>
                <th>Спец.</th>
                <th>Ячейка</th>
                <th style={{ textAlign: "right" }}>{sortHeader("Остаток", "quantity", "right")}</th>
                <th style={{ textAlign: "right" }}>{sortHeader("Доступно", "available", "right")}</th>
                <th style={{ textAlign: "right" }}>Резерв</th>
                <th style={{ textAlign: "right" }}>{sortHeader("Закуп.", "buyPrice", "right")}</th>
                <th style={{ textAlign: "right" }}>{sortHeader("Цена", "salePrice", "right")}</th>
                <th style={{ textAlign: "right" }}>{sortHeader("Маржа", "margin", "right")}</th>
                <th style={{ width: 84 }} />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-zinc-500">Загрузка...</td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-zinc-500">Товары не найдены.</td>
                </tr>
              )}
              {!loading && rows.map((row) => (
                <tr key={row.id}>
                  <td><span className="eco-check" /></td>
                  <td className="eco-product-article">
                    {[row.article, row.code].filter(Boolean).join("-") || "без артикула"}
                  </td>
                  <td className="eco-product-name-cell">
                    <div className="eco-product-title">{row.name}</div>
                    <div className="eco-product-meta">
                      {usefulProductMetaLines(row).map((line) => (
                        <span key={line}>· {line}</span>
                      ))}
                    </div>
                  </td>
                  <td className="eco-product-spec">
                    <strong>{row.sae || "—"}</strong>
                    <span>
                      {[row.apiSpec, row.acea].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </td>
                  <td className="eco-product-cell">{row.cell || "—"}</td>
                  <td className="eco-product-number">
                    <span className="eco-stock-badge">{formatQty(row.totalQuantity)}</span>
                  </td>
                  <td className="eco-product-number">
                    {formatQty(row.totalAvailable)}
                  </td>
                  <td className="eco-product-number is-muted">
                    {formatQty(reserveValue(row))}
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
                      onClick={() => {
                        setEditingId(row.id);
                        setForm(formFromProduct(row));
                        setNewGroupMode(false);
                        setUploadingPhotos(false);
                        setDeletingPhotoId(null);
                        setInfo(null);
                        setError(null);
                        setFormOpen(true);
                      }}
                      className="eco-icon-action"
                      aria-label="Править"
                    >
                      <Pencil aria-hidden className="eco-icon" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void archive(row)}
                      className="eco-icon-action"
                      aria-label="Архив"
                    >
                      <MoreHorizontal aria-hidden className="eco-icon" />
                    </button>
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
