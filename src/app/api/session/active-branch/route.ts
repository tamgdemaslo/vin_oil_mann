import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  activeBranchCookieOptions,
  branchErrorResponse,
  getBranchContext,
  selectActiveBranch,
} from "@/lib/branch-context";

export async function GET() {
  try {
    const context = await getBranchContext({ allowAll: true, requireActive: false });
    if (!context) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
    return NextResponse.json({
      mode: context.mode,
      activeBranchId: context.branchId ?? "all",
      activeBranch: context.branch,
      branches: context.branches,
      groupRole: context.groupRole,
      branchRole: context.branchRole,
      canManageBranches: context.canManageBranches,
      permissions: context.permissions,
      canViewBranches: context.canViewBranches,
      canViewAllBranches: context.canViewAllBranches,
      canCreateBranches: context.canCreateBranches,
      canUpdateBranches: context.canUpdateBranches,
      canArchiveBranches: context.canArchiveBranches,
      canManageBranchMembers: context.canManageBranchMembers,
      canManageIntegrations: context.canManageIntegrations,
    });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  try {
    const body = (await request.json()) as { branchId?: unknown };
    const branchId = typeof body.branchId === "string" ? body.branchId : "";
    const selected = await selectActiveBranch(branchId, session.user);
    const options = activeBranchCookieOptions();
    const response = NextResponse.json({
      ok: true,
      activeBranchId: selected.branchId,
      activeBranch: selected.branch,
    });
    response.cookies.set(options.name, selected.token, options);
    return response;
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}
