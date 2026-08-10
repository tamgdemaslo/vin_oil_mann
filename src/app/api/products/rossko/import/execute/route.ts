import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  executeRosskoProductImport,
  RosskoProductImportError,
  type RosskoImportExecuteRow,
} from "@/lib/rossko-product-import";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  try {
    const body = await request.json();
    const rows = Array.isArray(body?.rows) ? body.rows as RosskoImportExecuteRow[] : [];
    const result = await runWithBranchApiContext(branch.context, () => executeRosskoProductImport({
      context: branch.context,
      actor: session.user,
      orderId: String(body?.orderId ?? ""),
      rows,
    }));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RosskoProductImportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("ROSSKO product import failed", error);
    return NextResponse.json({ error: "Не удалось импортировать товары из заказа ROSSKO" }, { status: 500 });
  }
}
