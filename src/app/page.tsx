import HomeDashboard from "./HomeDashboard";
import { requireAuthenticatedSession } from "@/lib/app-access";
import { getBranchContext } from "@/lib/branch-context";
import { resolveDashboardAccessForBranch, resolveDashboardVariant } from "@/lib/dashboard-variant";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ needShift?: string }>;
}) {
  const session = await requireAuthenticatedSession("/");
  const sp = await searchParams;
  const fallbackDashboardAccess = resolveDashboardVariant({ userRole: session.user.role });
  const branchContext = await getBranchContext({ allowAll: false, requireActive: false }).catch(() => null);
  const dashboardAccess = branchContext
    ? await resolveDashboardAccessForBranch(branchContext)
    : fallbackDashboardAccess;

  return (
    <HomeDashboard
      role={session.user.role}
      userName={session.user.name ?? session.user.login}
      dashboardVariant={dashboardAccess.variant}
      needShiftNotice={sp.needShift === "1"}
    />
  );
}
