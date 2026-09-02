import { normalizeCrossReferenceBrand, normalizePartNumberForCrossMatch } from "./part-number-cross-reference";

export const NONSTOCK_PRODUCT_ASSORTMENT_TYPE = "nonstock_product" as const;
export const NONSTOCK_PRODUCT_LINE_KIND = "nonstock_product" as const;
export const NONSTOCK_PRODUCT_COST_SOURCE = "ONE_OFF_PURCHASE_SNAPSHOT" as const;

export type NonstockProductGroupCode =
  | "OIL_FILTER"
  | "AIR_FILTER"
  | "CABIN_FILTER"
  | "FUEL_FILTER"
  | "TRANSMISSION_FILTER"
  | "GASKET_OR_PAN"
  | "DRAIN_PLUG_OR_SEAL"
  | "ENGINE_OIL"
  | "TRANSMISSION_FLUID"
  | "ANTIFREEZE"
  | "SPARE_PART"
  | "CONSUMABLE"
  | "OTHER";

export type NonstockProductUomCode = "PCS" | "L" | "SET" | "PACKAGE";

export type NonstockProductInput = {
  groupCode: string;
  brand: string;
  article: string;
  uomCode: string;
  purchasePrice: number | null;
  explicitZeroCost?: boolean;
  purchaseSourceId?: string | null;
  purchaseSourceLabel?: string | null;
  clarification?: string | null;
};

export type NormalizedNonstockProduct = {
  groupCode: NonstockProductGroupCode;
  groupLabel: string;
  brandRaw: string;
  brandCanonical: string;
  brandIdentity: string;
  articleRaw: string;
  articleDisplay: string;
  articleCanonical: string;
  uomCode: NonstockProductUomCode;
  uomLabel: string;
  purchasePriceCents: number | null;
  explicitZeroCost: boolean;
  purchaseSourceId: string | null;
  purchaseSourceLabel: string | null;
  clarification: string | null;
  name: string;
  analyticsKey: string;
};

export const NONSTOCK_PRODUCT_GROUPS: ReadonlyArray<{ code: NonstockProductGroupCode; label: string; articleRequired: boolean }> = [
  { code: "OIL_FILTER", label: "Масляный фильтр", articleRequired: true },
  { code: "AIR_FILTER", label: "Воздушный фильтр", articleRequired: true },
  { code: "CABIN_FILTER", label: "Салонный фильтр", articleRequired: true },
  { code: "FUEL_FILTER", label: "Топливный фильтр", articleRequired: true },
  { code: "TRANSMISSION_FILTER", label: "Фильтр АКПП / вариатора", articleRequired: true },
  { code: "GASKET_OR_PAN", label: "Прокладка / поддон", articleRequired: true },
  { code: "DRAIN_PLUG_OR_SEAL", label: "Сливная пробка / уплотнение", articleRequired: true },
  { code: "ENGINE_OIL", label: "Моторное масло", articleRequired: false },
  { code: "TRANSMISSION_FLUID", label: "Трансмиссионная жидкость", articleRequired: false },
  { code: "ANTIFREEZE", label: "Антифриз", articleRequired: false },
  { code: "SPARE_PART", label: "Запчасть", articleRequired: true },
  { code: "CONSUMABLE", label: "Расходный материал", articleRequired: false },
  { code: "OTHER", label: "Другой товар", articleRequired: false },
];

/**
 * Existing catalog-group names that can be selected unambiguously from a
 * structured one-off category. Categories such as generic spare parts, oils,
 * and consumables intentionally have no automatic payroll mapping.
 */
export const NONSTOCK_PRODUCT_PAYROLL_GROUP_NAMES: Readonly<Partial<Record<NonstockProductGroupCode, string>>> = {
  OIL_FILTER: "Масляные фильтры",
  AIR_FILTER: "Воздушные фильтры",
  CABIN_FILTER: "Салонные фильтры",
  FUEL_FILTER: "Топливные фильтры",
  TRANSMISSION_FILTER: "Масляные фильтры АКПП",
  GASKET_OR_PAN: "Уплотнительные кольца и прокладки",
  DRAIN_PLUG_OR_SEAL: "Уплотнительные кольца и прокладки",
  ANTIFREEZE: "Антифриз",
};

export const NONSTOCK_PRODUCT_UOMS: ReadonlyArray<{ code: NonstockProductUomCode; label: string }> = [
  { code: "PCS", label: "шт." },
  { code: "L", label: "л" },
  { code: "SET", label: "комплект" },
  { code: "PACKAGE", label: "упаковка" },
];

function normalizedText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function identityText(value: unknown): string {
  return normalizedText(value)
    .toLocaleUpperCase("ru-RU")
    .replace(/[ёЁ]/g, "Е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizeNonstockProductBrand(value: unknown): { raw: string; display: string; identity: string } {
  const raw = normalizedText(value);
  const normalized = normalizeCrossReferenceBrand(raw) ?? "";
  const display = normalized === "MANN" ? "MANN-FILTER" : normalized;
  return { raw, display, identity: normalized === "MANN" ? "MANN" : identityText(display) };
}

export function normalizeNonstockProductArticle(value: unknown) {
  const raw = normalizedText(value);
  const normalized = normalizePartNumberForCrossMatch(raw);
  return { raw, display: normalized.rawNormalized, canonical: normalized.canonical };
}

function finiteMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Закупочная цена должна быть неотрицательным числом");
  return Math.round(parsed * 100);
}

export function normalizeNonstockProductInput(input: NonstockProductInput): NormalizedNonstockProduct {
  const group = NONSTOCK_PRODUCT_GROUPS.find((item) => item.code === input.groupCode);
  if (!group) throw new Error("Выберите тип разового товара из списка");
  const uom = NONSTOCK_PRODUCT_UOMS.find((item) => item.code === input.uomCode);
  if (!uom) throw new Error("Выберите единицу измерения из списка");

  const brand = normalizeNonstockProductBrand(input.brand);
  if (!brand.display || !brand.identity) throw new Error("Укажите бренд разового товара");
  const article = normalizeNonstockProductArticle(input.article);
  if (group.articleRequired && !article.canonical) throw new Error(`Укажите артикул для типа «${group.label}»`);

  const explicitZeroCost = input.explicitZeroCost === true;
  const purchasePriceCents = explicitZeroCost ? 0 : finiteMoney(input.purchasePrice);
  const clarification = normalizedText(input.clarification) || null;
  const nameParts = [group.label, clarification, brand.display, article.display].filter(Boolean);
  const analyticsArticle = article.canonical || clarification?.toLocaleUpperCase("ru-RU") || "NO_ARTICLE";

  return {
    groupCode: group.code,
    groupLabel: group.label,
    brandRaw: brand.raw,
    brandCanonical: brand.display,
    brandIdentity: brand.identity,
    articleRaw: article.raw,
    articleDisplay: article.display,
    articleCanonical: article.canonical,
    uomCode: uom.code,
    uomLabel: uom.label,
    purchasePriceCents,
    explicitZeroCost,
    purchaseSourceId: normalizedText(input.purchaseSourceId) || null,
    purchaseSourceLabel: normalizedText(input.purchaseSourceLabel) || null,
    clarification,
    name: nameParts.join(" "),
    analyticsKey: [group.code, brand.display, analyticsArticle].join("|"),
  };
}

export function assertNonstockProductPostingCost(product: Pick<NormalizedNonstockProduct, "purchasePriceCents" | "explicitZeroCost">) {
  if (product.purchasePriceCents == null) {
    throw new Error("Укажите закупочную цену разового товара. Без неё прибыль по отгрузке будет рассчитана неверно.");
  }
  if (product.purchasePriceCents === 0 && !product.explicitZeroCost) {
    throw new Error("Нулевая себестоимость допустима только после подтверждения «Получено бесплатно».");
  }
}

export function isNonstockProductType(value: unknown): boolean {
  return normalizedText(value).toLocaleLowerCase("ru-RU") === NONSTOCK_PRODUCT_ASSORTMENT_TYPE;
}
