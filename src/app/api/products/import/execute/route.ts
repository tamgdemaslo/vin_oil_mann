import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { executeProductImport, type ProductImportOptions } from "@/lib/product-import-export";

function canManageProducts(role: string) {
  return role === "owner" || role === "admin";
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!canManageProducts(session.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  try {
    const body = await request.json() as { jobId?: string; options?: ProductImportOptions };
    if (!body.jobId) return NextResponse.json({ error: "jobId не указан" }, { status: 400 });
    const result = await runWithBranchApiContext(
      branchAccess.context,
      () => executeProductImport(body.jobId!, body.options),
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
