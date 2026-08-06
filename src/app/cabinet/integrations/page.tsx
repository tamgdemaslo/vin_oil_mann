import { redirect } from "next/navigation";
import IntegrationsClient from "./IntegrationsClient";
import { requireBranchContext } from "@/lib/branch-context";
import { canManageBranchIntegrationSecrets, canViewBranchIntegrationSettings } from "@/lib/integration-access";
import { prisma } from "@/lib/db";

export default async function CabinetIntegrationsPage() {
  const branch = await requireBranchContext({ allowAll: false, requireActive: false });
  if (!canViewBranchIntegrationSettings(branch)) redirect("/cabinet");
  const [organizationConfigured, employeeCount] = await Promise.all([
    branch.organizationId ? prisma.localOrganization.count({ where: { id: branch.organizationId, isActive: true } }).then(Boolean) : false,
    prisma.branchMembership.count({ where: { branchId: branch.branchId!, status: "active" } }),
  ]);

  return <IntegrationsClient
    branchName={branch.branch?.shortName || branch.branch?.name || "Текущий филиал"}
    canEditSecrets={canManageBranchIntegrationSecrets(branch)}
    organizationConfigured={organizationConfigured}
    employeesConfigured={employeeCount > 1}
  />;
}
