/**
 * Словари канонических значений SAE, ACEA, API, OEM из XML (data/values-xml*.xml).
 * Используются для нормализации допусков при подборе масел.
 */

import { readFileSync } from "fs";
import { join } from "path";

function extractTagValues(xml: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}>([^<]*)</${tagName}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = m[1].trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function loadXml(filename: string): string {
  try {
    const path = join(process.cwd(), "data", filename);
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

let _sae: string[] | null = null;
let _acea: string[] | null = null;
let _api: string[] | null = null;
let _oem: string[] | null = null;

/** Канонические значения SAE (вязкость): 0W-20, 5W-30, … */
export function getCanonicalSAE(): string[] {
  if (_sae) return _sae;
  const xml = loadXml("values-xml-4.xml");
  _sae = xml ? extractTagValues(xml, "SAE") : [];
  return _sae;
}

/** Канонические значения ACEA: A3/B4, C3, … */
export function getCanonicalACEA(): string[] {
  if (_acea) return _acea;
  const xml = loadXml("values-xml.xml");
  _acea = xml ? extractTagValues(xml, "ACEA") : [];
  return _acea;
}

/** Канонические значения API: SN, SP, CF, … */
export function getCanonicalAPI(): string[] {
  if (_api) return _api;
  const xml = loadXml("values-xml-2.xml");
  _api = xml ? extractTagValues(xml, "API") : [];
  return _api;
}

/** Канонические значения OEM (допуски производителей): VW 504.00, MB 229.5, … */
export function getCanonicalOEM(): string[] {
  if (_oem) return _oem;
  const xml = loadXml("values-xml-3.xml");
  _oem = xml ? extractTagValues(xml, "OEMOil") : [];
  return _oem;
}

/** Нормализовать строку для сравнения: нижний регистр, убрать пробелы и точки (чтобы VW 504.00 и VW 504 00 совпадали). */
export function normalizeForMatch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\./g, "");
}

/** Найти в списке канонических значение точное или первое совпадение по нормализованной строке. */
export function findCanonical(canonicalList: string[], input: string): string | null {
  if (!input || !canonicalList.length) return null;
  const n = normalizeForMatch(input);
  const exact = canonicalList.find((c) => normalizeForMatch(c) === n);
  if (exact) return exact;
  const contains = canonicalList.find((c) => normalizeForMatch(c).includes(n) || n.includes(normalizeForMatch(c)));
  return contains ?? null;
}

/** Найти все канонические значения, чья нормализованная форма входит в нормализованную строку part (для длинных строк без разделителей). */
export function findAllCanonicalSubstrings(canonicalList: string[], part: string): string[] {
  if (!part || !canonicalList.length) return [];
  const n = normalizeForMatch(part);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of canonicalList) {
    const cn = normalizeForMatch(c);
    if (cn.length >= 4 && n.includes(cn) && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/** Найти все вхождения из строки input (разделённой запятыми/точкой с запятой или одной строкой) в canonicalList. */
export function findAllCanonical(canonicalList: string[], input: string): string[] {
  const parts = input.split(/[,;\/|]+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const byExact = findCanonical(canonicalList, p);
    if (byExact && !seen.has(byExact)) {
      seen.add(byExact);
      out.push(byExact);
    }
    const bySubstrings = findAllCanonicalSubstrings(canonicalList, p);
    for (const c of bySubstrings) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}
