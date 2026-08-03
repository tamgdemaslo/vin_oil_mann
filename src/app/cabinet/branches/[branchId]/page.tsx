import { redirect } from "next/navigation";
import { getBranchContext } from "@/lib/branch-context";
import BranchSettingsClient from "./BranchSettingsClient";

export default async function BranchSettingsPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;
  const context = await getBranchContext({ allowAll: true, requireActive: false });
  if (!context?.canViewBranches || !context.branches.some((branch) => branch.id === branchId)) redirect("/cabinet/branches");
  return <BranchSettingsClient branchId={branchId} />;
}
