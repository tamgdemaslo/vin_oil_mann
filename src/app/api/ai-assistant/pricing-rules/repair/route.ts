import { NextResponse } from "next/server";
import { z } from "zod";
import { aiAssistantApiError, branchAccess, branchSelectionResponse, requireAIAssistantBaseAccess, resolveAIAssistantThreadAccess } from "@/lib/ai-assistant/access";
import { applyPricingRepair, pricingRepairPreview } from "@/lib/ai-assistant/pricing-repair";

async function accessFor(request: Request) {
  const base = await requireAIAssistantBaseAccess();
  if ("response" in base) return base;
  const params = new URL(request.url).searchParams;
  const threadId = params.get("threadId");
  if (threadId) return resolveAIAssistantThreadAccess(base, threadId);
  const branchId = params.get("branchId") || (base.context.mode === "branch" ? base.context.branchId : null);
  return branchId ? branchAccess(base, branchId) : { response: branchSelectionResponse(base) };
}

export async function GET(request: Request) {
  try {
    const access = await accessFor(request);
    if ("response" in access) return access.response;
    return NextResponse.json(await pricingRepairPreview(access));
  } catch (error) { return aiAssistantApiError(error); }
}

const selection = z.object({ planId: z.string().min(1).max(200), token: z.string().regex(/^[a-f0-9]{64}$/), ruleIds: z.array(z.string().min(1).max(160)).min(1).max(1000) }).strict();

export async function POST(request: Request) {
  try {
    const access = await accessFor(request);
    if ("response" in access) return access.response;
    const body = selection.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "Выберите правила из актуального предложения." }, { status: 400 });
    return NextResponse.json(await applyPricingRepair(access, body.data));
  } catch (error) { return aiAssistantApiError(error); }
}
