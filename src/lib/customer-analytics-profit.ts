/**
 * Чистая математика прибыли по строкам документа (без Prisma / тяжёлых зависимостей).
 * Нужна отдельным модулем, чтобы синхронизация МС не тянула весь customer-analytics.
 */

export type ComputedPositionForProfit = {
  priceCentsPerUnit: number;
  quantity: number;
  discount: number;
  buyPriceCentsPerUnit: number | null;
};

export function documentProfitFromComputedPositions(positions: ComputedPositionForProfit[]): number {
  let profit = 0;
  for (const p of positions) {
    const qty = p.quantity || 0;
    const disc = p.discount || 0;
    const factor = (100 - disc) / 100;
    const revenueCents = Math.round(p.priceCentsPerUnit * qty * factor);
    const buy = p.buyPriceCentsPerUnit;
    const costCents = buy != null ? Math.round(buy * qty) : 0;
    profit += revenueCents - costCents;
  }
  return profit;
}
