import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { setProductsArchivedFromSelection } from "@/lib/product-bulk-actions";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  try {
    const body = await request.json();
    if (typeof body?.archived !== "boolean") {
      return NextResponse.json({ error: "Не указано действие с архивом" }, { status: 400 });
    }
    const result = await runWithBranchApiContext(branch.context, () => setProductsArchivedFromSelection({
      branchId: branch.context.branchId!,
      productIds: Array.isArray(body?.productIds) ? body.productIds : undefined,
      selection: body?.selection,
      archived: body.archived,
    }));
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выполнить массовое действие";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
