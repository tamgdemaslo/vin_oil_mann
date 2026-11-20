import { quoteOilAmount, type QuoteStockProduct } from "@/lib/maintenance-quote";
import { isLiterSaleUnit } from "@/lib/product-marking";

export function fluidPackageSaleUnitKind(value: string): "piece" | "package" | "canister" | "bottle" | null {
  const unit = value.trim();
  if (/^(?:шт\.?|штука|штуки|штук|pcs?\.?|pieces?|units?|ea|each)$/iu.test(unit)) return "piece";
  if (/^(?:упак\.?|упаковка|упаковки)$/iu.test(unit)) return "package";
  if (/^(?:канистра|канистры|кан\.?)$/iu.test(unit)) return "canister";
  if (/^(?:бут\.?|бутылка|бутылки)$/iu.test(unit)) return "bottle";
  return null;
}
export function isFluidPackageSaleUnit(value: string) {
  return fluidPackageSaleUnitKind(value) !== null;
}

/** Supplier multiplicity is in sale units, not litres or an implicit pack size. */
export function quoteFluidOfferAmount(product: QuoteStockProduct & { quantityMultiple?: number }, litres: number) {
  if (!Number.isFinite(product.price) || product.price < 0 || !Number.isFinite(product.available) || product.available < 0
    || !Number.isFinite(product.litresPerUnit) || !(product.litresPerUnit! > 0)) return null;
  if (!isLiterSaleUnit(product.unit) && !isFluidPackageSaleUnit(product.unit)) return null;
  const base = quoteOilAmount(product, litres);
  if (!base) return null;
  const multiple = product.quantityMultiple ?? 1;
  if (!Number.isSafeInteger(multiple) || multiple < 1 || (isLiterSaleUnit(product.unit) && multiple !== 1)) return null;
  const quantity = isLiterSaleUnit(product.unit) ? base.quantity : Math.ceil(base.quantity / multiple) * multiple;
  const suppliedLitres = Math.round(quantity * product.litresPerUnit! * 1e6) / 1e6;
  const cents = Math.round(quantity * Math.round(product.price * 100));
  if (!Number.isFinite(quantity) || !Number.isFinite(suppliedLitres) || !Number.isSafeInteger(cents)) return null;
  return { quantity, suppliedLitres, cents, enough: quantity <= product.available + 0.000001 };
}
