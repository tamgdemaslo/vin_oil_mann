import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createOpenAIClient } from "@/lib/openai-client";

type JsonRecord = Record<string, unknown>;

export type TechnicalVehicle = {
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | string | null;
  engine?: string | null;
  engineCode?: string | null;
  transmission?: string | null;
  drive?: string | null;
  modification?: string | null;
};

export type TechnicalSource = {
  name: string;
  url: string;
  excerpt?: string | null;
  confidence?: number | null;
  rating?: "official" | "manufacturer" | "catalog" | "reputable_technical" | "community" | "unknown";
  catalogVersion?: string | null;
  validUntil?: string | null;
};

export type TechnicalSearchResult = {
  facts: JsonRecord;
  sources: TechnicalSource[];
  conflicts?: Array<{ field: string; values: unknown[] }>;
};

function clean(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function cleanVehiclePart(value: unknown) {
  return clean(value).toUpperCase().replace(/\s+/g, " ");
}

export function technicalVehicleKey(vehicle: TechnicalVehicle) {
  const vin = cleanVehiclePart(vehicle.vin).replace(/[^A-Z0-9]/g, "");
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return `vin:${vin}`;
  const key = [vehicle.make, vehicle.model, vehicle.year, vehicle.engineCode || vehicle.engine, vehicle.transmission, vehicle.drive, vehicle.modification]
    .map(cleanVehiclePart)
    .filter(Boolean)
    .join("|");
  return `parameters:${createHash("sha256").update(key || "unknown").digest("hex").slice(0, 32)}`;
}

function allowDomain(url: string, trustedDomains: string[]) {
  // An empty list means that the quality classifier below evaluates the
  // returned sources. It must not silently turn real web search into a dead
  // end just because a tenant has not curated a whitelist yet.
  if (!trustedDomains.length) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return trustedDomains.some((domain) => {
      const normalized = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      return normalized && (host === normalized || host.endsWith(`.${normalized}`));
    });
  } catch {
    return false;
  }
}

function sourceRating(url: string): NonNullable<TechnicalSource["rating"]> {
  const host = (() => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  })();
  if (/(^|\.)(toyota|lexus|volkswagen|vw|bmw|mercedes-benz|ford|mazda|honda|hyundai|kia|nissan|mitsubishi|subaru|audi|gm|stellantis)\./.test(host)) return "official";
  if (/(mann-filter|castrol|mobil|shell|liqui-moly|eurol|bardahl|lukoil|valvoline|ravenol)\./.test(host)) return "manufacturer";
  if (/(tecdoc|rossko|autodoc|exist|partsouq|toyodiy|catcar|ilcats)\./.test(host)) return "catalog";
  if (/(drive2|forum|reddit|vk\.com|drom)\./.test(host)) return "community";
  return host ? "reputable_technical" : "unknown";
}

function sourceConfidence(rating: NonNullable<TechnicalSource["rating"]>) {
  return rating === "official" ? 0.95 : rating === "manufacturer" ? 0.9 : rating === "catalog" ? 0.78 : rating === "reputable_technical" ? 0.68 : rating === "community" ? 0.45 : 0.35;
}

function dateOrNull(value: unknown) {
  const raw = clean(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clampConfidence(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.5;
}

function normalizedConflicts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => record(item))
    .map((item) => ({ field: clean(item.field), values: Array.isArray(item.values) ? item.values.slice(0, 8) : [] }))
    .filter((item) => item.field && item.values.length > 1);
}

export async function getFreshTechnicalEvidence(input: {
  organizationId: string;
  vehicle: TechnicalVehicle;
  aggregate: string;
  factTypes: string[];
}) {
  const vehicleKey = technicalVehicleKey(input.vehicle);
  const now = new Date();
  const rows = await prisma.aIAgentTechnicalEvidence.findMany({
    where: {
      organizationId: input.organizationId,
      vehicleKey,
      aggregate: input.aggregate,
      factType: { in: input.factTypes },
      status: "verified",
      invalidatedAt: null,
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    orderBy: { verifiedAt: "desc" },
  });
  const selected = new Map<string, typeof rows[number]>();
  for (const row of rows) if (!selected.has(row.factType)) selected.set(row.factType, row);
  const facts: JsonRecord = {};
  const sources: TechnicalSource[] = [];
  for (const row of selected.values()) {
    Object.assign(facts, record(row.facts));
    sources.push({
      name: row.sourceName,
      url: row.sourceUrl,
      excerpt: row.sourceExcerpt,
      confidence: row.confidence,
      catalogVersion: row.catalogVersion,
      validUntil: row.validUntil?.toISOString() ?? null,
    });
  }
  return { vehicleKey, facts, sources, missingFactTypes: input.factTypes.filter((factType) => !selected.has(factType)) };
}

/**
 * The provider is intentionally an internal, audited integration. The agent
 * never gets open web access; it receives only cited facts from allow-listed
 * sources. This keeps a search result reproducible in the quote snapshot.
 */
export async function queryTechnicalProvider(input: {
  vehicle: TechnicalVehicle;
  aggregate: string;
  factTypes: string[];
  trustedDomains: string[];
}): Promise<TechnicalSearchResult | null> {
  const endpoint = process.env.TECHNICAL_SEARCH_ENDPOINT?.trim();
  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(process.env.TECHNICAL_SEARCH_TOKEN?.trim() ? { Authorization: `Bearer ${process.env.TECHNICAL_SEARCH_TOKEN.trim()}` } : {}) },
        body: JSON.stringify({ vehicle: input.vehicle, aggregate: input.aggregate, factTypes: input.factTypes, trustedDomains: input.trustedDomains }),
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      if (response.ok) {
        const payload = record(await response.json().catch(() => null));
        const sources = (Array.isArray(payload.sources) ? payload.sources : [])
          .map((item) => record(item))
          .map((item) => {
            const url = clean(item.url);
            const rating = sourceRating(url);
            return {
              name: clean(item.name) || "Технический источник",
              url,
              excerpt: clean(item.excerpt) || null,
              confidence: clampConfidence(item.confidence || sourceConfidence(rating)),
              rating,
              catalogVersion: clean(item.catalogVersion) || null,
              validUntil: clean(item.validUntil) || null,
            };
          })
          .filter((item) => item.url && allowDomain(item.url, input.trustedDomains));
        if (sources.length) return { facts: record(payload.facts), sources, conflicts: normalizedConflicts(payload.conflicts) };
      }
    } catch {
      // The hosted OpenAI web-search fallback below remains available.
    }
  }
  return queryOpenAIWebSearch(input);
}

export function technicalWebSearchAvailability() {
  return {
    responsesApi: Boolean(process.env.OPENAI_API_KEY?.trim()),
    internalProvider: Boolean(process.env.TECHNICAL_SEARCH_ENDPOINT?.trim()),
  };
}

function parseJsonObject(value: string): JsonRecord {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
  try { return record(JSON.parse(fenced)); } catch {
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return record(JSON.parse(fenced.slice(start, end + 1))); } catch { /* The response had no usable structured payload. */ }
    }
    return {};
  }
}

function citedSources(value: unknown): TechnicalSource[] {
  const found: TechnicalSource[] = [];
  const visited = new Set<unknown>();
  function visit(item: unknown) {
    if (!item || typeof item !== "object" || visited.has(item)) return;
    visited.add(item);
    const row = item as Record<string, unknown>;
    const url = clean(row.url);
    if (url.startsWith("http")) {
      const rating = sourceRating(url);
      found.push({
        name: clean(row.title) || clean(row.name) || "Интернет-источник",
        url,
        excerpt: clean(row.text) || clean(row.excerpt) || null,
        confidence: sourceConfidence(rating),
        rating,
      });
    }
    for (const nested of Object.values(row)) visit(nested);
  }
  visit(value);
  return found.filter((source, index, all) => all.findIndex((item) => item.url === source.url) === index).slice(0, 12);
}

async function queryOpenAIWebSearch(input: {
  vehicle: TechnicalVehicle;
  aggregate: string;
  factTypes: string[];
  trustedDomains: string[];
}): Promise<TechnicalSearchResult | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const vehicle = JSON.stringify(input.vehicle);
  const question = [
    "Ты технический исследователь автосервиса. Выполни реальный web search, не отвечай по памяти.",
    `Автомобиль: ${vehicle}. Агрегат: ${input.aggregate}. Нужны факты: ${input.factTypes.join(", ")}.`,
    "Найди применимые технические данные. Предпочти официальные руководства, сервисные документы и каталоги производителей; каталоги допустимы как дополнительный источник.",
    "Верни только JSON с полями facts (object) и conflicts (array). В facts включай только подтверждённые значения. В тексте ответа используй URL-цитаты источников, чтобы они были доступны в ответе API.",
  ].join("\n");
  const client = createOpenAIClient(apiKey);
  const response = await client.responses.create({
    model: process.env.OPENAI_TECHNICAL_RESEARCH_MODEL?.trim() || "gpt-5.6",
    input: question,
    tools: [{ type: "web_search" }],
    tool_choice: "required",
    parallel_tool_calls: false,
  } as never);
  const raw = JSON.parse(JSON.stringify(response)) as Record<string, unknown>;
  const sources = citedSources(raw)
    .filter((source) => allowDomain(source.url, input.trustedDomains));
  const payload = parseJsonObject(String((response as { output_text?: string }).output_text ?? ""));
  if (!sources.length || !Object.keys(record(payload.facts)).length) return null;
  return { facts: record(payload.facts), sources, conflicts: normalizedConflicts(payload.conflicts) };
}

export async function saveTechnicalEvidence(input: {
  organizationId: string;
  vehicle: TechnicalVehicle;
  aggregate: string;
  factTypes: string[];
  result: TechnicalSearchResult;
}) {
  const vehicleKey = technicalVehicleKey(input.vehicle);
  const evidence: Prisma.AIAgentTechnicalEvidenceCreateManyInput[] = input.factTypes.flatMap((factType) =>
    input.result.sources.map((source) => ({
      organizationId: input.organizationId,
      vehicleKey,
      vehicleSnapshot: JSON.parse(JSON.stringify(input.vehicle)) as Prisma.InputJsonValue,
      aggregate: input.aggregate,
      factType,
      facts: JSON.parse(JSON.stringify(input.result.facts)) as Prisma.InputJsonValue,
      sourceName: source.name,
      sourceUrl: source.url,
      sourceExcerpt: source.excerpt || null,
      confidence: clampConfidence(source.confidence),
      status: input.result.conflicts?.length ? "conflicting" : "verified",
      catalogVersion: source.catalogVersion || null,
      validUntil: dateOrNull(source.validUntil),
    }))
  );
  if (evidence.length) await prisma.aIAgentTechnicalEvidence.createMany({ data: evidence });
  return { vehicleKey, saved: evidence.length };
}

export async function invalidateTechnicalEvidenceForCatalog(input: { organizationId: string; catalogVersion?: string | null }) {
  return prisma.aIAgentTechnicalEvidence.updateMany({
    where: { organizationId: input.organizationId, status: "verified", ...(input.catalogVersion ? { catalogVersion: input.catalogVersion } : {}) },
    data: { status: "stale", invalidatedAt: new Date() },
  });
}
