import { redirect } from "next/navigation";

/** Historical client-agent analytics stays in the database, but its former UI
 * is not exposed in the CRM after the client automation was retired. */
export default function LegacyAIAgentAnalyticsPage() {
  redirect("/ai-assistant");
}
