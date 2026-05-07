/**
 * Нормализатор допусков масла (SAE, OEM, ACEA, API) для матчинга с требованиями.
 * Спецификация 3.3.1: канонический вид по словарям из data/values-xml*.xml.
 */

import {
  getCanonicalSAE,
  getCanonicalACEA,
  getCanonicalAPI,
  getCanonicalOEM,
  findAllCanonical,
  findCanonical,
} from "./oil-dictionaries";

function normalizeAceLookalikes(value: string): string {
  return value
    .replace(/[Аа]/g, "A")
    .replace(/[Вв]/g, "B")
    .replace(/[Сс]/g, "C")
    .replace(/[Зз]/g, "3");
}

/**
 * Классы ACEA вроде C3, C2, A3/B4 короче 4 символов после нормализации — их не находит
 * findAllCanonicalSubstrings в словаре; в длинном названии товара без запятых тоже нет совпадения.
 */
function extractShortAceTokens(canonical: string[], value: string): string[] {
  const normalizedValue = normalizeAceLookalikes(value);
  const re = /\b([A-C]\d(?:\/[A-Z]\d)?)\b/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalizedValue)) !== null) {
    const token = m[1];
    const c = findCanonical(canonical, token);
    const v = c ?? token.toUpperCase();
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** SAE: приведение к каноническому виду из словаря (values-xml-4.xml); fallback — формат XW-YY */
export function normalizeSAE(value: string): string[] {
  if (!value || typeof value !== "string") return [];
  const canonical = getCanonicalSAE();
  const byDict = canonical.length ? findAllCanonical(canonical, value) : [];
  if (byDict.length) return byDict;
  const out: string[] = [];
  const parts = value.split(/[,;\/\s]+/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = p.replace(/\s/g, "").match(/^(\d+)w-?(\d+)$/i);
    if (m) out.push(`${m[1]}W-${m[2]}`);
    else if (p.length >= 2 && !/подлежит классификации/i.test(p)) out.push(p);
  }
  return [...new Set(out)];
}

/** Привести типичные варианты написания к форме из словаря (например BMW LL-04 → BMW Longlife-04). */
function normalizeOEMAliases(value: string): string {
  return value
    .replace(/\bBMW\s*LL-04\b/gi, "BMW Longlife-04")
    .replace(/\bGM\s*dexos2\b/gi, "GM Dexos 2")
    .replace(/\bVW\s+505\s+00\b/gi, "VW 505.00")
    .replace(/\bVW\s+505\s+01\b/gi, "VW 505.01");
}

/** OEM: канонические значения из словаря (values-xml-3.xml) */
export function normalizeOEM(value: string): string[] {
  if (!value || typeof value !== "string") return [];
  const normalized = normalizeOEMAliases(value);
  const canonical = getCanonicalOEM();
  if (canonical.length) return findAllCanonical(canonical, normalized);
  return normalized.split(/[,;\/|]+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** ACEA: канонические значения из словаря (values-xml.xml) */
export function normalizeACEA(value: string): string[] {
  if (!value || typeof value !== "string") return [];
  const normalized = normalizeAceLookalikes(value);
  const canonical = getCanonicalACEA();
  if (canonical.length) {
    const fromDict = findAllCanonical(canonical, normalized);
    if (fromDict.length) return fromDict;
    const fromShort = extractShortAceTokens(canonical, normalized);
    if (fromShort.length) return fromShort;
  }
  const parts = normalized.split(/[,;\/\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  return [...new Set(parts.filter((p) => p.length >= 2))];
}

/** API: канонические значения из словаря (values-xml-2.xml) */
export function normalizeAPI(value: string): string[] {
  if (!value || typeof value !== "string") return [];
  const canonical = getCanonicalAPI();
  if (canonical.length) return findAllCanonical(canonical, value);
  const parts = value.split(/[,;\/\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  return [...new Set(parts.filter((p) => p.length >= 2))];
}

/** ILSAC: нормализация GF-5/GF-6/... */
export function normalizeILSAC(value: string): string[] {
  if (!value || typeof value !== "string") return [];
  const parts = value.split(/[,;\/\s]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/GF-?(\d+)/i);
    if (m) out.push(`GF-${m[1]}`);
  }
  return [...new Set(out)];
}

import type { RequirementsNorm } from "@/types/oil";

/** Привести сырые поля товара к product.requirements_norm */
export function buildRequirementsNorm(raw: {
  sae?: string | null;
  oem?: string | null;
  acea?: string | null;
  api?: string | null;
  ilsac?: string | null;
}): RequirementsNorm {
  return {
    sae: normalizeSAE(raw.sae ?? ""),
    oem: normalizeOEM(raw.oem ?? ""),
    acea: normalizeACEA(raw.acea ?? ""),
    api: normalizeAPI(raw.api ?? ""),
    ilsac: normalizeILSAC(raw.ilsac ?? ""),
  };
}
