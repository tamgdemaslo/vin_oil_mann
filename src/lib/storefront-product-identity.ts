import { sameExactProductIdentity } from "@/lib/product-identity";
import { isLiterSaleUnit } from "@/lib/product-marking";
import { normalizeSAE } from "@/lib/oil-normalizer";
import { resolveProductFluidAttributeProfile } from "@/lib/product-fluid-profile";

export type StorefrontIdentityProduct = {
  id?: string;
  branchId?: string;
  name?: string | null;
  groupPath?: string | null;
  description?: string | null;
  searchText?: string | null;
  brand?: string | null;
  article?: string | null;
  code?: string | null;
  barcodeEan13?: string | null;
  barcodeEan8?: string | null;
  barcodeCode128?: string | null;
  uomName?: string | null;
  packageVolume?: string | null;
  volume?: unknown;
  weight?: unknown;
  modificationCode?: string | null;
  markingMode?: string | null;
  sae?: string | null;
  acea?: string | null;
  apiSpec?: string | null;
  ilsac?: string | null;
  oem?: string | null;
};

export type StorefrontIdentityEvidence =
  | "CONFIRMED_BINDING"
  | "SOURCE_LINEAGE"
  | "BARCODE"
  | "BRAND_ARTICLE"
  | "MANUAL";

function canonical(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleUpperCase("ru-RU")
    .replace(/[Ё]/g, "Е")
    .replace(/\s+/g, " ");
}

function normalizedBarcode(value: unknown) {
  return canonical(value).replace(/\s+/g, "");
}

function sameNonEmpty(left: unknown, right: unknown) {
  const a = canonical(left);
  const b = canonical(right);
  return Boolean(a && b && a === b);
}

function isBulkSale(product: StorefrontIdentityProduct) {
  return product.markingMode === "BULK_OIL_FROM_MARKED_BARREL" || isLiterSaleUnit(product.uomName);
}

/**
 * Packaging and sale format are identity-bearing. This intentionally does not
 * infer conversions between a barrel, a litre sale and a sealed package.
 */
export function sameStorefrontSaleFormat(left: StorefrontIdentityProduct, right: StorefrontIdentityProduct) {
  if (isBulkSale(left) !== isBulkSale(right)) return false;
  return ["uomName", "packageVolume", "volume", "weight", "modificationCode"].every((key) => {
    const a = canonical(left[key as keyof StorefrontIdentityProduct]);
    const b = canonical(right[key as keyof StorefrontIdentityProduct]);
    return a === b;
  });
}

export function sharedVerifiedBarcode(left: StorefrontIdentityProduct, right: StorefrontIdentityProduct) {
  const leftCodes = [left.barcodeEan13, left.barcodeEan8, left.barcodeCode128]
    .map(normalizedBarcode)
    .filter(Boolean);
  const rightCodes = new Set(
    [right.barcodeEan13, right.barcodeEan8, right.barcodeCode128]
      .map(normalizedBarcode)
      .filter(Boolean)
  );
  return leftCodes.find((code) => rightCodes.has(code)) ?? null;
}

export function storefrontIdentityEvidence(
  left: StorefrontIdentityProduct,
  right: StorefrontIdentityProduct,
  options: { sourceLineage?: boolean } = {}
): StorefrontIdentityEvidence | null {
  if (!sameStorefrontSaleFormat(left, right)) return null;
  if (sameExactProductIdentity(left, right)) {
    return options.sourceLineage ? "SOURCE_LINEAGE" : "BRAND_ARTICLE";
  }
  if (sharedVerifiedBarcode(left, right) && sameNonEmpty(left.brand, right.brand)) return "BARCODE";
  return null;
}

const CONFLICT_FIELDS: Array<{
  key: keyof StorefrontIdentityProduct;
  label: string;
}> = [
  { key: "brand", label: "бренд" },
  { key: "article", label: "артикул" },
  { key: "sae", label: "SAE" },
  { key: "acea", label: "ACEA" },
  { key: "apiSpec", label: "API" },
  { key: "ilsac", label: "ILSAC" },
  { key: "oem", label: "OEM-допуски" },
  { key: "packageVolume", label: "фасовка" },
  { key: "uomName", label: "единица продажи" },
];

export function storefrontTechnicalConflicts(
  source: StorefrontIdentityProduct,
  others: StorefrontIdentityProduct[]
) {
  const conflicts: string[] = [];
  for (const field of CONFLICT_FIELDS) {
    const sourceValue = canonical(source[field.key]);
    for (const other of others) {
      const otherValue = canonical(other[field.key]);
      if (sourceValue && otherValue && sourceValue !== otherValue) {
        conflicts.push(field.label);
        break;
      }
    }
  }
  return [...new Set(conflicts)];
}

export function storefrontPublicationReadiness(product: StorefrontIdentityProduct & {
  entityType?: string | null;
  archived?: boolean;
  salePriceCents?: number | null;
}) {
  const problems: string[] = [];
  if (product.archived) problems.push("Карточка находится в архиве.");
  if (!product.entityType || product.entityType === "service") problems.push("Не определён вид товара.");
  const fluidProfile = resolveProductFluidAttributeProfile(product);
  const motorOilSignal = fluidProfile === "ENGINE_OIL" || normalizeSAE(product.sae ?? product.name ?? "").length > 0;
  if (!motorOilSignal) problems.push("Товар не распознан как моторное масло.");
  if (!canonical(product.name)) problems.push("Не указано название.");
  if (!canonical(product.brand)) problems.push("Не указан бренд.");
  if (!canonical(product.uomName)) problems.push("Не указана единица продажи.");
  if (!isBulkSale(product) && !canonical(product.packageVolume)) problems.push("Не указана фасовка.");
  if (!Number.isFinite(product.salePriceCents) || Number(product.salePriceCents) <= 0) {
    problems.push("Не задана розничная цена.");
  }
  return problems;
}
