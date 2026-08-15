import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { listTemplates } from "@/lib/messenger/messenger-gateway";

export async function GET() {
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;
  return runWithBranchApiContext(branchAccess.context, async () =>
    NextResponse.json({ templates: await listTemplates() })
  );
}
