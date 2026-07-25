import { redirect } from "next/navigation";

/** Legacy address of the removed customer-facing agent settings. */
export default function LegacyAIAgentSettingsPage() {
  redirect("/cabinet/ai-assistant");
}
