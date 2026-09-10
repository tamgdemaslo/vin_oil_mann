import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { assistantMemo } from "./execution";

export async function assistantTariffContext(organizationId: string) {
  const branchId = getScopedBranchId();
  return assistantMemo("tariff-context", { organizationId, branchId }, async () => {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, status: "active" }, select: { id: true, slug: true, legacyOrganizationId: true } });
    if (!branch || (branch.legacyOrganizationId ?? branch.id) !== organizationId) throw new Error("BRANCH_ORGANIZATION_MISMATCH");
    const now = new Date();
    const rules = await prisma.aIAssistantLaborPricingRule.findMany({ where: { branchId, organizationId, active: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }, select: { locationId: true }, distinct: ["locationId"] });
    const locations = rules.map(row => row.locationId).filter(Boolean);
    // With no overrides, the server-owned branch slug still identifies the
    // location for system policy and branch-scoped service-card fallbacks.
    const locationId = locations.includes(branch.slug) || locations.length === 0 ? branch.slug : locations.length === 1 ? locations[0] : null;
    return { branchId, organizationId, locationId, basis: locationId === branch.slug ? "branch_slug" : locationId ? "unique_active_branch_tariff_location" : "location_unresolved" };
  });
}
