import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageOrganizations, canViewOrganizations } from "@/lib/organizations";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import { getBranchContext } from "@/lib/branch-context";
import { resolveNavigationForUser } from "@/lib/navigation-policy.mjs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  const branchContext = await getBranchContext({ allowAll: true, requireActive: false });
  const [canManageOrganizationsSection, canViewOrganizationsSection, canViewWarehouseAnalyticsSection] = await Promise.all([
    branchContext?.canManageBranches ?? canManageOrganizations(session.user),
    canViewOrganizations(session.user),
    canViewWarehouseAnalytics(session.user),
  ]);
  const navigationPermissions = new Set(branchContext?.permissions ?? []);
  if (canManageOrganizationsSection) navigationPermissions.add("organizations.manage");
  if (canViewOrganizationsSection) navigationPermissions.add("organizations.view");
  if (canViewWarehouseAnalyticsSection) navigationPermissions.add("warehouse.analytics.view");
  const navigation = resolveNavigationForUser({
    user: session.user,
    businessGroupMembership: branchContext?.groupRole ? { role: branchContext.groupRole } : null,
    branchMemberships: branchContext?.branchId
      ? [{ branchId: branchContext.branchId, roleId: branchContext.branchRole, permissions: branchContext.permissions }]
      : [],
    permissions: [...navigationPermissions],
    activeBranchMode: branchContext?.mode ?? "branch",
    activeBranchId: branchContext?.branchId ?? null,
  });
  return NextResponse.json({
    user: session.user,
    navigation,
    branchContext: branchContext
      ? {
          mode: branchContext.mode,
          activeBranchId: branchContext.branchId ?? "all",
          activeBranch: branchContext.branch,
          branches: branchContext.branches,
          groupRole: branchContext.groupRole,
          branchRole: branchContext.branchRole,
          permissions: branchContext.permissions,
          canManageBranches: branchContext.canManageBranches,
        }
      : null,
    permissions: {
      canManageOrganizations: canManageOrganizationsSection,
      canViewOrganizations: canViewOrganizationsSection,
      canViewWarehouseAnalytics: canViewWarehouseAnalyticsSection,
    },
  });
}
