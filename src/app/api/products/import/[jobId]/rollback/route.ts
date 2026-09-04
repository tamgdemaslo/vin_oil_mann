import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { rollbackProductImport } from "@/lib/product-import-export";

function canManageProducts(role: string) {
  return role === "owner" || role === "admin";
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!canManageProducts(session.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  try {
    const { jobId } = await params;
    const result = await runWithBranchApiContext(
      branchAccess.context,
      () => rollbackProductImport(jobId),
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
