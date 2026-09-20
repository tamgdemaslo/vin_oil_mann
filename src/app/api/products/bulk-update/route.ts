import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { updateProductsFromSelection } from "@/lib/product-bulk-actions";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  try {
    const body = await request.json();
    const rawChanges = body?.changes;
    if (!rawChanges || typeof rawChanges !== "object" || Array.isArray(rawChanges)) {
      return NextResponse.json({ error: "Не указаны поля для изменения" }, { status: 400 });
    }

    const allowedFields = new Set(["brand", "groupPath", "supplierCounterpartyId"]);
    const entries = Object.entries(rawChanges as Record<string, unknown>);
    if (!entries.length || entries.some(([field, value]) => !allowedFields.has(field) || (value !== null && typeof value !== "string"))) {
      return NextResponse.json({ error: "Некорректные поля массового редактирования" }, { status: 400 });
    }

    const changes = rawChanges as { brand?: string; groupPath?: string; supplierCounterpartyId?: string | null };
    const result = await runWithBranchApiContext(branch.context, () => updateProductsFromSelection({
      branchId: branch.context.branchId!,
      productIds: Array.isArray(body?.productIds) ? body.productIds : undefined,
      selection: body?.selection,
      changes,
      actor: session.user,
    }));
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обновить товары";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
