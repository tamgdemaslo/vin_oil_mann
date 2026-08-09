import { NextRequest, NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";
import { createManagedWarehouse, listManagedWarehouses, type WarehouseInput } from "@/lib/local-store-management";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const context = await requireBranchContext({ allowAll: true, requireActive: false });
    const { branchId } = await params;
    const result = await listManagedWarehouses(context, branchId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ warehouses: result.warehouses, canManage: result.canManage });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ branchId: string }> }) {
  try {
    const context = await requireBranchContext({ allowAll: true });
    const { branchId } = await params;
    const body = await request.json() as WarehouseInput;
    const result = await createManagedWarehouse(context, branchId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ warehouse: result.warehouse }, { status: 201 });
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}
