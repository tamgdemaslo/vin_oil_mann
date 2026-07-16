import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rosskoCheckoutDetails, rosskoConfig, rosskoSearch, suggestRosskoDefaults } from "@/lib/rossko";

export const runtime = "nodejs";

type PreviewInput = {
  article?: string;
  code?: string;
  oem?: string;
  brand?: string;
  category?: string;
  productName?: string;
  supplierCode?: string;
  pomanName?: string;
};

type PreviewItem = {
  key: string;
  brand: string;
  partNumber: string;
  name: string;
  oem: string;
  confidence: number;
  source: string;
};

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pick(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const exact = text(row[key]);
    if (exact) return exact;
    const found = Object.entries(row).find(([rowKey]) => rowKey.toLowerCase() === key.toLowerCase());
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
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return result;
}

function normalizeItems(data: unknown, query: string): PreviewItem[] {
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, "");
  const seen = new Set<string>();
  return flattenRecords(data)
    .map((row) => {
      const brand = pick(row, ["brand", "brandName", "producer", "manufacturer"]);
      const partNumber = pick(row, ["partnumber", "partNumber", "number", "article", "code", "id"]);
      const name = pick(row, ["name", "partname", "partName", "description"]);
      const oem = pick(row, ["oem", "OEM", "cross", "crossNumber", "analog", "analogue"]);
      const key = `${brand}:${partNumber}:${oem}:${name}`.toLowerCase();
      if (!partNumber && !oem) return null;
      const compact = [partNumber, oem].join(" ").toLowerCase().replace(/\s+/g, "");
      const confidence = compact.includes(normalizedQuery) || normalizedQuery.includes(compact)
        ? 92
        : brand && name
          ? 72
          : 58;
      return { key, brand, partNumber, name, oem, confidence, source: "ROSSKO" };
    })
    .filter((item): item is PreviewItem => Boolean(item))
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .slice(0, 80);
}

function buildQuery(input: PreviewInput) {
  return [
    input.article,
    input.supplierCode,
    input.oem,
    input.code,
    input.pomanName,
    input.productName,
  ]
    .map((value) => value?.trim())
    .find((value) => value && value.length >= 2) ?? "";
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: PreviewInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const query = buildQuery(body);
  if (!query) return NextResponse.json({ error: "Заполните артикул, код или OEM Parts для поиска в ROSSKO" }, { status: 400 });

  try {
    const cfg = rosskoConfig();
    let deliveryId = cfg.deliveryId ?? "";
    let addressId = cfg.addressId ?? "";
    if (!deliveryId || !addressId) {
      try {
        const details = await rosskoCheckoutDetails(cfg);
        const suggested = suggestRosskoDefaults(details);
        deliveryId = deliveryId || suggested.delivery_id || "";
        addressId = addressId || suggested.address_id || "";
      } catch {
        // Validation below returns a user-readable setup error.
      }
    }
    if (!deliveryId) return NextResponse.json({ error: "ROSSKO_DELIVERY_ID не задан" }, { status: 400 });
    if (!addressId) return NextResponse.json({ error: "ROSSKO_ADDRESS_ID не задан" }, { status: 400 });

    const data = await rosskoSearch(cfg, { text: query, deliveryId, addressId });
    const items = normalizeItems(data, query);
    return NextResponse.json({ query, items, rawCount: items.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ROSSKO не ответил" }, { status: 502 });
  }
}
