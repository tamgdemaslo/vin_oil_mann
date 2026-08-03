import { requireAuthenticatedSession } from "@/lib/app-access";
import { canManageOrganizations } from "@/lib/organizations";
import { getBranchContext } from "@/lib/branch-context";
import CabinetDashboard from "./CabinetDashboard";

export default async function CabinetPage() {
  const session = await requireAuthenticatedSession("/cabinet");
  const [canManageOrganizationsSection, branchContext] = await Promise.all([
    canManageOrganizations(session.user),
    getBranchContext({ allowAll: true, requireActive: false }),
  ]);

  return (
    <CabinetDashboard
      role={session.user.role}
      canManageOrganizations={canManageOrganizationsSection}
      canViewBranches={Boolean(branchContext?.canViewBranches)}
      activeBranchId={branchContext?.branchId ?? null}
      branchMode={branchContext?.mode ?? "all"}
    />
  );
}
