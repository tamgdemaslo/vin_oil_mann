import { NextResponse } from "next/server";
import { requireAIAssistantAccess } from "@/lib/ai-assistant/access";
import { adminAssistantConfig } from "@/lib/ai-assistant/config";

export async function GET() {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  const config = adminAssistantConfig();
  return NextResponse.json({ configured: config.enabled, model: config.model, reasoning: config.reasoning, deepReasoning: config.deepReasoning, readOnly: true, actor: { name: access.session.user.name, role: access.session.user.role } });
}
