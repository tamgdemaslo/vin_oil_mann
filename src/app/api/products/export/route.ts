import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { buildProductExportWorkbook } from "@/lib/product-import-export";

function canManageProducts(role: string) {
  return role === "owner" || role === "admin";
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!canManageProducts(session.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  const buffer = await runWithBranchApiContext(
    branchAccess.context,
    () => buildProductExportWorkbook(request.nextUrl.searchParams),
  );
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="products-export-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
