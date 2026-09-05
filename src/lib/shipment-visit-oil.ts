import { isLikelyMotorOilProductName } from "@/lib/job-order-poster-oil-note";

export const SHIPMENT_OIL_CATALOG_SOURCE = "catalog-oil-position";
export const SHIPMENT_OIL_SELECTED_SOURCE = "catalog-oil-selected";
export const SHIPMENT_OIL_CUSTOMER_SOURCE = "customer-supplied";
export const SHIPMENT_ACTUAL_VOLUME_SOURCE = "catalog-liter-quantity";

export type ShipmentVisitOilPosition = {
  name: string;
  quantity: number;
  assortmentType?: string | null;
  assortmentHref?: string | null;
  lineKind?: string | null;
  uomName?: string | null;
  groupPath?: string | null;
};

export type ShipmentVisitOilCandidate = {
  key: string;
  name: string;
  quantity: number;
  uomName: string;
};

export type ShipmentVisitOilSuggestion = {
  candidates: ShipmentVisitOilCandidate[];
  suggestedOilName: string | null;
  suggestedActualVolumeLiters: number | null;
  state: "none" | "single" | "multiple";
};

const MOTOR_OIL_GROUP = /моторн\w*\s+масл|масл\w*\s+моторн|engine\s+oil/iu;
const LITER_UNIT = /^(?:л|л\.|литр|литра|литров|l|liter|litre)$/iu;

function isLocalCatalogProduct(position: ShipmentVisitOilPosition): boolean {
  if (position.lineKind) return false;
  if (position.assortmentType === "service") return false;
  const href = position.assortmentHref?.trim() ?? "";
  return position.assortmentType === "product"
    && (/^local:\/\/product\//iu.test(href) || /\/entity\/product\//iu.test(href));
}

function isMotorOil(position: ShipmentVisitOilPosition): boolean {
  const combined = [position.name, position.groupPath].filter(Boolean).join(" ");
  return MOTOR_OIL_GROUP.test(position.groupPath ?? "") || isLikelyMotorOilProductName(combined);
}

export function isLiterSaleUnit(value: string | null | undefined): boolean {
  return LITER_UNIT.test(String(value ?? "").trim());
}

export function deriveShipmentVisitOilSuggestion(
  positions: ShipmentVisitOilPosition[],
): ShipmentVisitOilSuggestion {
  const candidates = positions
    .filter((position) => isLocalCatalogProduct(position) && isMotorOil(position))
    .map((position, index) => ({
      key: position.assortmentHref?.trim() || `${position.name}-${index}`,
      name: position.name.trim(),
      quantity: Number(position.quantity) || 0,
      uomName: String(position.uomName ?? "").trim(),
    }));

  if (candidates.length === 0) {
    return { candidates, suggestedOilName: null, suggestedActualVolumeLiters: null, state: "none" };
  }
  if (candidates.length > 1) {
    return { candidates, suggestedOilName: null, suggestedActualVolumeLiters: null, state: "multiple" };
  }

  const candidate = candidates[0]!;
  const suggestedActualVolumeLiters = isLiterSaleUnit(candidate.uomName) && candidate.quantity > 0
    ? candidate.quantity
    : null;
  return {
    candidates,
    suggestedOilName: candidate.name,
    suggestedActualVolumeLiters,
    state: "single",
  };
}
