import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import AIAssistantClient from "./AIAssistantClient";

export default async function AIAssistantPage() {
  const session = await requireAuthenticatedSession("/ai-assistant");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");
  return <AIAssistantClient />;
}
