import { redirect } from "next/navigation";
import { requireBranchContext } from "@/lib/branch-context";
import { runWithBranchApiContext } from "@/lib/branch-api";
import { getStorefrontConfiguration } from "@/lib/storefront-configuration";
import StorefrontSettingsClient from "./StorefrontSettingsClient";

export const dynamic = "force-dynamic";

export default async function StorefrontSettingsPage() {
  const context = await requireBranchContext({ allowAll: true, requireActive: false });
  if (!context.groupRole || context.mode !== "all") redirect("/");
  const initial = await runWithBranchApiContext(context, () => getStorefrontConfiguration(context));
  return <StorefrontSettingsClient initial={initial} />;
}
