import { loadMaintenanceFluidStock, type MaintenanceFluidStockProduct, type MaintenanceStockFluidSystem } from "@/lib/maintenance-fluid-stock";
import { quoteLitresPerUnit } from "@/lib/maintenance-quote";
import { fluidPackageSaleUnitKind, isFluidPackageSaleUnit } from "@/lib/maintenance-fluid-offer-amount";
import { parseAssistantRosskoOffers, sameSupplierArticle } from "@/lib/ai-assistant/supplier-offers";
import { rosskoConfig, rosskoSearch } from "@/lib/rossko";
import { getAgentSettings } from "@/lib/ai-agent/settings";
import type { AIRosskoMarkupRule } from "@/lib/ai-agent/types";

export type MaintenanceFluidReference = Pick<MaintenanceFluidStockProduct,
  "id" | "name" | "unit" | "litresPerUnit" | "compatibilityEvidence" | "approvalStatus" | "requiresManualReview"> & { brand: string; article: string };
export type MaintenanceFluidRosskoProduct = MaintenanceFluidStockProduct & {
  source: "rossko"; localProductId: string; deliveryLabel: string; deliveryAt: string | null;
  deliveryDays: number | null; quantityMultiple: number; packageEvidence: string;
};
type Input = { branchId: string; storeId: string; systemCode: MaintenanceStockFluidSystem; specifications: string[]; viscosity?: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => value == null ? [] : Array.isArray(value) ? value : [value];
const brandKey = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");
const pieceUnit = (value: unknown) => isFluidPackageSaleUnit(String(value ?? ""));
function explicitPackage(volume: string | null | undefined): number | null {
  if (!volume?.trim() || /\d\s*[xх×*]\s*\d/iu.test(volume) || /(?:kg|кг|килограмм|grams?|грамм|\blbs?\b)/iu.test(volume)) return null;
  const litres = quoteLitresPerUnit({ uomName: "шт.", packageVolume: volume, name: "" });
  return litres && Number.isFinite(litres) && litres > 0 ? litres : null;
}
function referencePackage(product: MaintenanceFluidStockProduct) {
  if (!pieceUnit(product.packageUnit) || product.markingMode === "BULK_OIL_FROM_MARKED_BARREL") return null;
  return explicitPackage(product.packageVolume);
}
function reference(product: MaintenanceFluidStockProduct): MaintenanceFluidReference | null {
  const brand = product.rosskoBrand?.trim() || product.brand?.trim();
  const article = product.rosskoPartNumber?.trim() || product.article?.trim();
  if (!brand || !article || !sameSupplierArticle(article, article)) return null;
  return { id: product.id, name: product.name, brand, article, unit: product.unit,
    litresPerUnit: referencePackage(product), compatibilityEvidence: product.compatibilityEvidence,
    approvalStatus: "unknown", requiresManualReview: true };
}
export async function loadMaintenanceFluidReferences(input: Input) {
  const result = await loadMaintenanceFluidStock({ ...input, includeUnavailable: true });
  const references = result.products.map(reference).filter((value): value is MaintenanceFluidReference => Boolean(value));
  return { references, products: [] as MaintenanceFluidRosskoProduct[], ...(references.length ? {} : { reason: result.reason ?? "Нет совместимой цифровой карточки с точным брендом и артикулом." }) };
}

/** Exact root SKU offers only. Supplier crosses never establish fluid compatibility. */
export function quoteMaintenanceFluidRosskoOffers(raw: unknown, product: MaintenanceFluidStockProduct, branchId: string, rules: AIRosskoMarkupRule[], timeZone = "Europe/Kaliningrad"): MaintenanceFluidRosskoProduct[] {
  const ref = reference(product), litres = referencePackage(product);
  if (!ref || !litres) return [];
  const root = object(object(raw).PartsList);
  if (!Object.hasOwn(root, "Part")) throw new Error("ROSSKO_PARSING_ERROR");
  // Published GetSearch stock contract: https://api.rossko.ru/index.php?action=SOAP&path=/GetSearch
  // Regular/sale offers only; extra delivery requires an applicable actual window.
  const parts = list(root.Part).map(object).filter(part => brandKey(part.brand) === brandKey(ref.brand) && sameSupplierArticle(part.partnumber, ref.article)).map((part): Record<string, unknown> => ({ ...part,
    stocks: { stock: list(object(part.stocks).stock).map(object).filter(stock => {
      const validStart = typeof stock.deliveryStart === "string" && Number.isFinite(new Date(stock.deliveryStart).getTime());
      return (stock.type === 0 || stock.type === 1) && (stock.extra === 0 || (stock.extra === 1 && validStart));
    }) },
  }));
  const windows = new Map<string, { start: Date; end: Date | null; rawStart: string; rawEnd: string | null }>();
  for (const part of parts) for (const rawStock of list(object(part.stocks).stock)) {
    const stock = object(rawStock);
    const start = typeof stock.deliveryStart === "string" ? new Date(stock.deliveryStart) : null;
    const end = typeof stock.deliveryEnd === "string" ? new Date(stock.deliveryEnd) : null;
    if (start && Number.isFinite(start.getTime())) windows.set(`${part.guid}|${stock.id}`, { start, end: end && Number.isFinite(end.getTime()) && end >= start ? end : null, rawStart: String(stock.deliveryStart), rawEnd: end && Number.isFinite(end.getTime()) && end >= start ? String(stock.deliveryEnd) : null });
  }
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" });
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit" });
  const hasZone = (value: string) => /(?:Z|[+-]\d{2}:?\d{2})$/iu.test(value);
  const providerClock = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
    return match ? `${match[3]}.${match[2]}.${match[1]}, ${match[4]}:${match[5]}` : value;
  };
  const windowLabel = (value: string, date: Date) => hasZone(value) ? `${day.format(date)}, ${time.format(date)}` : providerClock(value);
  const seen = new Set<string>();
  return parseAssistantRosskoOffers({ PartsList: { Part: parts } }, branchId).flatMap(offer => {
    const multiple = offer.quantityMultiple ?? 1;
    if (!offer.id || seen.has(offer.id) || !Number.isInteger(multiple) || multiple <= 0 || !offer.availableQuantity || !Number.isFinite(offer.availableQuantity) || offer.availableQuantity < multiple || !offer.purchasePriceCents || !Number.isFinite(offer.purchasePriceCents) || offer.purchasePriceCents <= 0) return [];
    // Standard GetSearch omits units: only a fresh exact SKU sold by piece in
    // the digital card can supply that missing contract, always with review.
    const supplierUnitMissing = !offer.uomName?.trim();
    if (supplierUnitMissing ? fluidPackageSaleUnitKind(product.packageUnit ?? "") !== "piece" : !pieceUnit(offer.uomName)) return [];
    const suppliedPackage = offer.packageVolume ? explicitPackage(offer.packageVolume) : null;
    if (offer.packageVolume && (!suppliedPackage || Math.abs(suppliedPackage - litres) > 0.000001)) return [];
    // Without an explicit supplier volume, a carton cannot inherit the bottle volume.
    if (!suppliedPackage && !supplierUnitMissing && fluidPackageSaleUnitKind(offer.uomName ?? "") !== fluidPackageSaleUnitKind(product.packageUnit ?? "")) return [];
    const rule = rules.find(rule => offer.purchasePriceCents! >= rule.fromCents && (rule.toCents == null || offer.purchasePriceCents! < rule.toCents));
    if (!rule || !Number.isFinite(rule.marginPercent)) return [];
    const cents = Math.round(offer.purchasePriceCents * (1 + rule.marginPercent / 100));
    if (!Number.isFinite(cents) || cents <= 0) return [];
    const window = windows.get(`${offer.partId}|${offer.stockId}`);
    const deliveryDays = offer.deliveryDays != null && offer.deliveryDays >= 0 ? offer.deliveryDays : null;
    const deliveryLabel = window
      ? `${windowLabel(window.rawStart, window.start)}${window.end && window.rawEnd ? ` — ${windowLabel(window.rawEnd, window.end)}` : ""}`
      : deliveryDays != null ? `Срок поставщика: ${deliveryDays} дн.` : "Срок доставки поставщиком не указан";
    const packageEvidence = supplierUnitMissing
      ? `Точный SKU ${ref.brand} ${ref.article}: поставщик не передал единицу продажи${suppliedPackage ? "" : " и фасовку"}; количество трактуется в SKU-штуках по свежей цифровой карточке ${litres} л. Требуется ручная проверка единицы и упаковки.`
      : suppliedPackage
      ? `Точный SKU ${ref.brand} ${ref.article}: фасовка поставщика ${litres} л совпадает с цифровой карточкой; единица поставщика ${offer.uomName}.`
      : `Точный SKU ${ref.brand} ${ref.article}: поставщик не передал фасовку; использовано ${litres} л из цифровой карточки при единице ${offer.uomName}. Требуется ручная проверка упаковки.`;
    seen.add(offer.id);
    return [{ id: `rossko:${offer.id}`, source: "rossko" as const, localProductId: product.id,
      name: product.name, brand: offer.brand, article: offer.article, price: cents / 100,
      available: offer.availableQuantity, unit: product.unit, litresPerUnit: litres, sae: product.sae, oem: product.oem,
      compatibilityEvidence: product.compatibilityEvidence, approvalStatus: "unknown" as const, requiresManualReview: true,
      deliveryLabel, deliveryAt: window && hasZone(window.rawStart) ? window.start.toISOString() : null, deliveryDays, quantityMultiple: multiple, packageEvidence }];
  });
}
export async function loadMaintenanceFluidRosskoOffers(input: Input & { productId: string; organizationId: string; timeZone?: string }) {
  // Re-read the exact scoped card; neither a prior reference response nor a stale
  // offered SKU can override changed SAE/declarations/brand/article/packaging.
  const current = await loadMaintenanceFluidStock({ ...input, includeUnavailable: true, productId: input.productId });
  const product = current.products.find(product => product.id === input.productId);
  if (!product || !reference(product)) return { products: [], reason: "Карточка больше не подтверждает совместимость или точный SKU. Выберите позицию заново." };
  if (!referencePackage(product)) return { products: [], reason: "Фасовка или штучная единица цифровой карточки не подтверждены. Розлив и неизвестная упаковка не передаются поставщику." };
  const ref = reference(product)!;
  const cfg = await rosskoConfig();
  if (!cfg.deliveryId?.trim()) return { products: [], reason: "Выберите способ доставки в настройках Росско." };
  const settings = await getAgentSettings(input.organizationId);
  const raw = await rosskoSearch(cfg, { text: `${ref.brand} ${ref.article}`, deliveryId: cfg.deliveryId, addressId: cfg.addressId });
  const products = quoteMaintenanceFluidRosskoOffers(raw, product, input.branchId, settings.rosskoMarkupRules, input.timeZone);
  return products.length ? { products } : { products: [], reason: "Нет точного предложения с подтверждёнными упаковкой, единицей, ценой и доступным количеством. Аналоги не подставляются." };
}
