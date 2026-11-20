import type { QuoteExtra } from "@/lib/maintenance-quote";
import type { MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import { mannQuoteServiceCapacities } from "@/lib/mann-quote-service-capacities";
import { isFluidPackageSaleUnit } from "@/lib/maintenance-fluid-offer-amount";
import { isLiterSaleUnit } from "@/lib/product-marking";

/** Profile/warehouse changes invalidate fluid lines, including persisted drafts. */
export function quoteFluidLineCurrent(row: QuoteExtra, profile: MannUnifiedTechnicalProfile | null, warehouseId?: string | null): boolean {
  const fluid = row.fluid;
  if (!fluid || !warehouseId || row.stockStoreId !== warehouseId || fluid.systemCode === "ENGINE_OIL") return false;
  if (fluid.approvalStatus !== "official_approval" && !fluid.manualCompatibilityConfirmed) return false;
  if (fluid.source === "rossko" && (!fluid.localProductId || !fluid.supplierOfferId
    || !fluid.supplierOfferId.startsWith("rossko:") || row.supplierProductId !== fluid.supplierOfferId || !fluid.packageEvidence?.trim()
    || isLiterSaleUnit(fluid.unit))) return false;
  if (!isLiterSaleUnit(fluid.unit) && (!isFluidPackageSaleUnit(fluid.unit) || !Number.isSafeInteger(row.quantity))) return false;
  const multiple = fluid.quantityMultiple ?? 1;
  if (!Number.isSafeInteger(multiple) || multiple < 1 || (multiple > 1 && row.quantity % multiple !== 0)) return false;
  if (![fluid.serviceLitres, fluid.suppliedLitres, fluid.litresPerUnit, row.quantity, row.price].every(value => Number.isFinite(value) && value > 0)) return false;
  if (fluid.suppliedLitres < fluid.serviceLitres || Math.abs(row.quantity * fluid.litresPerUnit - fluid.suppliedLitres) > 0.001) return false;
  return Boolean(profile?.items.some(item => item.systemCode === fluid.systemCode
    && item.revisionId === fluid.profileRevisionId && (item.componentModel ?? "") === (fluid.componentModel ?? "")
    && item.sourceStatus === "primary_source" && !item.requiresReview && !item.researchResult && item.automaticSelectionEligible
    && item.specifications.length > 0 && item.specifications.join("; ") === fluid.specification
    && (item.viscosityGrades.length ? Boolean(fluid.viscosity && item.viscosityGrades.includes(fluid.viscosity)) : !fluid.viscosity)
    && mannQuoteServiceCapacities({ ...profile, items: [item] }, fluid.systemCode).some(method =>
      method.label === fluid.serviceMethodLabel && Math.abs(method.litres - fluid.serviceLitres) < 0.0001)));
}
