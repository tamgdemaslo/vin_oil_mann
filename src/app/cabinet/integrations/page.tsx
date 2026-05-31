import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import IntegrationsClient from "./IntegrationsClient";

export default async function CabinetIntegrationsPage() {
  const session = await requireAuthenticatedSession("/cabinet/integrations");
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    redirect("/cabinet");
  }

  return <IntegrationsClient />;
}
