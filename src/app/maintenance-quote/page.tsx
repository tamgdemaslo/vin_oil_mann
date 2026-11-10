import { redirect } from "next/navigation";
import { getBranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { MaintenanceQuoteWorkspace } from "./MaintenanceQuoteWorkspace";

export default async function MaintenanceQuotePage() {
  const context = await getBranchContext({ allowAll: true, requireActive: false });
  if (!context) redirect("/login");

  const stores = context.branchId
    ? await prisma.localStore.findMany({
        where: { branchId: context.branchId, archived: false },
        orderBy: [{ isMain: "desc" }, { name: "asc" }],
        select: { id: true, name: true, organizationId: true },
      })
    : [];

  return <MaintenanceQuoteWorkspace
    key={context.branchId ?? "all"}
    branchName={context.branch?.displayName || context.branch?.shortName || context.branch?.name}
    organizationId={context.organizationId}
    stores={stores}
  />;
}
