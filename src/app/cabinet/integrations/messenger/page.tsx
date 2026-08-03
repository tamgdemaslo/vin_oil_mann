import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import MessengerIntegrationsClient from "./MessengerIntegrationsClient";

export default async function CabinetMessengerIntegrationsPage() {
  const session = await requireAuthenticatedSession("/cabinet/integrations/messenger");
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    redirect("/cabinet");
  }

  return <MessengerIntegrationsClient />;
}
