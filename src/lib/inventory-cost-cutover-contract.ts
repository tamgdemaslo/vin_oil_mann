export const INVENTORY_COST_CUTOVER_ID = "inventory-cost-cutover-2026-09-04";
export const INVENTORY_COST_CUTOVER_CONFIRMATION = "APPLY_INVENTORY_COST_CUTOVER_2026_09_04";
export const INVENTORY_COST_CUTOVER_BACKUP = "Timeweb physical backup 2026-09-04 16:40";

export type InventoryCostCutoverStatus =
  | "RECONSTRUCTABLE"
  | "OPENING_COST_REQUIRED"
  | "AMBIGUOUS_HISTORY"
  | "MISSING_COST";

export type InventoryCostCutoverCandidate = {
  balanceId: string;
  branchId: string;
  branchName: string;
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  currentQuantity: number;
  replayQuantity: number;
  currentAverageCostCents: number | null;
  lastPurchasePriceCents: number | null;
  suggestedAverageCostCents: number | null;
  status: InventoryCostCutoverStatus;
  reason: string | null;
  events: number;
};

export type InventoryCostCutoverPlan = {
  cutoverId: string;
  mode: "dry-run";
  writes: false;
  calculatedAt: string;
  planHash: string;
  summary: {
    total: number;
    reconstructable: number;
    openingCostRequired: number;
    ambiguousHistory: number;
    missingCost: number;
  };
  candidates: InventoryCostCutoverCandidate[];
};
