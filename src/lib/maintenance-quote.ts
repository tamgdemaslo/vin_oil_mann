import { buildRequirementsNorm } from "@/lib/oil-normalizer";
import { resolveProductFluidAttributeProfile } from "@/lib/product-fluid-profile";
import { parsePackVolumeLitersFromOilName } from "@/lib/oil-pack-volume";
import { isLiterSaleUnit } from "@/lib/product-marking";

export type QuoteStockProduct = {
  id: string; name: string; article: string; price: number; available: number;
  unit: string; litresPerUnit: number | null; sae: string; oem: string;
};
export type QuoteExtra = { id: string; name: string; quantity: number; price: number; stockStoreId?: string };
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
export type QuoteOilVariant = { key: string; name: string; products: QuoteStockProduct[] };
export function groupQuoteOils(oils: QuoteStockProduct[]): QuoteOilVariant[] {
  const groups = new Map<string, QuoteOilVariant>();
  for (const oil of oils) {
    // Remove only package sizes, preserving formulation names and text in parentheses.
    const name = oil.name.replace(/(?:^|[\s,;(])\d+(?:[.,]\d+)?\s*(?:литров|литра|литр|л|l)\.?(?=[\s,;)]|$)/gi, " ").replace(/моторное\s+масло/gi, "").replace(/[\s,;.]+$/g, "").replace(/\s+/g, " ").trim();
    const norm = buildRequirementsNorm({sae:oil.sae,oem:oil.oem});
    const key = [name.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]/gu,""), norm.sae.sort().join(","), norm.oem.sort().join(","), isLiterSaleUnit(oil.unit) ? "bulk" : "pack"].join("|");
    const group = groups.get(key) ?? {key,name,products:[]};
    if (!group.products.some(item => item.id === oil.id)) group.products.push(oil);
    groups.set(key,group);
  }
  return [...groups.values()];
}
export function quoteVariantAmount(variant: QuoteOilVariant, litres: number) {
  if (!(litres > 0) || litres > 100 || !Number.isFinite(litres)) return null;
  if (variant.products.every(item => isLiterSaleUnit(item.unit))) {
    const sorted = variant.products.filter(item => item.price > 0).sort((a,b)=>a.price-b.price);
    const oil = sorted.find(item => item.available >= litres) ?? sorted[0];
    if (!oil) return null;
    const amount = quoteOilAmount(oil,litres);
    return amount ? {...amount,lines:[{product:oil,quantity:amount.quantity,cents:amount.cents}]} : null;
  }
  const products = variant.products.filter(item => item.litresPerUnit && item.litresPerUnit > 0 && item.price > 0 && Number.isFinite(item.price));
  if (!products.length) return null;
  const sizes = products.map(item=>Math.round(item.litresPerUnit! * 1000));
  if (sizes.some(size=>size < 1)) return null;
  const gcd = (a:number,b:number):number => b ? gcd(b,a%b) : a;
  const step = sizes.reduce(gcd);
  const target = Math.ceil(litres * 1000 / step - 0.000001);
  const units = sizes.map(size=>size / step);
  const cap = target + Math.max(...units) - 1;
  if (cap > 200000) return null;
  const solve = (bounded:boolean) => {
    const states: Array<{cents:number;counts:number[]} | undefined> = Array(cap+1);
    states[0] = {cents:0,counts:products.map(()=>0)};
    products.forEach((product,index)=>{
      let remaining = Math.min(bounded ? Math.floor(product.available) : Math.ceil(cap/units[index]), Math.ceil(cap/units[index]));
      for (let batch=1; remaining>0; batch*=2) {
        const count = Math.min(batch,remaining); remaining-=count;
        const size = count*units[index], cost = count*Math.round(product.price*100);
        for (let amount=cap;amount>=size;amount--) {
          const previous=states[amount-size]; if(!previous) continue;
          const cents=previous.cents+cost;
          if (!states[amount] || cents<states[amount]!.cents) {
            const counts=[...previous.counts]; counts[index]+=count; states[amount]={cents,counts};
          }
        }
      }
    });
    for (let amount=target;amount<=cap;amount++) if(states[amount]) return {state:states[amount]!,suppliedLitres:amount*step/1000};
    return null;
  };
  const inStock=solve(true), solution=inStock ?? solve(false);
  if (!solution) return null;
  const lines=products.flatMap((product,index)=>solution.state.counts[index] ? [{product,quantity:solution.state.counts[index],cents:solution.state.counts[index]*Math.round(product.price*100)}] : []);
  return {quantity:lines.reduce((sum,line)=>sum+line.quantity,0),suppliedLitres:solution.suppliedLitres,cents:solution.state.cents,enough:Boolean(inStock),lines};
}
export function quoteClientText(vehicle: string, specification: string, litres: number, oils: QuoteStockProduct[], extras: QuoteExtra[]) {
  return [`Расчёт ТО: ${vehicle}`, `Моторное масло: ${specification}; объём замены ${litres} л.`, ...groupQuoteOils(oils).flatMap((variant, index) => {
    const amount = quoteVariantAmount(variant, litres);
    if (!amount) return [];
    return ["", `Вариант ${index + 1} — ${variant.name}`, ...amount.lines.map(line=>`Масло${isLiterSaleUnit(line.product.unit) ? "" : ` (фасовка ${line.product.litresPerUnit} л)`}: ${line.quantity} ${line.product.unit || "шт."} × ${quoteRub(Math.round(line.product.price * 100))} = ${quoteRub(line.cents)}`), ...(amount.suppliedLitres > litres + 0.001 ? [`В упаковках: ${amount.suppliedLitres} л.`] : []), ...extras.map(row => `${row.name}: ${row.quantity} × ${quoteRub(Math.round(row.price * 100))} = ${quoteRub(Math.round(row.quantity * Math.round(row.price * 100)))}`), `Итого: ${quoteRub(amount.cents + quoteExtraCents(extras))}`, amount.enough ? "Масло в наличии." : "Масло — под заказ, требуется уточнить срок."];
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
