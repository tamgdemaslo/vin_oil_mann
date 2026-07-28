import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageOrganizations } from "@/lib/organizations";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import { getBranchContext } from "@/lib/branch-context";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  const branchContext = await getBranchContext({ allowAll: true, requireActive: false });
  return NextResponse.json({
    user: session.user,
    branchContext: branchContext
      ? {
          mode: branchContext.mode,
          activeBranchId: branchContext.branchId ?? "all",
          activeBranch: branchContext.branch,
          branches: branchContext.branches,
          groupRole: branchContext.groupRole,
          branchRole: branchContext.branchRole,
          canManageBranches: branchContext.canManageBranches,
        }
      : null,
    permissions: {
      canManageOrganizations: branchContext?.canManageBranches ?? await canManageOrganizations(session.user),
      canViewWarehouseAnalytics: await canViewWarehouseAnalytics(session.user),
    },
  });
}
