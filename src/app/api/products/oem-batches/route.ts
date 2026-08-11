import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { createProductOemBatchFromSelection, listProductOemBatches } from "@/lib/product-oem-batches";
import { kickProductOemWorker } from "@/lib/product-oem-worker";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const batches = await runWithBranchApiContext(branch.context, () => listProductOemBatches(branch.context.branchId!, {
      activeOnly: request.nextUrl.searchParams.get("active") === "1",
      limit: Number(request.nextUrl.searchParams.get("limit") ?? "10"),
    }));
    return NextResponse.json({ batches });
  } catch (error) {
    console.error("product OEM batches list failed", error);
    return NextResponse.json({ error: "Не удалось загрузить историю заполнения OEM" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  try {
    const body = await request.json();
    const batch = await runWithBranchApiContext(branch.context, () => createProductOemBatchFromSelection({
      branchId: branch.context.branchId!,
      createdById: branch.context.userId,
      productIds: Array.isArray(body?.productIds) ? body.productIds : undefined,
      selection: body?.selection,
      source: String(body?.source ?? "CATALOG"),
    }));
    kickProductOemWorker();
    return NextResponse.json({ batch }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось запустить заполнение OEM" }, { status: 400 });
  }
}
