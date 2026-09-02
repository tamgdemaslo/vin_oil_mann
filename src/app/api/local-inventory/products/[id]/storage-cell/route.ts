import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  assignProductStorageCell,
  getProductStorageCells,
  StorageCellError,
} from "@/lib/storage-cells";

function errorResponse(error: unknown) {
  if (error instanceof StorageCellError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error("product storage cell request failed", error);
  return NextResponse.json({ error: "Не удалось изменить ячейку товара" }, { status: 500 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ requireActive: false });
  if (!access.ok) return access.response;
  const { id } = await params;
  try {
    const assignments = await runWithBranchApiContext(access.context, () => getProductStorageCells(access.context, id));
    return NextResponse.json({ assignments });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  const { id } = await params;
  try {
    const body = await request.json() as { storeId?: unknown; cellId?: unknown };
    const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
    const cellId = typeof body.cellId === "string" && body.cellId.trim() ? body.cellId.trim() : null;
    if (!storeId) return NextResponse.json({ error: "Выберите склад" }, { status: 400 });
    const result = await runWithBranchApiContext(access.context, () => assignProductStorageCell(access.context, id, storeId, cellId));
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
