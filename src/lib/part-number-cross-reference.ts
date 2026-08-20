export type NormalizedPartNumber = {
  rawNormalized: string;
  canonical: string;
  compactCandidate: string;
};

export type ParsedOemPart = NormalizedPartNumber & {
  raw: string;
  brand: string | null;
  articleRaw: string;
};

export type PartNumberCollision = {
  compactKey: string;
  canonicalArticles: string[];
};

const HARD_SEPARATOR_RE = /[,;|\r\n\t]+/g;
const TYPOGRAPHIC_DASH_RE = /[‐‑‒–—―−]/g;
const UNICODE_SLASH_RE = /[\\／⁄∕]/g;
const MANN_BRAND_RE = /^MANN(?:\s*-?\s*FILTER)?$/;

function normalizedDisplay(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(TYPOGRAPHIC_DASH_RE, "-")
    .replace(UNICODE_SLASH_RE, "/")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("ru-RU");
}

/**
 * Multi-level part-number normalization.
 *
 * `canonical` keeps `/`, because it can distinguish real SKU such as
 * C27161 and C2716/1. `compactCandidate` is retrieval-only unless a caller
 * proves that the key is collision-free in its authoritative namespace.
 */
export function normalizePartNumberForCrossMatch(value: unknown): NormalizedPartNumber {
  const rawNormalized = normalizedDisplay(value);
  const canonical = rawNormalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.\s-]+/g, "")
    .replace(/[^\p{L}\p{N}/]/gu, "")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return {
    rawNormalized,
    canonical,
    compactCandidate: canonical.replace(/\//g, ""),
  };
}

export function normalizeCrossReferenceBrand(value: unknown): string | null {
  const display = normalizedDisplay(value);
  if (!display) return null;
  const compact = display.replace(/[^\p{L}\p{N}]+/gu, "");
  if (MANN_BRAND_RE.test(display) || compact === "MANNFILTER") return "MANN";
  return display;
}

function mannPrefixedArticle(segment: string): { brand: "MANN"; articleRaw: string } | null {
  const match = segment.match(/^(MANN(?:\s*-?\s*FILTER)?)(?:\s*:\s*|\s+)(.+)$/i);
  if (!match) return null;
  const brand = normalizeCrossReferenceBrand(match[1]);
  const articleRaw = match[2]?.trim() ?? "";
  return brand === "MANN" && /\d/.test(articleRaw) ? { brand, articleRaw } : null;
}

function looksLikeSpacedArticle(words: string[]): boolean {
  if (words.length < 2 || !/^[\p{L}]{1,4}$/u.test(words[0] ?? "")) return false;
  if (!words.slice(1).some((word) => /\d/.test(word))) return false;
  return words.slice(1).every((word) => /^[\p{L}\d./-]+$/u.test(word));
}

function genericBrandAndArticle(segment: string): { brand: string; articleRaw: string } | null {
  const words = segment.split(/\s+/).filter(Boolean);
  if (words.length < 2 || looksLikeSpacedArticle(words)) return null;

  const first = words[0] ?? "";
  const remaining = words.slice(1);
  if (
    words.length >= 3
    && /^[\p{L}&.-]{5,}$/u.test(first)
    && remaining.some((word) => /\d/.test(word))
    && remaining.every((word) => /^[\p{L}\d./-]+$/u.test(word))
  ) {
    const brand = normalizeCrossReferenceBrand(first);
    return brand ? { brand, articleRaw: remaining.join(" ") } : null;
  }

  const last = words.at(-1) ?? "";
  if (/\p{L}/u.test(last) && /\d/.test(last)) {
    const brandRaw = words.slice(0, -1).join(" ");
    const brand = normalizeCrossReferenceBrand(brandRaw);
    return brand && brand !== "MANN" ? { brand, articleRaw: last } : null;
  }

  const articleRaw = words.slice(1).join(" ");
  if (/^[\p{L}&/.-]{2,}$/u.test(first) && /\d/.test(articleRaw)) {
    const brand = normalizeCrossReferenceBrand(first);
    return brand ? { brand, articleRaw } : null;
  }
  return null;
}

function shouldSplitArticleList(segment: string): boolean {
  const words = segment.split(/\s+/).filter(Boolean);
  return words.length > 1
    && words.every((word) => /\d/.test(word) && normalizePartNumberForCrossMatch(word).canonical.length >= 3);
}

function parsedEntry(raw: string, brand: string | null, articleRaw: string): ParsedOemPart | null {
  const normalized = normalizePartNumberForCrossMatch(articleRaw);
  if (normalized.canonical.length < 2) return null;
  return { raw, brand, articleRaw, ...normalized };
}

/** Canonical parser for LocalProduct.oemParts TEXT and supplier cross values. */
export function parseOemParts(value: unknown): ParsedOemPart[] {
  const result: ParsedOemPart[] = [];
  const seen = new Set<string>();
  const add = (entry: ParsedOemPart | null) => {
    if (!entry) return;
    const key = `${entry.brand ?? ""}\u0000${entry.canonical}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(entry);
  };

  for (const rawSegment of String(value ?? "").split(HARD_SEPARATOR_RE)) {
    const segment = normalizedDisplay(rawSegment);
    if (!segment) continue;

    const mann = mannPrefixedArticle(segment);
    if (mann) {
      add(parsedEntry(rawSegment.trim(), mann.brand, mann.articleRaw));
      continue;
    }

    if (shouldSplitArticleList(segment)) {
      for (const articleRaw of segment.split(/\s+/)) add(parsedEntry(articleRaw, null, articleRaw));
      continue;
    }

    const branded = genericBrandAndArticle(segment);
    if (branded) {
      add(parsedEntry(rawSegment.trim(), branded.brand, branded.articleRaw));
      continue;
    }

    add(parsedEntry(rawSegment.trim(), null, segment));
  }
  return result;
}

export function buildPartNumberCollisionIndex(values: Iterable<unknown>): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const value of values) {
    const normalized = normalizePartNumberForCrossMatch(value);
    if (!normalized.canonical || !normalized.compactCandidate) continue;
    const canonicals = index.get(normalized.compactCandidate) ?? new Set<string>();
    canonicals.add(normalized.canonical);
    index.set(normalized.compactCandidate, canonicals);
  }
  return index;
}

export function listPartNumberCollisions(index: Map<string, Set<string>>): PartNumberCollision[] {
  return [...index]
    .filter(([, canonicals]) => canonicals.size > 1)
    .map(([compactKey, canonicals]) => ({ compactKey, canonicalArticles: [...canonicals].sort() }))
    .sort((left, right) => left.compactKey.localeCompare(right.compactKey));
}

export function isSafeCompactKey(index: Map<string, Set<string>>, compactKey: string): boolean {
  const canonicals = index.get(compactKey);
  return Boolean(canonicals && canonicals.size === 1);
}
