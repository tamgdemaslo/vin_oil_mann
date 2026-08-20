import { normalizePartNumberForCrossMatch, parseOemParts } from "@/lib/part-number-cross-reference";

export function productCrossReferenceKey(value: unknown): string {
  return normalizePartNumberForCrossMatch(value).canonical.toLocaleLowerCase("ru-RU");
}

export function splitProductCrossReferences(value: unknown): string[] {
  return parseOemParts(value).map((entry) => [entry.brand, entry.canonical].filter(Boolean).join(" "));
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
