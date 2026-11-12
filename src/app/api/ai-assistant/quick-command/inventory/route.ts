import { NextRequest, NextResponse } from "next/server";
import { requireAIAssistantAccess, runWithAIAssistantBranchContext } from "@/lib/ai-assistant/access";
import { confirmQuickInventory } from "@/lib/ai-assistant/quick-inventory-actions";

export async function POST(request: NextRequest) {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null);
  if (request.headers.get("x-eco-assistant-branch") !== access.branchId || body?.confirm !== true || typeof body.token !== "string") {
    return NextResponse.json({ error: "Подтвердите черновик в текущем филиале." }, { status: 400 });
  }
  try {
    const result = await runWithAIAssistantBranchContext(access, () => confirmQuickInventory(access, body.token));
    return NextResponse.json(result, { status: "error" in result ? 409 : 200 });
  } catch {
    return NextResponse.json({ error: "Сохранение не подтверждено. Повторите подтверждение того же черновика." }, { status: 502 });
  }
}
