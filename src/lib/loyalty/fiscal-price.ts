import type { AqsiPendingOrderItem } from "@/lib/aqsi";

/** AQSI Orders accepts unit prices. Put remainder kopecks on separate units when possible. */
export function priceAqsiLoyaltyLine(items: AqsiPendingOrderItem[], cashCents: number): AqsiPendingOrderItem[] {
  const [first] = items;
  if (!first || !Number.isSafeInteger(cashCents) || cashCents < 0) throw new Error("Неверная денежная сумма строки AQSI");
  const price = (item: AqsiPendingOrderItem, cents: number, quantity = item.quantity) => ({
    ...item, quantity, discountPercent: 0, exactUnitPrice: cents / 100, unitPrice: cents / 100,
  });
  if (items.length > 1) {
    const base = Math.floor(cashCents / items.length);
    return items.map((item, index) => price(item, base + Number(index < cashCents % items.length)));
  }
  if (Number.isInteger(first.quantity) && first.quantity > 0 && !first.measuredPour && !first.markingCode) {
    const base = Math.floor(cashCents / first.quantity);
    const remainder = cashCents % first.quantity;
    return [
      ...(first.quantity > remainder ? [price(first, base, first.quantity - remainder)] : []),
      ...(remainder > 0 ? [price(first, base + 1, remainder)] : []),
    ];
  }
  const effectiveCents = Number((cashCents / first.quantity).toFixed(6));
  if (!Number.isFinite(effectiveCents) || Math.round(effectiveCents * first.quantity) !== cashCents) {
    throw new Error("Цена за единицу AQSI не воспроизводит сумму строки до копейки");
  }
  return [price(first, effectiveCents)];
}
