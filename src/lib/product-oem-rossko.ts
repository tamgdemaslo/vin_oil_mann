import type { User } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateLocalAdminProduct } from "@/lib/local-inventory-admin";
import { mergeProductCrossReferences, splitProductCrossReferences } from "@/lib/product-cross-references";
import { rosskoConfig, rosskoSearch } from "@/lib/rossko";

export type RosskoOemSearchInput = {
  article?: string;
  code?: string;
  oem?: string;
  brand?: string;
  category?: string;
  productName?: string;
  supplierCode?: string;
  pomanName?: string;
};

export type RosskoOemCandidate = {
  key: string;
  brand: string;
  partNumber: string;
  name: string;
  oem: string;
  confidence: number;
  source: "ROSSKO";
};

export type FillProductOemResult =
  | { status: "COMPLETED"; productId: string; foundCount: number; oemParts: string }
  | { status: "NO_RESULTS"; productId: string; foundCount: 0; oemParts: string }
  | { status: "SKIPPED_ALREADY_FILLED"; productId: string; foundCount: number; oemParts: string };

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pick(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const exact = text(row[key]);
    if (exact) return exact;
    const found = Object.entries(row).find(([rowKey]) => rowKey.toLocaleLowerCase("ru-RU") === key.toLocaleLowerCase("ru-RU"));
    const value = found ? text(found[1]) : "";
    if (value) return value;
  }
  return "";
}

function flattenRecords(root: unknown, limit = 220) {
  const result: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];
  while (queue.length && result.length < limit) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    const partNumber = pick(current, ["partnumber", "partNumber", "number", "article", "code", "id"]);
    const brand = pick(current, ["brand", "brandName", "producer", "manufacturer"]);
    const name = pick(current, ["name", "partname", "partName", "description"]);
    if (partNumber || (brand && name)) result.push(current);
    for (const value of Object.values(current)) if (value && typeof value === "object") queue.push(value);
  }
  return result;
}

function normalizeCandidates(data: unknown, query: string): RosskoOemCandidate[] {
  const normalizedQuery = query.toLocaleLowerCase("ru-RU").replace(/\s+/g, "");
  const seen = new Set<string>();
  return flattenRecords(data)
    .map((row) => {
      const brand = pick(row, ["brand", "brandName", "producer", "manufacturer"]);
      const partNumber = pick(row, ["partnumber", "partNumber", "number", "article", "code", "id"]);
      const name = pick(row, ["name", "partname", "partName", "description"]);
      const oem = pick(row, ["oem", "OEM", "cross", "crossNumber", "analog", "analogue"]);
      const key = `${brand}:${partNumber}:${oem}:${name}`.toLocaleLowerCase("ru-RU");
      if (!partNumber && !oem) return null;
      const compact = [partNumber, oem].join(" ").toLocaleLowerCase("ru-RU").replace(/\s+/g, "");
      const confidence = compact.includes(normalizedQuery) || normalizedQuery.includes(compact)
        ? 92
        : brand && name
          ? 72
          : 58;
      return { key, brand, partNumber, name, oem, confidence, source: "ROSSKO" as const };
    })
    .filter((item): item is RosskoOemCandidate => Boolean(item))
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .slice(0, 80);
}

export function buildRosskoOemQuery(input: RosskoOemSearchInput) {
  return [input.article, input.supplierCode, input.oem, input.code, input.pomanName, input.productName]
    .map((value) => value?.trim())
    .find((value) => value && value.length >= 2) ?? "";
}

export async function searchRosskoOemCandidates(input: RosskoOemSearchInput) {
  const query = buildRosskoOemQuery(input);
  if (!query) throw new Error("Заполните артикул, код или OEM Parts для поиска в ROSSKO");
  const cfg = await rosskoConfig();
  const deliveryId = cfg.deliveryId?.trim() || "";
  if (!deliveryId) throw new Error("Выберите способ доставки в настройках ROSSKO.");
  const data = await rosskoSearch(cfg, { text: query, deliveryId, addressId: cfg.addressId?.trim() || "" });
  return { query, items: normalizeCandidates(data, query) };
}

export async function fillProductOemFromRossko(input: {
  productId: string;
  branchId: string;
  actor?: User | null;
}): Promise<FillProductOemResult> {
  const product = await prisma.localProduct.findFirst({
    where: { id: input.productId, branchId: input.branchId, archived: false },
    select: {
      id: true,
      name: true,
      article: true,
      code: true,
      oem: true,
      oemParts: true,
      brand: true,
      groupPath: true,
      rosskoPartNumber: true,
      mannName: true,
    },
  });
  if (!product) throw new Error("Товар не найден в текущем филиале");

  const existing = splitProductCrossReferences(product.oemParts);
  if (existing.length) {
    return {
      status: "SKIPPED_ALREADY_FILLED",
      productId: product.id,
      foundCount: existing.length,
      oemParts: product.oemParts ?? "",
    };
  }

  const search = await searchRosskoOemCandidates({
    article: product.article ?? "",
    code: product.code ?? "",
    oem: product.oem ?? "",
    brand: product.brand ?? "",
    category: product.groupPath ?? "",
    productName: product.name,
    supplierCode: product.rosskoPartNumber ?? "",
    pomanName: product.mannName ?? "",
  });
  const merged = mergeProductCrossReferences(product.oemParts, search.items.flatMap((item) => [item.oem, item.partNumber]));
  const values = splitProductCrossReferences(merged);
  if (!values.length) {
    return { status: "NO_RESULTS", productId: product.id, foundCount: 0, oemParts: product.oemParts ?? "" };
  }

  const updated = await updateLocalAdminProduct(product.id, { oemParts: merged ?? undefined }, input.actor ?? null, input.branchId);
  if (!updated.ok) throw new Error(updated.error);
  return {
    status: "COMPLETED",
    productId: product.id,
    foundCount: values.length,
    oemParts: merged ?? "",
  };
}
