import { normalizeCrossReferenceBrand, normalizePartNumberForCrossMatch } from "@/lib/part-number-cross-reference";

export type ProductIdentityInput = {
  brand?: unknown;
  article?: unknown;
  uomName?: unknown;
  packageVolume?: unknown;
  volume?: unknown;
  weight?: unknown;
  modificationCode?: unknown;
};

function canonicalIdentityText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleUpperCase("ru-RU")
    .replace(/[ёЁ]/g, "Е")
    .replace(/\s+/g, " ");
}

export function normalizeProductIdentityBrand(value: unknown): string {
  if (normalizeCrossReferenceBrand(value) === "MANN") return "MANN";
  return canonicalIdentityText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizeProductIdentityArticle(value: unknown): string {
  return normalizePartNumberForCrossMatch(value).canonical;
}

export function productIdentityKey(input: ProductIdentityInput): string | null {
  const brand = normalizeProductIdentityBrand(input.brand);
  const article = normalizeProductIdentityArticle(input.article);
  if (!brand || !article) return null;
  const sku = [input.uomName, input.packageVolume, input.volume, input.weight, input.modificationCode]
    .map(canonicalIdentityText);
  return [brand, article, ...sku].join("\u0000");
}

export function sameExactProductIdentity(left: ProductIdentityInput, right: ProductIdentityInput): boolean {
  const leftKey = productIdentityKey(left);
  return Boolean(leftKey && leftKey === productIdentityKey(right));
}
