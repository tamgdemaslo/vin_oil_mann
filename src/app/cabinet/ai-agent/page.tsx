import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import AIAgentSettingsClient from "./AIAgentSettingsClient";

export default async function AIAgentSettingsPage() {
  const session = await requireAuthenticatedSession("/cabinet/ai-agent");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/cabinet");
  return <AIAgentSettingsClient />;
}
