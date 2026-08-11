const HARD_SEPARATOR_RE = /[,;\r\n\t]+/g;

function cleanDisplayValue(value: unknown): string {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[–—−]/g, "-")
    .trim()
    .replace(/\s+/g, " ");

  if (!text) return "";
  const codeLike = /\d/.test(text) && /^[\p{L}\p{N}\s._/\-]+$/u.test(text);
  const compact = codeLike ? text.replace(/[\s-]+/g, "") : text;
  return compact.toUpperCase();
}

export function productCrossReferenceKey(value: unknown): string {
  return cleanDisplayValue(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function shouldSplitByWhitespace(segment: string): boolean {
  const words = segment.split(/\s+/).map((word) => word.trim()).filter(Boolean);
  if (words.length <= 1) return false;

  const looksLikeSpacedArticle =
    /^[\p{L}]$/u.test(words[0] ?? "") &&
    words.slice(1).every((word) => /^[\d./-]+$/u.test(word));
  if (looksLikeSpacedArticle) return false;

  return words.every((word) => productCrossReferenceKey(word).length >= 3);
}

export function splitProductCrossReferences(value: unknown): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const segment of String(value ?? "").split(HARD_SEPARATOR_RE)) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const candidates = shouldSplitByWhitespace(trimmed) ? trimmed.split(/\s+/) : [trimmed];

    for (const candidate of candidates) {
      const display = cleanDisplayValue(candidate);
      const key = productCrossReferenceKey(display);
      if (key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      result.push(display);
    }
  }

  return result;
}

export function productCrossReferenceCount(value: unknown): number {
  return splitProductCrossReferences(value).length;
}

export function hasProductCrossReferences(value: unknown): boolean {
  return productCrossReferenceCount(value) > 0;
}

export function mergeProductCrossReferences(
  existing: unknown,
  additions: Array<unknown>
): string | null {
  const merged: string[] = [];
  const seen = new Set<string>();

  const add = (value: unknown) => {
    for (const item of splitProductCrossReferences(value)) {
      const key = productCrossReferenceKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  };

  add(existing);
  for (const addition of additions) add(addition);

  return merged.length ? `${merged.join("; ")};` : null;
}
