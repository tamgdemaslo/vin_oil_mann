import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  deleteStorageCell,
  StorageCellError,
  type StorageCellInput,
  updateStorageCell,
} from "@/lib/storage-cells";

function errorResponse(error: unknown) {
  if (error instanceof StorageCellError) {
    return NextResponse.json({ error: error.message, code: error.code, ...error.details }, { status: error.status });
  }
  console.error("storage cell request failed", error);
  return NextResponse.json({ error: "Не удалось выполнить операцию с ячейкой" }, { status: 500 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ storeId: string; cellId: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  const { storeId, cellId } = await params;
  try {
    const body = await request.json() as StorageCellInput;
    const cell = await runWithBranchApiContext(access.context, () => updateStorageCell(access.context, storeId, cellId, body));
    return NextResponse.json({ cell });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ storeId: string; cellId: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  const { storeId, cellId } = await params;
  try {
    const body = await request.json().catch(() => ({})) as StorageCellInput;
    const result = await runWithBranchApiContext(access.context, () => deleteStorageCell(access.context, storeId, cellId, body));
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
