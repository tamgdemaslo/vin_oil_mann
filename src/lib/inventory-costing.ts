export type InventoryCostSource =
  | "balance_average"
  | "posted_snapshot"
  | "one_off_purchase_snapshot"
  | "receipt_price"
  | "service"
  | "missing";

export type InventoryCostStatus = "confirmed" | "missing";

export type InventoryCostResolution = {
  unitCostCents: number | null;
  source: InventoryCostSource;
  status: InventoryCostStatus;
};

const QUANTITY_EPSILON = 0.0001;

export function isServiceCostType(assortmentType: string | null | undefined): boolean {
  return (assortmentType ?? "").trim().toLowerCase() === "service";
}

export function isNonstockProductCostType(assortmentType: string | null | undefined): boolean {
  return (assortmentType ?? "").trim().toLowerCase() === "nonstock_product";
}

export function roundMoneyCents(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Денежное значение должно быть конечным числом");
  return Math.round(value);
}

export function lineCostCents(quantity: number, unitCostCents: number | null): number | null {
  return unitCostCents == null ? null : roundMoneyCents(quantity * unitCostCents);
}

export function lineRevenueCents(input: {
  quantity: number;
  salePriceCents: number;
  discountPercent?: number | null;
}): number {
  const discount = input.discountPercent ?? 0;
  return roundMoneyCents(input.quantity * input.salePriceCents * (1 - discount / 100));
}

export function resolvePostedCost(input: {
  assortmentType: string | null | undefined;
  snapshotCents: number | null | undefined;
}): InventoryCostResolution {
  if (isServiceCostType(input.assortmentType)) {
    return { unitCostCents: 0, source: "service", status: "confirmed" };
  }
  if (isNonstockProductCostType(input.assortmentType) && input.snapshotCents != null && input.snapshotCents >= 0) {
    return { unitCostCents: input.snapshotCents, source: "one_off_purchase_snapshot", status: "confirmed" };
  }
  if (input.snapshotCents != null && input.snapshotCents > 0) {
    return { unitCostCents: input.snapshotCents, source: "posted_snapshot", status: "confirmed" };
  }
  return { unitCostCents: null, source: "missing", status: "missing" };
}

export function resolveBalanceCost(input: {
  assortmentType: string | null | undefined;
  averageCostCents: number | null | undefined;
}): InventoryCostResolution {
  if (isServiceCostType(input.assortmentType)) {
    return { unitCostCents: 0, source: "service", status: "confirmed" };
  }
  if (isNonstockProductCostType(input.assortmentType)) {
    return { unitCostCents: null, source: "missing", status: "missing" };
  }
  if (input.averageCostCents != null && input.averageCostCents > 0) {
    return { unitCostCents: input.averageCostCents, source: "balance_average", status: "confirmed" };
  }
  return { unitCostCents: null, source: "missing", status: "missing" };
}

export function requireBalanceAverageCost(input: {
  productName: string;
  storeName?: string | null;
  averageCostCents: number | null | undefined;
}): number {
  if (input.averageCostCents != null && input.averageCostCents > 0) return input.averageCostCents;
  const store = input.storeName?.trim() ? ` на складе «${input.storeName.trim()}»` : "";
  throw new Error(
    `Не задана подтверждённая средняя себестоимость товара «${input.productName}»${store}. ` +
      "Восстановите opening cost; цена карточки товара не используется как себестоимость."
  );
}

export function calculateWeightedAverageCostCents(input: {
  oldQuantity: number;
  oldAverageCostCents: number | null | undefined;
  receivedQuantity: number;
  receiptUnitCostCents: number;
  productName?: string;
}): number {
  const { oldQuantity, oldAverageCostCents, receivedQuantity, receiptUnitCostCents } = input;
  if (!Number.isFinite(receivedQuantity) || receivedQuantity <= QUANTITY_EPSILON) {
    throw new Error("Количество прихода должно быть больше нуля");
  }
  if (!Number.isInteger(receiptUnitCostCents) || receiptUnitCostCents <= 0) {
    throw new Error("Цена прихода должна быть положительным числом копеек");
  }
  if (oldQuantity <= QUANTITY_EPSILON) return receiptUnitCostCents;
  if (oldAverageCostCents == null || oldAverageCostCents <= 0) {
    const product = input.productName?.trim() ? ` товара «${input.productName.trim()}»` : "";
    throw new Error(
      `Нельзя рассчитать среднюю себестоимость${product}: положительный старый остаток не имеет opening cost.`
    );
  }
  const nextQuantity = oldQuantity + receivedQuantity;
  return roundMoneyCents(
    (oldQuantity * oldAverageCostCents + receivedQuantity * receiptUnitCostCents) / nextQuantity
  );
}

export function calculateAverageAfterValuedRemoval(input: {
  oldQuantity: number;
  oldAverageCostCents: number | null | undefined;
  removedQuantity: number;
  removedUnitCostCents: number;
}): number | null {
  const { oldQuantity, oldAverageCostCents, removedQuantity, removedUnitCostCents } = input;
  if (oldAverageCostCents == null || oldAverageCostCents <= 0) return null;
  const nextQuantity = oldQuantity - removedQuantity;
  if (nextQuantity <= QUANTITY_EPSILON) return oldAverageCostCents;
  const remainingValue = oldQuantity * oldAverageCostCents - removedQuantity * removedUnitCostCents;
  if (remainingValue <= 0) return null;
  return roundMoneyCents(remainingValue / nextQuantity);
}

export function calculateLineFinancials(input: {
  quantity: number;
  salePriceCents: number;
  discountPercent?: number | null;
  assortmentType: string | null | undefined;
  snapshotCents: number | null | undefined;
}): {
  revenueCents: number;
  costCents: number | null;
  profitCents: number | null;
  grossProfitCents: number | null;
  marginPercent: number | null;
  costPerUnitCents: number | null;
  costSource: InventoryCostSource;
  costStatus: InventoryCostStatus;
  cost: InventoryCostResolution;
} {
  const revenueCents = lineRevenueCents(input);
  const cost = resolvePostedCost(input);
  const costCents = lineCostCents(input.quantity, cost.unitCostCents);
  const profitCents = costCents == null ? null : revenueCents - costCents;
  return {
    revenueCents,
    costCents,
    profitCents,
    grossProfitCents: profitCents,
    marginPercent: profitCents == null || revenueCents <= 0 ? null : (profitCents / revenueCents) * 100,
    costPerUnitCents: cost.unitCostCents,
    costSource: cost.source,
    costStatus: cost.status,
    cost,
  };
}
