import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  normalizeProductMarkingMode,
  normalizeProductMarkingSettings,
  productHasMarkingProblem,
  type ProductMarkingMode,
  type ProductMarkingSettings,
} from "@/lib/product-marking";

type MoySkladMeta = {
  href: string;
  type: string;
  mediaType: string;
};

type ProductAttribute = { id?: string; name?: string; value?: unknown; meta?: { href?: string } };

export type CatalogSearchContext = "products" | "shipment";
export type CatalogSearchType = "product" | "service" | "all";

export type CatalogSearchParams = {
  q?: string;
  context?: CatalogSearchContext;
  warehouseId?: string;
  storeId?: string;
  storeName?: string;
  type?: CatalogSearchType;
  entityType?: string;
  categoryId?: string;
  group?: string | string[];
  brandId?: string;
  brand?: string | string[];
  sae?: string | string[];
  supplier?: string | string[];
  apiSpec?: string | string[];
  acea?: string | string[];
  packageVolume?: string | string[];
  stock?: string;
  markingProblems?: boolean;
  inStock?: boolean;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
  cursor?: string;
  sort?: string;
  direction?: string;
  oem?: string;
  mannName?: string;
  params?: string;
  strictNameOem?: boolean;
};

type CatalogProduct = Prisma.LocalProductGetPayload<{
  include: {
    stockBalances: {
      include: { store: true };
    };
    photos: {
      select: {
        id: true;
        fileName: true;
        contentType: true;
        sizeBytes: true;
        createdAt: true;
      };
    };
  };
}>;

type StockRow = {
  storeId: string;
  storeName: string;
  quantity: number;
  reserve: number;
  available: number;
  slotName: string;
  buyPriceCents?: number | null;
};

type SearchField = {
  key: string;
  label: string;
  value: string;
  weight: number;
  exact?: boolean;
  identifier?: boolean;
};

type TokenKind = "word" | "brand" | "viscosity" | "volume" | "article" | "oem" | "ean" | "numeric" | "spec" | "category";

export type CatalogSearchToken = {
  raw: string;
  normalized: string;
  compact: string;
  kind: TokenKind;
  variants: string[];
};

export type CatalogMatchedField = {
  field: string;
  label: string;
  value: string;
  token?: string;
  match: "exact" | "compact" | "prefix" | "contains" | "synonym" | "fuzzy";
};

export type CatalogSearchItem = {
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
  price: number;
  currentPrice: number;
  currency: string;
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
  archived: boolean;
  updatedAt: string;
  stock: StockRow[];
  totalQuantity: number;
  totalAvailable: number;
  totalReserve: number;
  markingEnabled: boolean;
  markingMode: ProductMarkingMode;
  markingStatus: string;
  markingSettings: ProductMarkingSettings | null;
  markingConfiguredManually: boolean;
  markingConfiguredAt: string | null;
  markingConfiguredByLogin: string | null;
  stockQuantity: number;
  reserveQuantity: number;
  availableQuantity: number;
  slotName?: string;
  cost?: number;
  buyPriceCents?: number | null;
  meta: MoySkladMeta;
  relevance: number;
  matchedFields: CatalogMatchedField[];
  highlights: Record<string, string[]>;
  matchSummary: string;
  photos?: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
    url: string;
  }>;
};

type FacetOption = { value: string; count: number };
type StockFilter = "all" | "inStock" | "outOfStock";
type SortKey = "relevance" | "name" | "article" | "code" | "available" | "quantity" | "buyPrice" | "salePrice" | "margin" | "updatedAt";
type SortDirection = "asc" | "desc";

export type CatalogSearchResult = {
  items: CatalogSearchItem[];
  products: CatalogSearchItem[];
  total: number;
  normalizedQuery: string;
  tokens: CatalogSearchToken[];
  matchedOutsideFilters: number;
  suggestions: string[];
  meta: {
    total: number;
    hasMore: boolean;
    limit: number;
    offset: number;
    sort: SortKey;
    direction: SortDirection;
    filters: {
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
    filterOptions: {
      brands: string[];
      sae: string[];
      suppliers: string[];
      groups: string[];
      entityTypes: string[];
      apiSpecs: string[];
      acea: string[];
      packageVolumes: string[];
    };
    facets: {
      brands: FacetOption[];
      sae: FacetOption[];
      suppliers: FacetOption[];
      groups: FacetOption[];
      entityTypes: FacetOption[];
      apiSpecs: FacetOption[];
      acea: FacetOption[];
      packageVolumes: FacetOption[];
      stock: Record<StockFilter, number>;
    };
  };
};

const DASH_RE = /[\u2010-\u2015\u2212]+/g;
const SEPARATOR_RE = /[\s.,;:()[\]{}"'`«»/\\|+*_=-]+/g;
const ruCollator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
const sortKeys = new Set<SortKey>(["relevance", "name", "article", "code", "available", "quantity", "buyPrice", "salePrice", "margin", "updatedAt"]);

const synonymGroups = [
  ["масляный", "масло", "масляного", "фильтр масла", "масляный фильтр"],
  ["салонник", "салонный", "фильтр салона", "салонный фильтр"],
  ["воздушник", "воздушный", "воздушный фильтр"],
  ["акпп", "atf"],
  ["трансмиссионка", "трансмиссионное", "трансмиссионное масло"],
  ["охлаждайка", "антифриз", "охлаждающая жидкость"],
  ["тормозуха", "тормозная жидкость"],
  ["масло двигателя", "моторное масло", "моторный"],
  ["литр", "liter", "litre", "l", "л"],
];

const synonymsByToken = new Map<string, string[]>();
for (const group of synonymGroups) {
  const normalized = group.flatMap((item) => tokenize(item).map((token) => token.normalized));
  for (const token of normalized) {
    synonymsByToken.set(token, [...new Set([...(synonymsByToken.get(token) ?? []), ...normalized.filter((item) => item !== token)])]);
  }
}

function normalizeSearchText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .normalize("NFKC")
    .replace(DASH_RE, "-")
    .replace(/[ёЁ]/g, "е")
    .replace(/([05])\s*[wWшШвВ]\s*-?\s*(\d{2})/g, "$1w$2")
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:л|l|liter|litre|литр(?:а|ов)?)/gi, "$1л")
    .toLocaleLowerCase("ru-RU")
    .replace(/[wш]/g, "w")
    .replace(/(?<=\d)в(?=\d{2})/g, "w")
    .replace(SEPARATOR_RE, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSearchText(value: unknown): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function compactIdentifier(value: unknown): string {
  return normalizeSearchText(value).replace(/[^a-zа-я0-9]+/giu, "");
}

export function buildCatalogSearchText(input: {
  name?: string | null;
  article?: string | null;
  code?: string | null;
  externalCode?: string | null;
  groupPath?: string | null;
  barcodeEan13?: string | null;
  barcodeEan8?: string | null;
  barcodeCode128?: string | null;
  description?: string | null;
  supplierName?: string | null;
  tnvedCode?: string | null;
  sae?: string | null;
  oem?: string | null;
  acea?: string | null;
  apiSpec?: string | null;
  packageVolume?: string | null;
  brand?: string | null;
  atf?: string | null;
  ilsac?: string | null;
  aceaExtra?: string | null;
  oemAtf?: string | null;
  mannName?: string | null;
  rosskoPartNumber?: string | null;
  rosskoBrand?: string | null;
  rosskoMin?: string | null;
  supplierAttribute?: string | null;
  oemParts?: string | null;
  cell?: string | null;
  mannCharacteristicName?: string | null;
  entityType?: string | null;
  currencyName?: string | null;
  uomName?: string | null;
  attributes?: unknown;
}): string {
  return normalizeSearchText([
    input.name,
    input.brand,
    input.groupPath,
    input.entityType,
    input.article,
    input.code,
    input.externalCode,
    input.barcodeEan13,
    input.barcodeEan8,
    input.barcodeCode128,
    input.oem,
    input.oemParts,
    input.oemAtf,
    input.rosskoPartNumber,
    input.rosskoBrand,
    input.sae,
    input.apiSpec,
    input.acea,
    input.aceaExtra,
    input.ilsac,
    input.atf,
    input.packageVolume,
    input.uomName,
    input.description,
    input.supplierName,
    input.tnvedCode,
    input.mannName,
    input.rosskoMin,
    input.supplierAttribute,
    input.cell,
    input.mannCharacteristicName,
    input.currencyName,
    attributeSearchText(input.attributes),
  ].filter(Boolean).join(" "));
}

function attributeValueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(attributeValueText).join(" ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.name ?? record.value ?? "").trim();
  }
  return String(value ?? "").trim();
}

function attributeSearchText(input: unknown): string {
  if (!Array.isArray(input)) return "";
  return input
    .map((attr) => {
      const item = attr as ProductAttribute;
      return [item.name, attributeValueText(item.value)].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" ");
}

function tokenKind(raw: string, normalized: string, compact: string): TokenKind {
  if (/^\d{8,14}$/.test(compact)) return "ean";
  if (/^[05]w\d{0,2}$/.test(compact) || /^[05]w$/.test(compact)) return "viscosity";
  if (/^\d+(?:[.,]\d+)?л$/.test(compact)) return "volume";
  if (/^(api|acea|ilsac|atf|sn|sp|sl|sm|c[1-5]|a[1-5]|b[1-5])$/i.test(compact)) return "spec";
  if (/^\d+$/.test(compact)) return compact.length >= 6 ? "oem" : "numeric";
  if (/[a-zа-я]/iu.test(compact) && /\d/.test(compact)) return "article";
  if (/фильтр|масло|жидкость|антифриз|салон|воздуш|трансмисс/i.test(normalized)) return "category";
  if (raw.length >= 2 && /^[a-zа-я]+$/iu.test(compact)) return "word";
  return "word";
}

function tokenize(value: string): CatalogSearchToken[] {
  const normalizedInput = normalizeSearchText(value);
  const parts = normalizedInput.split(" ").filter(Boolean);
  const tokens: CatalogSearchToken[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const normalized = normalizeSearchText(raw);
    const compact = compactSearchText(raw);
    if (!compact) continue;
    if (compact.length < 2 && !/\d/.test(compact)) continue;
    const extra = synonymsByToken.get(normalized) ?? [];
    const variants = [...new Set([normalized, compact, stemToken(normalized), ...extra].filter((item) => item.length >= 2))];
    const key = `${compact}:${variants.join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({ raw, normalized, compact, kind: tokenKind(raw, normalized, compact), variants });
  }

  const compactInput = compactSearchText(value);
  const visc = compactInput.match(/[05]w\d{0,2}/g) ?? [];
  for (const item of visc) {
    if (seen.has(`${item}:${item}`)) continue;
    seen.add(`${item}:${item}`);
    tokens.push({ raw: item, normalized: item, compact: item, kind: "viscosity", variants: [item] });
  }
  return tokens.slice(0, 10);
}

function stemToken(token: string): string {
  if (token.length < 5 || !/^\p{L}+$/u.test(token)) return token;
  return token.replace(/(иями|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ов|ев|ах|ях|ам|ям|ом|ем|а|я|ы|и|у|ю|о|е|ь)$/iu, "");
}

function levenshteinAtMost(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowBest = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowBest = Math.min(rowBest, curr[j]);
    }
    if (rowBest > max) return max + 1;
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function allowedFuzzyDistance(token: CatalogSearchToken): number {
  if (["article", "oem", "ean", "numeric"].includes(token.kind)) return 0;
  if (token.compact.length < 4) return 0;
  if (token.compact.length <= 6) return 1;
  return 2;
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function decimalToNullableNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === "number" ? value : value.toNumber();
}

function entityMeta(entityType: string, moyskladId: string | null, href: string | null, localId: string): MoySkladMeta {
  const type = entityType || "product";
  return { href: href || `local://${type}/${localId || moyskladId || ""}`, type, mediaType: "application/json" };
}

function getCellFromAttributes(input: unknown): string | undefined {
  if (!Array.isArray(input)) return undefined;
  const found = (input as ProductAttribute[]).find((attr) => {
    const name = String(attr.name ?? "").trim().toLowerCase();
    return name === "ячейка" || name.includes("ячейка");
  });
  return attributeValueText(found?.value) || undefined;
}

function fieldsForProduct(product: CatalogProduct): SearchField[] {
  return [
    { key: "barcodeEan13", label: "EAN", value: product.barcodeEan13 ?? "", weight: 100, exact: true, identifier: true },
    { key: "barcodeEan8", label: "EAN", value: product.barcodeEan8 ?? "", weight: 100, exact: true, identifier: true },
    { key: "barcodeCode128", label: "Штрихкод", value: product.barcodeCode128 ?? "", weight: 96, exact: true, identifier: true },
    { key: "code", label: "Код", value: product.code ?? "", weight: 95, exact: true, identifier: true },
    { key: "article", label: "Артикул", value: product.article ?? "", weight: 90, exact: true, identifier: true },
    { key: "externalCode", label: "Внешний код", value: product.externalCode ?? "", weight: 88, exact: true, identifier: true },
    { key: "oem", label: "OEM", value: product.oem ?? "", weight: 90, exact: true, identifier: true },
    { key: "oemParts", label: "Кросс-номера", value: product.oemParts ?? "", weight: 86, exact: true, identifier: true },
    { key: "rosskoPartNumber", label: "Код поставщика", value: product.rosskoPartNumber ?? "", weight: 84, exact: true, identifier: true },
    { key: "name", label: "Название", value: product.name, weight: 80 },
    { key: "brand", label: "Бренд", value: product.brand ?? "", weight: 35 },
    { key: "rosskoBrand", label: "Бренд поставщика", value: product.rosskoBrand ?? "", weight: 30 },
    { key: "sae", label: "SAE", value: product.sae ?? "", weight: 35 },
    { key: "packageVolume", label: "Фасовка", value: product.packageVolume ?? "", weight: 28 },
    { key: "apiSpec", label: "API", value: product.apiSpec ?? "", weight: 24 },
    { key: "acea", label: "ACEA", value: product.acea ?? "", weight: 24 },
    { key: "ilsac", label: "ILSAC", value: product.ilsac ?? "", weight: 24 },
    { key: "atf", label: "ATF", value: product.atf ?? "", weight: 24 },
    { key: "groupPath", label: "Категория", value: product.groupPath ?? "", weight: 20 },
    { key: "supplierName", label: "Поставщик", value: product.supplierName ?? "", weight: 12 },
    { key: "description", label: "Описание", value: product.description ?? "", weight: 8 },
    { key: "searchText", label: "Характеристики", value: product.searchText || buildCatalogSearchText(product), weight: 8 },
  ];
}

function matchTokenInField(token: CatalogSearchToken, field: SearchField): CatalogMatchedField | null {
  const value = field.value.trim();
  if (!value) return null;
  const normalized = normalizeSearchText(value);
  const compact = compactIdentifier(value);
  const words = normalized.split(" ").filter(Boolean);

  if (field.exact && token.compact.length >= 3 && compact === token.compact) {
    return { field: field.key, label: field.label, value, token: token.raw, match: "exact" };
  }
  if (field.identifier && token.compact.length >= 3 && compact.includes(token.compact)) {
    return { field: field.key, label: field.label, value, token: token.raw, match: "compact" };
  }
  for (const variant of token.variants) {
    const variantCompact = compactIdentifier(variant);
    if (!variantCompact) continue;
    if (words.some((word) => word === variant)) return { field: field.key, label: field.label, value, token: token.raw, match: "exact" };
    if (variantCompact.length >= 2 && words.some((word) => word.startsWith(variantCompact))) {
      return { field: field.key, label: field.label, value, token: token.raw, match: "prefix" };
    }
    if (variantCompact.length >= 3 && compact.includes(variantCompact)) {
      return { field: field.key, label: field.label, value, token: token.raw, match: synonymsByToken.has(token.normalized) && variant !== token.normalized ? "synonym" : "contains" };
    }
  }

  const fuzzyDistance = allowedFuzzyDistance(token);
  if (fuzzyDistance > 0) {
    for (const word of words) {
      if (word.length < 4 || Math.abs(word.length - token.normalized.length) > fuzzyDistance) continue;
      if (levenshteinAtMost(token.normalized, word, fuzzyDistance) <= fuzzyDistance) {
        return { field: field.key, label: field.label, value, token: token.raw, match: "fuzzy" };
      }
    }
  }
  return null;
}

function matchScore(field: SearchField, match: CatalogMatchedField): number {
  const multipliers = { exact: 1, compact: 0.95, prefix: 0.55, contains: 0.45, synonym: 0.32, fuzzy: 0.2 };
  return field.weight * multipliers[match.match];
}

function scoreProduct(product: CatalogProduct, tokens: CatalogSearchToken[], normalizedQuery: string) {
  const fields = fieldsForProduct(product);
  const matched: CatalogMatchedField[] = [];
  let score = 0;

  if (!tokens.length) {
    return { ok: true, score: 0, matchedFields: matched };
  }

  const normalizedName = normalizeSearchText(product.name);
  if (normalizedName === normalizedQuery) {
    matched.push({ field: "name", label: "Название", value: product.name, match: "exact" });
    score += 80;
  }

  const compactQuery = compactIdentifier(normalizedQuery);
  if (compactQuery.length >= 4 || (compactQuery.length >= 3 && /\d/.test(compactQuery))) {
    for (const field of fields.filter((item) => item.key === "name" || item.key === "oemParts")) {
      if (compactIdentifier(field.value).includes(compactQuery)) {
        matched.push({ field: field.key, label: field.label, value: field.value, token: normalizedQuery, match: "compact" });
        score += field.weight;
      }
    }
  }

  let matchedTokens = 0;
  for (const token of tokens) {
    let best: { field: SearchField; match: CatalogMatchedField; score: number } | null = null;
    for (const field of fields) {
      const match = matchTokenInField(token, field);
      if (!match) continue;
      const currentScore = matchScore(field, match);
      if (!best || currentScore > best.score) best = { field, match, score: currentScore };
    }
    if (!best) continue;
    matchedTokens += 1;
    matched.push(best.match);
    score += best.score;
  }

  const allSignificant = matchedTokens === tokens.length;
  const partialAllowed = tokens.length >= 3 && matchedTokens >= tokens.length - 1;
  if (!allSignificant && !partialAllowed) return { ok: false, score: 0, matchedFields: matched };
  if (!allSignificant) score -= 25;
  return { ok: true, score, matchedFields: dedupeMatchedFields(matched) };
}

function dedupeMatchedFields(fields: CatalogMatchedField[]) {
  const seen = new Set<string>();
  const result: CatalogMatchedField[] = [];
  for (const field of fields) {
    const key = `${field.field}:${field.token ?? ""}:${field.match}:${field.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(field);
  }
  return result;
}

function searchCandidateWhere(tokens: CatalogSearchToken[], params: CatalogSearchParams): Prisma.LocalProductWhereInput {
  const OR: Prisma.LocalProductWhereInput[] = [];
  const rawTerms = [params.q, params.oem, params.mannName, params.params].map((item) => item?.trim()).filter((item): item is string => Boolean(item));
  for (const raw of rawTerms) {
    if (raw.length >= 2) {
      OR.push({ searchText: { contains: normalizeSearchText(raw), mode: "insensitive" } });
      OR.push({ name: { contains: raw, mode: "insensitive" } });
    }
  }
  for (const token of tokens) {
    const candidates = [...new Set([token.normalized, token.compact, ...token.variants].filter((item) => item.length >= 2 || /\d/.test(item)))].slice(0, 5);
    for (const candidate of candidates) {
      OR.push({ searchText: { contains: candidate, mode: "insensitive" } });
      if (candidate.length >= 2) {
        OR.push({ name: { contains: candidate, mode: "insensitive" } });
        OR.push({ brand: { contains: candidate, mode: "insensitive" } });
        OR.push({ sae: { contains: candidate, mode: "insensitive" } });
        OR.push({ article: { contains: candidate, mode: "insensitive" } });
        OR.push({ code: { contains: candidate, mode: "insensitive" } });
      }
      if (token.kind === "ean" || token.kind === "oem" || token.kind === "article" || token.kind === "numeric") {
        OR.push({ barcodeEan13: { contains: candidate, mode: "insensitive" } });
        OR.push({ barcodeEan8: { contains: candidate, mode: "insensitive" } });
        OR.push({ barcodeCode128: { contains: candidate, mode: "insensitive" } });
        OR.push({ oem: { contains: candidate, mode: "insensitive" } });
        OR.push({ oemParts: { contains: candidate, mode: "insensitive" } });
        OR.push({ rosskoPartNumber: { contains: candidate, mode: "insensitive" } });
      }
    }
  }
  return OR.length ? { OR } : {};
}

function normalizedCatalogLookupTerms(tokens: CatalogSearchToken[], params: CatalogSearchParams): string[] {
  const terms = new Set<string>();
  for (const raw of [params.q, params.oem, params.mannName, params.params]) {
    const compact = compactIdentifier(raw);
    if (compact.length >= 4 || (compact.length >= 3 && /\d/.test(compact))) terms.add(compact);
  }
  for (const token of tokens) {
    for (const value of [token.compact, ...token.variants.map(compactIdentifier)]) {
      if (value.length >= 4 || (value.length >= 3 && /\d/.test(value))) terms.add(value);
    }
  }
  return [...terms].slice(0, 12);
}

async function findNormalizedCatalogCandidateIds(tokens: CatalogSearchToken[], params: CatalogSearchParams): Promise<string[]> {
  const terms = normalizedCatalogLookupTerms(tokens, params);
  if (terms.length === 0) return [];
  const predicates = terms.map((term) => Prisma.sql`
    regexp_replace(replace(lower(COALESCE(name, '')), 'ё', 'е'), '[^0-9a-zа-я]', '', 'g') LIKE ${`%${term}%`}
    OR regexp_replace(replace(lower(COALESCE(oem_parts, '')), 'ё', 'е'), '[^0-9a-zа-я]', '', 'g') LIKE ${`%${term}%`}
  `);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM local_products
    WHERE ${Prisma.join(predicates, " OR ")}
    LIMIT 1000
  `);
  return rows.map((row) => row.id);
}

function strictNameOemTerm(value: unknown): string {
  const compact = compactIdentifier(value);
  if (compact.length < 3) return "";
  return compact;
}

async function findStrictNameOemCandidateIds(value: unknown): Promise<string[]> {
  const term = strictNameOemTerm(value);
  if (!term) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM local_products
    WHERE (
      regexp_replace(replace(lower(COALESCE(name, '')), 'ё', 'е'), '[^0-9a-zа-я]', '', 'g') LIKE ${`%${term}%`}
      OR regexp_replace(replace(lower(COALESCE(oem_parts, '')), 'ё', 'е'), '[^0-9a-zа-я]', '', 'g') LIKE ${`%${term}%`}
    )
    LIMIT 1000
  `);
  return rows.map((row) => row.id);
}

function strictNameOemMatchedFields(product: CatalogProduct, value: unknown): CatalogMatchedField[] {
  const term = strictNameOemTerm(value);
  if (!term) return [];
  const matched: CatalogMatchedField[] = [];
  if (compactIdentifier(product.name).includes(term)) {
    matched.push({ field: "name", label: "Название", value: product.name, token: String(value ?? ""), match: "compact" });
  }
  if (compactIdentifier(product.oemParts).includes(term)) {
    matched.push({ field: "oemParts", label: "OEM PARTS", value: product.oemParts ?? "", token: String(value ?? ""), match: "compact" });
  }
  return matched;
}

function mergeSearchCandidateWhere(
  base: Prisma.LocalProductWhereInput,
  normalizedCandidateIds: string[]
): Prisma.LocalProductWhereInput {
  if (normalizedCandidateIds.length === 0) return base;
  const normalizedWhere: Prisma.LocalProductWhereInput = { id: { in: normalizedCandidateIds } };
  const baseOr = Array.isArray(base.OR) ? base.OR : [];
  return { ...base, OR: [...baseOr, normalizedWhere] };
}

function cleanFilterValues(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set<string>();
  for (const item of values) {
    for (const part of String(item).split(",")) {
      const clean = part.trim();
      if (clean) seen.add(clean);
    }
  }
  return [...seen];
}

function normalizeStockFilter(value?: string): StockFilter {
  return value === "inStock" || value === "outOfStock" ? value : "all";
}

function normalizeType(value?: string): CatalogSearchType {
  if (value === "product" || value === "service" || value === "all") return value;
  return "all";
}

function filterValuesInclude(values: string[], candidate: string | null | undefined) {
  if (!values.length) return true;
  const clean = candidate?.trim() ?? "";
  const normalized = normalizeSearchText(clean);
  return clean ? values.some((value) => value === clean || normalizeSearchText(value) === normalized) : false;
}

function productFacetValue(item: CatalogSearchItem, key: "brand" | "sae" | "supplier" | "group" | "entityType" | "apiSpec" | "acea" | "packageVolume") {
  if (key === "brand") return item.brand;
  if (key === "sae") return item.sae;
  if (key === "supplier") return item.supplierName;
  if (key === "group") return item.groupPath;
  if (key === "entityType") return item.entityType;
  if (key === "apiSpec") return item.apiSpec;
  if (key === "acea") return item.acea;
  return item.packageVolume;
}

function rowMatchesFilters(item: CatalogSearchItem, filters: CatalogSearchResult["meta"]["filters"]) {
  if (!filterValuesInclude(filters.brand, item.brand)) return false;
  if (!filterValuesInclude(filters.sae, item.sae)) return false;
  if (!filterValuesInclude(filters.supplier, item.supplierName)) return false;
  if (!filterValuesInclude(filters.group, item.groupPath)) return false;
  if (!filterValuesInclude(filters.entityType, item.entityType)) return false;
  if (!filterValuesInclude(filters.apiSpec, item.apiSpec)) return false;
  if (!filterValuesInclude(filters.acea, item.acea)) return false;
  if (!filterValuesInclude(filters.packageVolume, item.packageVolume)) return false;
  if (filters.stock === "inStock" && item.totalAvailable <= 0) return false;
  if (filters.stock === "outOfStock" && item.totalAvailable > 0) return false;
  if (filters.markingProblems && !productHasMarkingProblem({
    markingEnabled: item.markingEnabled,
    markingMode: item.markingMode,
    markingStatus: item.markingStatus,
    groupPath: item.groupPath,
    uomName: item.uomName,
    settings: item.markingSettings,
  })) {
    return false;
  }
  return true;
}

function facetOptions(items: CatalogSearchItem[], key: Parameters<typeof productFacetValue>[1]): FacetOption[] {
  const counts = new Map<string, { value: string; count: number }>();
  for (const item of items) {
    const value = productFacetValue(item, key).trim();
    if (!value) continue;
    const normalized = normalizeSearchText(value);
    const current = counts.get(normalized);
    counts.set(normalized, { value: current?.value ?? value, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || ruCollator.compare(a.value, b.value));
}

function buildFacets(items: CatalogSearchItem[], filters: CatalogSearchResult["meta"]["filters"]) {
  const facetKeys = ["brand", "sae", "supplier", "group", "entityType", "apiSpec", "acea", "packageVolume"] as const;
  const rowsForStock = items.filter((item) =>
    facetKeys.every((key) => key === "entityType" ? filterValuesInclude(filters.entityType, item.entityType) : true)
    && (!filters.markingProblems || productHasMarkingProblem({
      markingEnabled: item.markingEnabled,
      markingMode: item.markingMode,
      markingStatus: item.markingStatus,
      groupPath: item.groupPath,
      uomName: item.uomName,
      settings: item.markingSettings,
    }))
  );
  return {
    brands: facetOptions(items, "brand"),
    sae: facetOptions(items, "sae"),
    suppliers: facetOptions(items, "supplier"),
    groups: facetOptions(items, "group"),
    entityTypes: facetOptions(items, "entityType"),
    apiSpecs: facetOptions(items, "apiSpec"),
    acea: facetOptions(items, "acea"),
    packageVolumes: facetOptions(items, "packageVolume"),
    stock: {
      all: rowsForStock.length,
      inStock: rowsForStock.filter((item) => item.totalAvailable > 0).length,
      outOfStock: rowsForStock.filter((item) => item.totalAvailable <= 0).length,
    },
  };
}

function normalizeSort(value?: string): SortKey {
  return value && sortKeys.has(value as SortKey) ? (value as SortKey) : "relevance";
}

function normalizeDirection(value?: string): SortDirection {
  return value === "desc" ? "desc" : "asc";
}

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined, direction: SortDirection) {
  const aMissing = a == null;
  const bMissing = b == null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const result = a - b;
  return direction === "asc" ? result : -result;
}

function productMargin(item: CatalogSearchItem): number | null {
  return item.buyPrice == null ? null : item.salePrice - item.buyPrice;
}

function compareItems(a: CatalogSearchItem, b: CatalogSearchItem, sort: SortKey, direction: SortDirection, context: CatalogSearchContext) {
  if (sort === "relevance") {
    const relevanceDiff = b.relevance - a.relevance;
    if (relevanceDiff !== 0) return relevanceDiff;
    if (context === "shipment") {
      const stockDiff = Number(b.totalAvailable > 0) - Number(a.totalAvailable > 0);
      if (stockDiff !== 0) return stockDiff;
      const priceDiff = Number(b.salePrice > 0) - Number(a.salePrice > 0);
      if (priceDiff !== 0) return priceDiff;
    }
  }
  let result = 0;
  if (sort === "name") result = ruCollator.compare(a.name, b.name);
  if (sort === "article") result = ruCollator.compare(a.article || a.code || a.name, b.article || b.code || b.name);
  if (sort === "code") result = ruCollator.compare(a.code || a.article || a.name, b.code || b.article || b.name);
  if (sort === "available") result = compareNullableNumber(a.totalAvailable, b.totalAvailable, direction);
  if (sort === "quantity") result = compareNullableNumber(a.totalQuantity, b.totalQuantity, direction);
  if (sort === "buyPrice") result = compareNullableNumber(a.buyPrice, b.buyPrice, direction);
  if (sort === "salePrice") result = compareNullableNumber(a.salePrice, b.salePrice, direction);
  if (sort === "margin") result = compareNullableNumber(productMargin(a), productMargin(b), direction);
  if (sort === "updatedAt") result = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  if (sort === "relevance") result = 0;
  if (direction === "desc" && !["available", "quantity", "buyPrice", "salePrice", "margin"].includes(sort)) result = -result;
  return result || ruCollator.compare(a.name, b.name);
}

function mapProduct(product: CatalogProduct, relevance: number, matchedFields: CatalogMatchedField[]): CatalogSearchItem {
  const stock = product.stockBalances.map((balance) => ({
    storeId: balance.storeId,
    storeName: balance.store?.name ?? "",
    quantity: decimalToNumber(balance.quantity),
    reserve: decimalToNumber(balance.reserve),
    available: decimalToNumber(balance.available),
    slotName: balance.slotName ?? "",
    buyPriceCents: balance.buyPriceCents,
  }));
  const firstStock = stock[0];
  const highlights: Record<string, string[]> = {};
  for (const match of matchedFields) {
    highlights[match.field] ??= [];
    if (match.token) highlights[match.field].push(match.token);
  }
  const matchSummary = matchedFields.length
    ? `Совпадение: ${matchedFields.slice(0, 3).map((field) => field.label).join(" + ")}`
    : "";
  return {
    id: product.id,
    moyskladId: product.moyskladId ?? undefined,
    name: product.name,
    article: product.article ?? "",
    code: product.code ?? "",
    externalCode: product.externalCode ?? "",
    groupPath: product.groupPath ?? "",
    uomName: product.uomName ?? "",
    entityType: product.entityType,
    salePrice: product.salePriceCents / 100,
    buyPrice: product.buyPriceCents == null ? null : product.buyPriceCents / 100,
    price: product.salePriceCents / 100,
    currentPrice: product.salePriceCents / 100,
    currency: product.currencyName ?? "руб.",
    currencyName: product.currencyName ?? "руб.",
    minimumBalance: decimalToNullableNumber(product.minimumBalance),
    barcodeEan13: product.barcodeEan13 ?? "",
    barcodeEan8: product.barcodeEan8 ?? "",
    barcodeCode128: product.barcodeCode128 ?? "",
    description: product.description ?? "",
    minPrice: product.minPriceCents == null ? null : product.minPriceCents / 100,
    minPriceCurrencyName: product.minPriceCurrencyName ?? "",
    countryName: product.countryName ?? "",
    vatLabel: product.vatLabel ?? "",
    supplierName: product.supplierName ?? "",
    weight: decimalToNullableNumber(product.weight),
    volume: decimalToNullableNumber(product.volume),
    modificationCode: product.modificationCode ?? "",
    tnvedCode: product.tnvedCode ?? "",
    sae: product.sae ?? "",
    oem: product.oem ?? "",
    acea: product.acea ?? "",
    apiSpec: product.apiSpec ?? "",
    packageVolume: product.packageVolume ?? "",
    avito: product.avito,
    brand: product.brand ?? "",
    atf: product.atf ?? "",
    ilsac: product.ilsac ?? "",
    aceaExtra: product.aceaExtra ?? "",
    oemAtf: product.oemAtf ?? "",
    mannName: product.mannName ?? "",
    rosskoPartNumber: product.rosskoPartNumber ?? "",
    rosskoBrand: product.rosskoBrand ?? "",
    rosskoMin: product.rosskoMin ?? "",
    supplierAttribute: product.supplierAttribute ?? "",
    oemParts: product.oemParts ?? "",
    cell: firstStock?.slotName || product.cell || getCellFromAttributes(product.attributes) || "",
    mannCharacteristicName: product.mannCharacteristicName ?? "",
    imageHref: product.imageHref ?? "",
    archived: product.archived,
    updatedAt: product.updatedAt.toISOString(),
    stock,
    totalQuantity: stock.reduce((sum, row) => sum + row.quantity, 0),
    totalAvailable: stock.reduce((sum, row) => sum + row.available, 0),
    totalReserve: stock.reduce((sum, row) => sum + row.reserve, 0),
    markingEnabled: product.markingEnabled,
    markingMode: normalizeProductMarkingMode(product.markingMode),
    markingStatus: product.markingStatus,
    markingSettings: product.markingMode === "BULK_OIL_FROM_MARKED_BARREL"
      ? normalizeProductMarkingSettings(product.markingSettings)
      : null,
    markingConfiguredManually: product.markingConfiguredManually,
    markingConfiguredAt: product.markingConfiguredAt?.toISOString() ?? null,
    markingConfiguredByLogin: product.markingConfiguredByLogin ?? null,
    stockQuantity: firstStock?.quantity ?? 0,
    reserveQuantity: firstStock?.reserve ?? 0,
    availableQuantity: firstStock?.available ?? 0,
    slotName: firstStock?.slotName || undefined,
    buyPriceCents: firstStock?.buyPriceCents ?? product.buyPriceCents,
    cost: (firstStock?.buyPriceCents ?? product.buyPriceCents) != null ? (firstStock?.buyPriceCents ?? product.buyPriceCents ?? 0) / 100 : undefined,
    meta: entityMeta(product.entityType, product.moyskladId, product.moyskladHref, product.id),
    relevance,
    matchedFields,
    highlights,
    matchSummary,
    photos: product.photos.map((photo) => ({
      id: photo.id,
      fileName: photo.fileName ?? "",
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
      createdAt: photo.createdAt.toISOString(),
      url: `/api/local-inventory/products/${product.id}/photos/${photo.id}`,
    })),
  };
}

async function resolveStoreId(params: CatalogSearchParams): Promise<string | null> {
  const storeId = params.warehouseId?.trim() || params.storeId?.trim() || "";
  if (storeId) {
    const store = await prisma.localStore.findFirst({ where: { OR: [{ id: storeId }, { moyskladId: storeId }] }, select: { id: true } });
    return store?.id ?? null;
  }
  const storeName = params.storeName?.trim() ?? "";
  if (!storeName) return null;
  const store = await prisma.localStore.findFirst({ where: { name: { equals: storeName, mode: "insensitive" } }, select: { id: true } });
  return store?.id ?? null;
}

export async function searchCatalog(params: CatalogSearchParams): Promise<CatalogSearchResult> {
  const context = params.context === "shipment" ? "shipment" : "products";
  const q = [params.q, params.oem, params.mannName, params.params].filter(Boolean).join(" ");
  const normalizedQuery = normalizeSearchText(q);
  const tokens = tokenize(q);
  const limit = Math.min(100, Math.max(1, params.limit ?? (context === "shipment" ? 50 : 30)));
  const offset = Math.max(0, params.offset ?? (Number(params.cursor ?? 0) || 0));
  const type = normalizeType(params.type ?? params.entityType);
  const sort = normalizeSort(params.sort);
  const direction = normalizeDirection(params.direction);
  const filters: CatalogSearchResult["meta"]["filters"] = {
    brand: cleanFilterValues(params.brand),
    sae: cleanFilterValues(params.sae),
    supplier: cleanFilterValues(params.supplier),
    group: cleanFilterValues(params.group ?? params.categoryId),
    entityType: type === "all" ? cleanFilterValues(params.entityType) : [type],
    apiSpec: cleanFilterValues(params.apiSpec),
    acea: cleanFilterValues(params.acea),
    packageVolume: cleanFilterValues(params.packageVolume),
    stock: params.inStock ? "inStock" : normalizeStockFilter(params.stock),
    markingProblems: params.markingProblems === true,
  };
  const storeId = await resolveStoreId(params);
  const strictNameOem = params.strictNameOem === true && Boolean(params.q?.trim());
  if (strictNameOem) {
    const strictCandidateIds = await findStrictNameOemCandidateIds(params.q);
    const products = strictCandidateIds.length > 0
      ? await prisma.localProduct.findMany({
          where: {
            ...(params.includeArchived ? {} : { archived: false }),
            ...(type !== "all" ? { entityType: type } : {}),
            id: { in: strictCandidateIds },
          },
          include: {
            stockBalances: {
              where: storeId ? { storeId } : undefined,
              include: { store: true },
              orderBy: { store: { name: "asc" } },
              take: storeId ? 1 : 20,
            },
            photos: {
              select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: [{ name: "asc" }],
          take: Math.min(1000, Math.max(limit * 30, 100)),
        })
      : [];
    const scored = products.flatMap((product) => {
      const matchedFields = strictNameOemMatchedFields(product, params.q);
      if (matchedFields.length === 0) return [];
      const score = matchedFields.reduce((sum, field) => sum + (field.field === "oemParts" ? 100 : 90), 0);
      return [mapProduct(product, score, matchedFields)];
    });
    const facets = buildFacets(scored, filters);
    const filtered = scored.filter((item) => rowMatchesFilters(item, filters));
    const sorted = filtered.sort((a, b) => compareItems(a, b, sort, direction, context));
    const items = sorted.slice(offset, offset + limit);
    return {
      items,
      products: items,
      total: filtered.length,
      normalizedQuery,
      tokens,
      matchedOutsideFilters: Math.max(0, scored.length - filtered.length),
      suggestions: !items.length && normalizedQuery ? [`Нет совпадений в названии или OEM PARTS: ${normalizedQuery}`] : [],
      meta: {
        total: filtered.length,
        hasMore: offset + limit < filtered.length,
        limit,
        offset,
        sort,
        direction,
        filters,
        filterOptions: {
          brands: facets.brands.map((item) => item.value),
          sae: facets.sae.map((item) => item.value),
          suppliers: facets.suppliers.map((item) => item.value),
          groups: facets.groups.map((item) => item.value),
          entityTypes: facets.entityTypes.map((item) => item.value),
          apiSpecs: facets.apiSpecs.map((item) => item.value),
          acea: facets.acea.map((item) => item.value),
          packageVolumes: facets.packageVolumes.map((item) => item.value),
        },
        facets,
      },
    };
  }
  const normalizedCandidateIds = await findNormalizedCatalogCandidateIds(tokens, params);
  const where: Prisma.LocalProductWhereInput = {
    ...(params.includeArchived ? {} : { archived: false }),
    ...(type !== "all" ? { entityType: type } : {}),
    ...mergeSearchCandidateWhere(searchCandidateWhere(tokens, params), normalizedCandidateIds),
  };
  const take = tokens.length ? Math.min(2000, Math.max(limit * 30, 300)) : Math.min(500, Math.max(limit + offset, 100));
  const products = await prisma.localProduct.findMany({
    where,
    include: {
      stockBalances: {
        where: storeId ? { storeId } : undefined,
        include: { store: true },
        orderBy: { store: { name: "asc" } },
        take: storeId ? 1 : 20,
      },
      photos: {
        select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ name: "asc" }],
    take,
  });

  const scored = products.flatMap((product) => {
    const score = scoreProduct(product, tokens, normalizedQuery);
    if (!score.ok) return [];
    return [mapProduct(product, score.score, score.matchedFields)];
  });
  const facets = buildFacets(scored, filters);
  const filtered = scored.filter((item) => rowMatchesFilters(item, filters));
  const matchedOutsideFilters = Math.max(0, scored.length - filtered.length);
  const sorted = filtered.sort((a, b) => compareItems(a, b, sort, direction, context));
  const items = sorted.slice(offset, offset + limit);
  const suggestions = !items.length && normalizedQuery ? [`Проверьте артикул, OEM или бренд: ${normalizedQuery}`] : [];
  return {
    items,
    products: items,
    total: filtered.length,
    normalizedQuery,
    tokens,
    matchedOutsideFilters,
    suggestions,
    meta: {
      total: filtered.length,
      hasMore: offset + limit < filtered.length,
      limit,
      offset,
      sort,
      direction,
      filters,
      filterOptions: {
        brands: facets.brands.map((item) => item.value),
        sae: facets.sae.map((item) => item.value),
        suppliers: facets.suppliers.map((item) => item.value),
        groups: facets.groups.map((item) => item.value),
        entityTypes: facets.entityTypes.map((item) => item.value),
        apiSpecs: facets.apiSpecs.map((item) => item.value),
        acea: facets.acea.map((item) => item.value),
        packageVolumes: facets.packageVolumes.map((item) => item.value),
      },
      facets,
    },
  };
}
