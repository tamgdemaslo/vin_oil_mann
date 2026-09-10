import { createHash } from "node:crypto";
import { normalizePartNumberForCrossMatch } from "@/lib/part-number-cross-reference";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown) => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const numeric = (value: unknown) => { if (!text(value)) return null; const n = Number(text(value).replace(",", ".")); return Number.isFinite(n) ? n : null; };
export function parseAssistantRosskoOffers(raw: unknown, branchId: string, fetchedAt = new Date().toISOString()) {
  const root = object(raw);
  const partList = object(root.PartsList);
  if (!Object.hasOwn(partList, "Part")) throw new Error("ROSSKO_PARSING_ERROR");
  return array(partList.Part).flatMap(value => {
    const part = object(value);
    return array(object(part.stocks).stock).map(value => {
      const stock = object(value);
      const brand = text(part.brand), article = text(part.partnumber), partId = text(part.guid), stockId = text(stock.id);
      const identity = [branchId, brand, article, partId, stockId];
      const price = numeric(stock.price);
      return {
        id: identity.every(Boolean) ? createHash("sha256").update(JSON.stringify(identity)).digest("hex") : null,
        partId, stockId, brand, article, name: text(part.name) || null,
        purchasePriceCents: price == null ? null : Math.round(price * 100),
        availableQuantity: numeric(stock.count), quantityMultiple: numeric(stock.multiplicity ?? stock.multiple),
        packageVolume: text(stock.packageVolume ?? part.packageVolume) || null,
        uomName: text(stock.unit ?? part.unit) || null,
        deliveryDays: numeric(stock.delivery), fetchedAt,
      };
    });
  });
}
export function sameSupplierArticle(left: unknown, right: unknown) {
  const a = normalizePartNumberForCrossMatch(text(left)), b = normalizePartNumberForCrossMatch(text(right));
  return Boolean(a.canonical) && a.canonical === b.canonical;
}
