import { parseAssistantRosskoOffers, sameSupplierArticle } from "@/lib/ai-assistant/supplier-offers";
import type { AIRosskoMarkupRule } from "@/lib/ai-agent/types";
import type { QuoteFilterGroup } from "@/lib/maintenance-quote";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => value == null ? [] : Array.isArray(value) ? value : [value];
function deliveryWindows(raw: unknown) {
  const windows = new Map<string, {start: Date; end: Date | null}>();
  for (const value of array(record(record(raw).PartsList).Part)) {
    const part = record(value);
    for (const value of array(record(part.stocks).stock)) {
      const stock = record(value);
      const start = typeof stock.deliveryStart === "string" ? new Date(stock.deliveryStart) : null;
      const end = typeof stock.deliveryEnd === "string" ? new Date(stock.deliveryEnd) : null;
      if (start && Number.isFinite(start.getTime())) windows.set(`${part.guid}|${stock.id}`, {start, end: end && Number.isFinite(end.getTime()) && end >= start ? end : null});
    }
  }
  return windows;
}

/** Only the requested MANN part and its direct ROSSKO cross-references.
 * Other search results and cross-references of cross-references are excluded.
 */
export function quoteRosskoFilters(raw: unknown, article: string, branchId: string, rules: AIRosskoMarkupRule[], timeZone = "Europe/Kaliningrad"): QuoteFilterGroup["products"] {
  const list = record(record(raw).PartsList);
  if (!Object.hasOwn(list, "Part")) throw new Error("ROSSKO_PARSING_ERROR");
  const references = array(list.Part).map(record).filter(part => /^MANN(?:[\s-]*FILTER)?$/i.test(String(part.brand ?? "")) && sameSupplierArticle(article, part.partnumber));
  const parts = references.flatMap(part => [
    {part, relation: "mann" as const},
    ...array(record(part.crosses).Part).map(record).map(cross => ({part:cross, relation:"analogue" as const})),
  ]);
  const windows = deliveryWindows({PartsList:{Part:parts.map(item => item.part)}});
  const seen = new Set<string>();
  const date = new Intl.DateTimeFormat("ru-RU", {timeZone, day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"});
  return parts.flatMap(({part, relation}) => parseAssistantRosskoOffers({PartsList:{Part:part}}, branchId).flatMap(offer => {
    if (!offer.id || seen.has(offer.id) || !(offer.availableQuantity! >= 1) || !(offer.purchasePriceCents! > 0) || (offer.quantityMultiple != null && offer.quantityMultiple > 1)) return [];
    const cents = offer.purchasePriceCents!;
    const rule = rules.find(item => cents >= item.fromCents && (item.toCents == null || cents < item.toCents)) ?? rules.at(-1);
    if (!rule) return [];
    const price = Math.round(cents * (1 + rule.marginPercent / 100)) / 100;
    if (!Number.isFinite(price) || price <= 0) return [];
    const days = offer.deliveryDays;
    const window = windows.get(`${offer.partId}|${offer.stockId}`);
    const deliveryLabel = window ? `доставка: ${date.format(window.start)}${window.end ? ` — ${date.format(window.end)}` : ""}` : days === 0 ? "в наличии у поставщика · срок 0 дн." : days != null && days > 0 ? `доставка: ${days} дн.` : "срок доставки не указан";
    seen.add(offer.id);
    return [{brand:offer.brand, relation, referenceArticle:article, deliveryAt:window?.start.toISOString() ?? null, deliveryDays:days, id: `rossko:${offer.id}`, name: `${offer.brand} ${offer.article}`, article: offer.article, price, available: offer.availableQuantity!, orderable: true, source: "rossko" as const, deliveryLabel}];
  }));
}
