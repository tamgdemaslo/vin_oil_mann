import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { createTBankDraft } from "@/lib/tbank";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { id } = await params;
  return runWithBranchApiContext(access.context, async () => {
    const result = await createTBankDraft(id, body as Parameters<typeof createTBankDraft>[1], access.context.user);
    if (!result.ok) return NextResponse.json({ error: result.errors?.[0] ?? "Не удалось создать черновик T-Bank", ...result }, { status: result.status });
    return NextResponse.json(result);
  });
}
