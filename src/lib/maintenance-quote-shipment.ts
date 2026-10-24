import { buildRequirementsNorm } from "@/lib/oil-normalizer";
import type { QuoteFilterGroup } from "@/lib/maintenance-quote";

// Old VIN responses remain suggestions; an estimated/ranged capacity must be confirmed.
export function shipmentQuoteRequirements(info?: { approval?: string; sae?: string[]; acea?: string[]; api?: string[]; fillVolumeLiters?: string } | null) {
  const norm = buildRequirementsNorm({oem: info?.approval ?? "", acea: info?.acea?.join("; ") ?? "", api: info?.api?.join("; ") ?? "", sae: info?.sae?.join("; ") ?? ""});
  const rawVolume = info?.fillVolumeLiters?.trim() ?? "";
  const volume = /^\d+(?:[.,]\d+)?\s*(?:л|l)?$/i.test(rawVolume) ? Number(rawVolume.replace(/\s*(?:л|l)$/i, "").replace(",", ".")) : NaN;
  return {specifications: norm.oem.length ? norm.oem : [...norm.acea, ...norm.api], viscosities: norm.sae, volumes: Number.isFinite(volume) && volume > 0 && volume <= 100 ? [volume] : [], automaticVolume: ""};
}

export function shipmentQuoteFilters(items: {name: string; article?: string; lookupKind?: string; productId?: string; price: number; quantity: number; store: string}[], storeName?: string): QuoteFilterGroup[] {
  const groups = new Map<string, QuoteFilterGroup>();
  const labels: Record<string, string> = {"oil-filter": "Масляный фильтр", "air-filter": "Воздушный фильтр", "cabin-filter": "Салонный фильтр", "fuel-filter": "Топливный фильтр"};
  for (const item of items) {
    // OEM numbers and other brands must never become a MANN reference for ROSSKO.
    if (!item.lookupKind || !labels[item.lookupKind] || !item.article || !/\bMANN(?:-FILTER)?\b/i.test(item.name)) continue;
    const article = item.article.trim();
    const key = `${item.lookupKind}:${article.replace(/[^a-z0-9]/gi, "").toUpperCase()}`;
    const group = groups.get(key) ?? {key, label: labels[item.lookupKind], article, products: []};
    if (storeName && item.store === storeName && item.productId && item.price > 0 && !group.products.some(product => product.id === item.productId)) {
      group.products.push({id: item.productId, name: item.name, article, price: item.price, available: item.quantity, orderable: item.quantity > 0});
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}
