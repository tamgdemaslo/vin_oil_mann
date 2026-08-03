import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessCrm } from "@/lib/crm-access";
import MessagesPageClient from "./MessagesPageClient";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login?from=/messages");
  }
  if (!canAccessCrm(session.user.role)) {
    redirect("/");
  }
  const query = await searchParams;
  const conversationId = Array.isArray(query.conversationId) ? query.conversationId[0] : query.conversationId;
  return <MessagesPageClient initialConversationId={conversationId ?? null} />;
}
