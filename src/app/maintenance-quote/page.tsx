import { redirect } from "next/navigation";
import { getBranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { MaintenanceQuoteWorkspace } from "./MaintenanceQuoteWorkspace";

export default async function MaintenanceQuotePage() {
  const context = await getBranchContext({ allowAll: true, requireActive: false });
  if (!context) redirect("/login");

  const [stores, services] = context.branchId
    ? await Promise.all([prisma.localStore.findMany({
        where: { branchId: context.branchId, archived: false },
        orderBy: [{ isMain: "desc" }, { name: "asc" }],
        select: { id: true, name: true, organizationId: true },
      }), prisma.localProduct.findMany({
        where: { branchId: context.branchId, entityType: "service", archived: false },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, salePriceCents: true },
      })])
    : [[], []];

  return <MaintenanceQuoteWorkspace
    key={context.branchId ?? "all"}
    branchName={context.branch?.displayName || context.branch?.shortName || context.branch?.name}
    organizationId={context.organizationId}
    stores={stores}
    services={services}
    timeZone={context.branch?.timezone}
  />;
}
