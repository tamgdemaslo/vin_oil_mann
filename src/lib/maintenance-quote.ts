import { buildRequirementsNorm } from "@/lib/oil-normalizer";
import { resolveProductFluidAttributeProfile } from "@/lib/product-fluid-profile";
import { parsePackVolumeLitersFromOilName } from "@/lib/oil-pack-volume";
import { isLiterSaleUnit } from "@/lib/product-marking";

export type QuoteStockProduct = {
  id: string; name: string; article: string; price: number; available: number;
  unit: string; litresPerUnit: number | null; sae: string; oem: string;
};
export type QuoteExtra = { id: string; name: string; quantity: number; price: number };
export function matchesQuoteOil(product: { groupPath?: string | null; entityType?: string; sae?: string | null; oem?: string | null; acea?: string | null; apiSpec?: string | null; ilsac?: string | null }, specification: string, viscosity: string) {
  if (resolveProductFluidAttributeProfile(product) !== "ENGINE_OIL") return false;
  const required = buildRequirementsNorm({ oem: specification, acea: specification, api: specification, ilsac: specification, sae: viscosity });
  const actual = buildRequirementsNorm({ ...product, api: product.apiSpec });
  // An OEM approval cannot be replaced by a viscosity or a lower-level standard.
  const family = required.oem.length ? "oem" : required.acea.length ? "acea" : required.api.length ? "api" : "ilsac";
  if (!required[family].length || !required[family].some(value => actual[family].includes(value))) return false;
  if (viscosity.trim() && !required.sae.length) return false;
  return !required.sae.length || required.sae.some(value => actual.sae.includes(value));
}
export function quoteLitresPerUnit(product: { uomName?: string | null; packageVolume?: string | null; name: string }) {
  if (isLiterSaleUnit(product.uomName)) return 1;
  const raw = product.packageVolume?.trim();
  const volume = raw ? (/^\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(",", ".")) : parsePackVolumeLitersFromOilName(raw)) : parsePackVolumeLitersFromOilName(product.name);
  return volume && volume > 0 ? volume : null;
}
export function quoteOilAmount(product: QuoteStockProduct, litres: number) {
  if (!(litres > 0) || !Number.isFinite(litres) || !product.litresPerUnit) return null;
  const quantity = isLiterSaleUnit(product.unit) ? litres : Math.ceil(Number((litres / product.litresPerUnit).toFixed(6)));
  return { quantity, suppliedLitres: quantity * product.litresPerUnit, cents: Math.round(quantity * Math.round(product.price * 100)), enough: quantity <= product.available + 0.000001 };
}
export function quoteExtraCents(extras: QuoteExtra[]) {
  return extras.reduce((sum, row) => sum + Math.round(row.quantity * Math.round(row.price * 100)), 0);
}
export const quoteRub = (cents: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(cents / 100);
export function quoteClientText(vehicle: string, specification: string, litres: number, oils: QuoteStockProduct[], extras: QuoteExtra[]) {
  return [`Расчёт ТО: ${vehicle}`, `Моторное масло: ${specification}; объём замены ${litres} л.`, ...oils.flatMap((oil, index) => {
    const amount = quoteOilAmount(oil, litres);
    if (!amount) return [];
    return ["", `Вариант ${index + 1} — ${oil.name}`, `Масло: ${amount.quantity} ${oil.unit || "шт."} × ${quoteRub(Math.round(oil.price * 100))} = ${quoteRub(amount.cents)}`, ...(amount.suppliedLitres > litres + 0.001 ? [`В упаковках: ${amount.suppliedLitres} л.`] : []), ...extras.map(row => `${row.name}: ${row.quantity} × ${quoteRub(Math.round(row.price * 100))} = ${quoteRub(Math.round(row.quantity * Math.round(row.price * 100)))}`), `Итого: ${quoteRub(amount.cents + quoteExtraCents(extras))}`, amount.enough ? "Масло в наличии." : "Масло — под заказ, требуется уточнить срок."];
  }), "", "Предварительный расчёт. Наличие и цены уточняются при записи."].join("\n");
}

export type QuoteFilterGroup = {
  key: string; label: string; article: string; condition?: string | null;
  products: { id: string; name: string; article?: string | null; price: number; available: number; orderable: boolean }[];
};

export function quoteRequirementChoices(profile: import("@/lib/mann-unified-technical-profile").MannUnifiedTechnicalProfile | null, research: import("@/lib/mann-fluid-research").MannFluidResearchResult | null) {
  const engines = profile?.items.filter(item => item.systemCode === "ENGINE_OIL") ?? [];
  const discoveries = research?.items.filter(item => item.systemCode === "ENGINE_OIL") ?? [];
  const raw = [...engines.flatMap(item => item.specifications), ...discoveries.map(item => item.specification)].join("; ");
  const norm = buildRequirementsNorm({ oem: raw, acea: raw, api: raw, ilsac: raw, sae: [...engines.flatMap(item => item.viscosityGrades), raw].join("; ") });
  const specifications = [...new Set(norm.oem.length ? norm.oem : [...norm.acea, ...norm.api, ...norm.ilsac])];
  const viscosities = [...new Set(norm.sae)];
  const capacities = engines.flatMap(item => item.capacities.map(capacity => ({ capacity, trusted: !item.requiresReview && item.sourceStatus === "primary_source" && (!capacity.qualifier || capacity.qualifier === "EXACT") })));
  const volumes = [...new Set(capacities.flatMap(({capacity}) => [capacity.nominalLiters, capacity.minLiters, capacity.maxLiters]).filter((value): value is number => !!value && value > 0))];
  const trustedVolumes = [...new Set(capacities.filter(item => item.trusted).map(item => item.capacity.nominalLiters).filter((value): value is number => !!value))];
  return { specifications, viscosities, volumes, automaticVolume: trustedVolumes.length === 1 && volumes.length === 1 ? String(trustedVolumes[0]) : "" };
}
