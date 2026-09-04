import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getProductImportJob } from "@/lib/product-import-export";

function canManageProducts(role: string) {
  return role === "owner" || role === "admin";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!canManageProducts(session.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  const { jobId } = await params;
  const result = await runWithBranchApiContext(branchAccess.context, () => getProductImportJob(jobId));
  if (!result) return NextResponse.json({ error: "Импорт не найден" }, { status: 404 });
  return NextResponse.json(result);
}
