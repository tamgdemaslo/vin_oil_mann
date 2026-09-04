import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { listProductImportJobs } from "@/lib/product-import-export";

function canManageProducts(role: string) {
  return role === "owner" || role === "admin";
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!canManageProducts(session.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20));
  const jobs = await runWithBranchApiContext(branchAccess.context, () => listProductImportJobs(limit));
  return NextResponse.json({ jobs });
}
