import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import { requireBranchContext } from "@/lib/branch-context";
import { canManageBranchIntegrationSecrets } from "@/lib/integration-access";
import { canEditAvito, canViewAvito } from "@/lib/avito-autoload/access";
import AvitoWorkspace from "./AvitoWorkspace";

export const metadata = { title: "Авито | Склад" };

export default async function AvitoPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAuthenticatedSession("/warehouse/avito");
  const context = await requireBranchContext({ allowAll: false, requireActive: true });
  if (!canViewAvito(context)) redirect("/");
  const { tab } = await searchParams;
  return <main className="eco-page eco-page--wide"><AvitoWorkspace key={context.branchId} initialTab={tab === "settings" || tab === "history" ? tab : "products"} branchName={context.branch!.shortName || context.branch!.name} canEdit={canEditAvito(context)} canEditSecrets={canManageBranchIntegrationSecrets(context)} /></main>;
}
