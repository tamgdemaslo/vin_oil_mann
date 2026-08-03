import { NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext, type BranchContext } from "@/lib/branch-context";
import { runWithRequestTenant, type RequestTenant } from "@/lib/request-tenant-store";

function requestTenantFromBranchContext(context: BranchContext): RequestTenant {
  const allowedBranchIds = context.mode === "all"
    ? context.branches.map((branch) => branch.id)
    : context.branchId
      ? [context.branchId]
      : [];

  return {
    mode: context.mode,
    branchId: context.branchId,
    organizationId: context.organizationId,
    allowedBranchIds,
    businessGroupId: context.businessGroupId,
    userId: context.userId,
    permissions: [context.groupRole, context.branchRole].filter((role): role is string => Boolean(role)),
  };
}

export function runWithBranchApiContext<T>(context: BranchContext, operation: () => T): T {
  return runWithRequestTenant(requestTenantFromBranchContext(context), operation);
}

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
