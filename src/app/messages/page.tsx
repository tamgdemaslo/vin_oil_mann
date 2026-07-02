import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessCrm } from "@/lib/crm-access";
import MessagesPageClient from "./MessagesPageClient";

export default async function MessagesPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login?from=/messages");
  }
  if (!canAccessCrm(session.user.role)) {
    redirect("/");
  }
  return <MessagesPageClient />;
}

