import NotificationsPageClient from "./NotificationsPageClient";
import { requireAuthenticatedSession } from "@/lib/app-access";

export default async function NotificationsPage() {
  await requireAuthenticatedSession("/notifications");
  return <NotificationsPageClient />;
}
