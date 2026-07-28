import { NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";

export async function requireBranchApi(options: { allowAll?: boolean; requireActive?: boolean } = {}) {
  try {
    const context = await requireBranchContext(options);
    return { ok: true as const, context };
  } catch (error) {
    const result = branchErrorResponse(error);
    return {
      ok: false as const,
      response: NextResponse.json({ error: result.error, code: result.code }, { status: result.status }),
    };
  }
}

