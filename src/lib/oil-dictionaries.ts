/**
 * Compatibility facade for the oil matcher. Canonical values now come from the
 * generated, browser-safe dictionary artifact; runtime XML/fs access is gone.
 */
import {
  getProductAttributeDictionary,
  normalizeAttributeValue,
  normalizeAttributeValues,
  productAttributeLookupKey,
  type ProductAttributeField,
} from "@/lib/product-attribute-values";

export function getCanonicalSAE(): string[] {
  return [...getProductAttributeDictionary("engineSae")];
}

export function getCanonicalACEA(): string[] {
  return [...getProductAttributeDictionary("acea")];
}

export function getCanonicalAPI(): string[] {
  return [...getProductAttributeDictionary("engineApi")];
}

export function getCanonicalOEM(): string[] {
  return [...getProductAttributeDictionary("engineOem")];
}

export function normalizeForMatch(value: string): string {
  return productAttributeLookupKey("engineOem", value);
}

function inferField(canonicalList: string[]): ProductAttributeField {
  const candidates: ProductAttributeField[] = ["engineSae", "acea", "engineApi", "engineOem"];
  return candidates.find((field) => {
    const dictionary = getProductAttributeDictionary(field);
    return canonicalList === dictionary || (canonicalList.length === dictionary.length && canonicalList.every((value, index) => value === dictionary[index]));
  }) ?? "engineOem";
}

/** Exact/normalized/verified matches only. Substring matches are never auto-selected. */
export function findCanonical(canonicalList: string[], input: string): string | null {
  const field = inferField(canonicalList);
  const result = normalizeAttributeValue(field, input);
  return result.status === "CUSTOM" || result.status === "AMBIGUOUS" ? null : result.value;
}

/** Longest-match parsing is handled centrally and preserves slash-composite values. */
export function findAllCanonical(canonicalList: string[], input: string): string[] {
  const field = inferField(canonicalList);
  return normalizeAttributeValues(field, input)
    .filter((result) => result.status !== "CUSTOM" && result.status !== "AMBIGUOUS")
    .map((result) => result.value);
}

export function findAllCanonicalSubstrings(canonicalList: string[], input: string): string[] {
  return findAllCanonical(canonicalList, input);
}
