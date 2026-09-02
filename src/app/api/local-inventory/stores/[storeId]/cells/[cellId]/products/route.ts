import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { listStorageCellProducts, StorageCellError } from "@/lib/storage-cells";

export async function GET(_request: Request, { params }: { params: Promise<{ storeId: string; cellId: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ requireActive: false });
  if (!access.ok) return access.response;
  const { storeId, cellId } = await params;
  try {
    const result = await runWithBranchApiContext(access.context, () => listStorageCellProducts(access.context, storeId, cellId));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StorageCellError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("storage cell products request failed", error);
    return NextResponse.json({ error: "Не удалось загрузить товары ячейки" }, { status: 500 });
  }
}
