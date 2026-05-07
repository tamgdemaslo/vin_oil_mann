import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { MOYSKLAD_BASE, moyskladFetch } from "@/lib/moysklad";

const OEM_ATTR_ID = "d1aad1ea-14e1-11f1-0a80-0eb200223523";
const OEM_ATTR_HREF = `${MOYSKLAD_BASE}/entity/product/metadata/attributes/${OEM_ATTR_ID}`;

/** id доп. поля «Наименование по Mann» */
const MANN_ATTR_ID = "ca6f792f-4451-11ee-0a80-0dba0047437a";
const MANN_ATTR_HREF = `${MOYSKLAD_BASE}/entity/product/metadata/attributes/${MANN_ATTR_ID}`;

/** id доп. поля «Параметры» */
const PARAMS_ATTR_ID = "7944ef04-f831-11e5-7a69-971500188b19";
const PARAMS_ATTR_HREF = `${MOYSKLAD_BASE}/entity/product/metadata/attributes/${PARAMS_ATTR_ID}`;

type ProductRow = {
  meta: { href: string; type: string; mediaType: string };
  id: string;
  name: string;
  article?: string;
  salePrices?: { value: number; currency?: { name?: string } }[];
  attributes?: { id: string; value: string | { name?: string }; name?: string }[];
};

type AttrMeta = {
  id: string;
  name?: string;
  type?: string;
  meta?: { href: string };
  customEntityMeta?: { meta?: { href: string } };
};

/** Типы сущностей, которые могут быть типом доп. поля «справочник» (type в метаданных). */
const REFERENCE_ENTITY_TYPES = ["product", "counterparty", "variant", "customentity", "bundle", "service"];

type AttrInfo = { href: string; type?: string; customEntityMetaHref?: string };

/** Метаданные доп. полей OEM, «Наименование по Mann», «Параметры» (тип, для справочника — ссылка на справочник). */
async function getProductAttributeInfo(): Promise<{ oem: AttrInfo; mann: AttrInfo; params: AttrInfo }> {
  const oem: AttrInfo = { href: OEM_ATTR_HREF };
  const mann: AttrInfo = { href: MANN_ATTR_HREF };
  const params: AttrInfo = { href: PARAMS_ATTR_HREF };

  const res = await moyskladFetch<{ rows?: AttrMeta[] }>("/entity/product/metadata/attributes");
  if (!res.ok || !res.data.rows) return { oem, mann, params };

  for (const a of res.data.rows) {
    const type = a.type;
    const customEntityMetaHref = a.customEntityMeta?.meta?.href;

    if (a.id === OEM_ATTR_ID) {
      oem.type = type;
      oem.customEntityMetaHref = customEntityMetaHref;
    }
    if (a.id === MANN_ATTR_ID) {
      mann.type = type;
      mann.customEntityMetaHref = customEntityMetaHref;
    }
    if (a.id === PARAMS_ATTR_ID) {
      params.type = type;
      params.customEntityMetaHref = customEntityMetaHref;
    }
  }
  return { oem, mann, params };
}

/**
 * Справочник = customentity: ищем элемент по имени/описанию через параметр search API.
 * Документация: поиск по элементам — по наименованию (name) и описанию (description).
 * customEntityMetaHref вида .../entity/customentity/{id}/metadata
 */
async function resolveCustomEntityReference(
  customEntityMetaHref: string,
  searchValue: string
): Promise<string | null> {
  const val = searchValue.trim();
  if (!val) return null;
  // id справочника из href метаданных: .../customentity/{id}/metadata или .../customentity/{id}
  const match = customEntityMetaHref.match(/\/entity\/customentity\/([a-f0-9-]+)/i);
  const customEntityId = match?.[1];
  if (!customEntityId) return null;

  const path = `/entity/customentity/${customEntityId}?search=${encodeURIComponent(val)}&limit=50`;
  const listRes = await moyskladFetch<{ rows?: { meta?: { href: string }; name?: string }[] }>(path, {
    cache: "no-store",
  });
  if (!listRes.ok || !listRes.data.rows?.length) return null;

  const first = listRes.data.rows[0];
  return first?.meta?.href ?? null;
}

/**
 * Справочник на сущность (product, counterparty, variant и т.д.): type в атрибуте = тип сущности.
 * Ищем по search в соответствующем entity, возвращаем meta.href первого совпадения.
 */
async function resolveEntityTypeReference(entityType: string, searchValue: string): Promise<string | null> {
  const type = entityType.toLowerCase();
  if (!REFERENCE_ENTITY_TYPES.includes(type)) return null;
  const path = `/entity/${type}?search=${encodeURIComponent(searchValue.trim())}&limit=5`;
  const res = await moyskladFetch<{ rows?: { meta?: { href: string } }[] }>(path, { cache: "no-store" });
  if (!res.ok || !res.data.rows?.length) return null;
  return res.data.rows[0]?.meta?.href ?? null;
}

/** Определяет, что доп. поле — справочник: type из таблицы (product/counterparty/…) или есть customEntityMeta. */
function isReferenceType(attr: AttrInfo): boolean {
  const t = (attr.type ?? "").toLowerCase();
  if (REFERENCE_ENTITY_TYPES.includes(t)) return true;
  if (attr.customEntityMetaHref) return true;
  return t.includes("custom") || t === "link";
}

const PER_TERM_LIMIT = 50;
const MAX_TERMS = 10;

/** Нормализует строку для дедупликации терминов (как в lookup). */
function normalizeTermKey(s: string): string {
  return s.replace(/\s/g, "").toLowerCase();
}

/** Добавляет товары из ответа в карту по id (объединение как в lookup). */
function addRowsToMap(map: Map<string, ProductRow>, rows: ProductRow[] | undefined) {
  for (const r of rows ?? []) {
    if (r.id && !map.has(r.id)) map.set(r.id, r);
  }
}

/** Текст для поиска по товару: название, артикул, значения доп. полей (как в lookup). */
function productSearchText(row: ProductRow): string {
  const parts = [row.name ?? "", row.article ?? ""];
  for (const a of row.attributes ?? []) {
    const v = a.value;
    parts.push(typeof v === "string" ? v : (v?.name ?? ""));
  }
  return parts.join(" ").toLowerCase();
}

/** Подходит ли товар под хотя бы один из терминов (поиск по названию, артикулу, доп. полям). */
function productMatchesTerms(row: ProductRow, terms: string[]): boolean {
  const text = productSearchText(row);
  for (const term of terms) {
    const needle = term.trim().toLowerCase().replace(/\s/g, "");
    if (needle.length < 2) continue;
    if (text.replace(/\s/g, "").includes(needle)) return true;
  }
  return false;
}

/**
 * Поиск товаров для «Добавить из справочника».
 * Как в lookup: для каждого термина — запрос по filter (OEM / Mann / Параметры) и по search, затем объединение по id.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  const search = request.nextUrl.searchParams.get("search") ?? "";
  const oem = request.nextUrl.searchParams.get("oem") ?? "";
  const mannName = request.nextUrl.searchParams.get("mannName") ?? "";
  const paramsValue = request.nextUrl.searchParams.get("params") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10));

  const rawTerms = [search.trim(), oem.trim(), mannName.trim(), paramsValue.trim()].filter(Boolean);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of rawTerms) {
    const key = normalizeTermKey(t);
    if (key && !seen.has(key)) {
      seen.add(key);
      terms.push(t);
    }
  }
  const termsSlice = terms.slice(0, MAX_TERMS);

  const productMap = new Map<string, ProductRow>();

  let apiError: string | undefined;
  if (termsSlice.length === 0) {
    const emptyRes = await moyskladFetch<{ rows?: ProductRow[] }>(
      `/entity/product?limit=${limit}&offset=${offset}`,
      { cache: "no-store" }
    );
    if (emptyRes.ok && emptyRes.data?.rows) {
      addRowsToMap(productMap, emptyRes.data.rows);
    } else if (!emptyRes.ok) {
      apiError = emptyRes.error;
    }
  } else {
    const enc = encodeURIComponent;
    for (const term of termsSlice) {
      const val = term.replace(/\s/g, "").trim();
      if (!val) continue;
      // Формат как в lookup: filter=encodeURIComponent(href)~encodeURIComponent(value), без кодирования ~
      const filterOem = `${enc(OEM_ATTR_HREF)}~${enc(val)}`;
      const filterMann = `${enc(MANN_ATTR_HREF)}~${enc(val)}`;
      const filterParams = `${enc(PARAMS_ATTR_HREF)}~${enc(val)}`;

      const [byOem, byMann, byParams, bySearch] = await Promise.all([
        moyskladFetch<{ rows?: ProductRow[] }>(
          `/entity/product?filter=${filterOem}&limit=${PER_TERM_LIMIT}`,
          { cache: "no-store" }
        ),
        moyskladFetch<{ rows?: ProductRow[] }>(
          `/entity/product?filter=${filterMann}&limit=${PER_TERM_LIMIT}`,
          { cache: "no-store" }
        ),
        moyskladFetch<{ rows?: ProductRow[] }>(
          `/entity/product?filter=${filterParams}&limit=${PER_TERM_LIMIT}`,
          { cache: "no-store" }
        ),
        moyskladFetch<{ rows?: ProductRow[] }>(
          `/entity/product?search=${enc(val)}&limit=${PER_TERM_LIMIT}`,
          { cache: "no-store" }
        ),
      ]);

      if (byOem.ok) addRowsToMap(productMap, byOem.data?.rows);
      if (byMann.ok) addRowsToMap(productMap, byMann.data?.rows);
      if (byParams.ok) addRowsToMap(productMap, byParams.data?.rows);
      if (bySearch.ok) addRowsToMap(productMap, bySearch.data?.rows);
    }

    // Если по каждому термину ничего не нашли — один общий запрос по search (все термины через пробел)
    if (productMap.size === 0 && termsSlice.length > 0) {
      const searchQuery = termsSlice.join(" ");
      const fallback = await moyskladFetch<{ rows?: ProductRow[] }>(
        `/entity/product?search=${encodeURIComponent(searchQuery)}&limit=${limit}`,
        { cache: "no-store" }
      );
      if (fallback.ok && fallback.data?.rows) addRowsToMap(productMap, fallback.data.rows);
    }

    // Последний fallback: грузим партию товаров с доп. полями и фильтруем на своей стороне (search/filter по доп. полям в API часто не срабатывают)
    if (productMap.size === 0 && termsSlice.length > 0) {
      const batch = await moyskladFetch<{ rows?: ProductRow[] }>(
        `/entity/product?limit=500&expand=attributes`,
        { cache: "no-store" }
      );
      if (batch.ok && batch.data?.rows) {
        for (const row of batch.data.rows) {
          if (row.id && productMatchesTerms(row, termsSlice)) productMap.set(row.id, row);
        }
      }
    }
  }

  const allRows = Array.from(productMap.values());
  const total = allRows.length;
  const rows = allRows.slice(offset, offset + limit).map((r) => {
    const priceVal = r.salePrices?.[0]?.value ?? 0;
    const price = typeof priceVal === "number" && priceVal > 0 ? priceVal / 100 : 0;
    const currency = r.salePrices?.[0]?.currency?.name ?? "руб.";
    return {
      id: r.id,
      name: r.name,
      meta: r.meta,
      price,
      currency,
      stock: 0,
      reserve: 0,
      quantity: 0,
    };
  });

  return NextResponse.json({ rows, total, error: apiError });
}
