/**
 * Чистая математика прибыли по строкам документа (без Prisma / тяжёлых зависимостей).
 * Нужна отдельным модулем, чтобы синхронизация МС не тянула весь customer-analytics.
 */

import { calculateLineFinancials } from "./inventory-costing";

export type ComputedPositionForProfit = {
  priceCentsPerUnit: number;
  quantity: number;
  discount: number;
  buyPriceCentsPerUnit: number | null;
  assortmentType: string;
};

export function documentProfitFromComputedPositions(positions: ComputedPositionForProfit[]): number | null {
  let profit = 0;
  for (const p of positions) {
    const line = calculateLineFinancials({
      quantity: p.quantity || 0,
      salePriceCents: p.priceCentsPerUnit,
      discountPercent: p.discount || 0,
      assortmentType: p.assortmentType,
      snapshotCents: p.buyPriceCentsPerUnit,
    });
    if (line.profitCents == null) return null;
    profit += line.profitCents;
  }
  return profit;
}
