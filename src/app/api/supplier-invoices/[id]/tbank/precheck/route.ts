import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { precheckTBankDraft } from "@/lib/tbank";

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
  return runWithBranchApiContext(access.context, async () =>
    NextResponse.json(await precheckTBankDraft(id, body as Parameters<typeof precheckTBankDraft>[1], access.context.user))
  );
}
