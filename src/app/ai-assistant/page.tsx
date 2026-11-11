import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import { getBranchContext } from "@/lib/branch-context";
import QuickAssistant from "@/components/platform/QuickAssistant";
import AIAssistantClient from "./AIAssistantClient";

export default async function AIAssistantPage({ searchParams }: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const session = await requireAuthenticatedSession("/ai-assistant");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/");
  if ((await searchParams).mode === "research") return <AIAssistantClient />;
  const branch = await getBranchContext();
  const branchId = branch?.branchId ?? "";
  return <QuickAssistant key={branchId} branchId={branchId} login={session.user.login} fullPage />;
}
