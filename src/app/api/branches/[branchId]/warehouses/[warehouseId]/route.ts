import { NextRequest, NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";
import {
  archiveManagedWarehouse,
  isWarehouseNotFound,
  setManagedWarehouseMain,
  updateManagedWarehouse,
  type WarehouseInput,
} from "@/lib/local-store-management";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ branchId: string; warehouseId: string }> }) {
  try {
    const context = await requireBranchContext({ allowAll: true });
    const { branchId, warehouseId } = await params;
    const body = await request.json() as WarehouseInput & { action?: unknown };
    const result = body.action === "set_main"
      ? await setManagedWarehouseMain(context, branchId, warehouseId)
      : await updateManagedWarehouse(context, branchId, warehouseId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ warehouse: result.warehouse });
  } catch (error) {
    if (isWarehouseNotFound(error)) return NextResponse.json({ error: "Склад не найден или находится в архиве" }, { status: 404 });
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ branchId: string; warehouseId: string }> }) {
  try {
    const context = await requireBranchContext({ allowAll: true });
    const { branchId, warehouseId } = await params;
    const result = await archiveManagedWarehouse(context, branchId, warehouseId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ warehouse: result.warehouse });
  } catch (error) {
    if (isWarehouseNotFound(error)) return NextResponse.json({ error: "Склад не найден или уже находится в архиве" }, { status: 404 });
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}
