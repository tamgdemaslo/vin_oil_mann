import EmployeesNav from "./EmployeesNav";
import { requireAuthenticatedSession } from "@/lib/app-access";
import { getBranchContext } from "@/lib/branch-context";
export default async function EmployeesLayout({ children }: { children: React.ReactNode }) {
  await requireAuthenticatedSession("/employees");
  const context = await getBranchContext({ requireActive: false });
  return <><EmployeesNav canManage={Boolean(context?.canManageBranches)} />{children}</>;
}
