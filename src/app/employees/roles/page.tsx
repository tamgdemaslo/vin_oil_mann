import { redirect } from "next/navigation";
import { requireBranchContext } from "@/lib/branch-context";
import EmployeeRoles from "./EmployeeRoles";
export default async function EmployeeRolesPage() {
  const context = await requireBranchContext({ requireActive: false });
  if (!context.canManageBranches) redirect("/employees/salary?view=mine");
  return <EmployeeRoles branchId={context.branchId!} canDismiss={context.user.role === "owner"} ownLogin={context.user.login} />;
}
