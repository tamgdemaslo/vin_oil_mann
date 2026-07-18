import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import AIAgentAnalyticsClient from "./AIAgentAnalyticsClient";

export default async function AIAgentAnalyticsPage() {
  const session = await requireAuthenticatedSession("/crm/ai-agent");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/crm");
  return <AIAgentAnalyticsClient />;
}
