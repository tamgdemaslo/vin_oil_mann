import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import ClientNotificationsClient from "./ClientNotificationsClient";

export default async function ClientNotificationsPage() {
  const session = await requireAuthenticatedSession("/cabinet/notifications");
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    redirect("/cabinet");
  }

  return <ClientNotificationsClient />;
}
