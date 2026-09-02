import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  createStorageCell,
  listStorageCells,
  StorageCellError,
  type StorageCellInput,
} from "@/lib/storage-cells";

function errorResponse(error: unknown) {
  if (error instanceof StorageCellError) {
    return NextResponse.json({ error: error.message, code: error.code, ...error.details }, { status: error.status });
  }
  console.error("storage cells request failed", error);
  return NextResponse.json({ error: "Не удалось выполнить операцию с ячейками" }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ requireActive: false });
  if (!access.ok) return access.response;
  const { storeId } = await params;
  const statusValue = request.nextUrl.searchParams.get("status") ?? "all";
  const sortValue = request.nextUrl.searchParams.get("sort") ?? "code";
  const directionValue = request.nextUrl.searchParams.get("direction") ?? "asc";
  const status = ["all", "occupied", "free", "archived"].includes(statusValue)
    ? statusValue as "all" | "occupied" | "free" | "archived"
    : "all";
  const sort = ["code", "name", "products", "createdAt"].includes(sortValue)
    ? sortValue as "code" | "name" | "products" | "createdAt"
    : "code";
  try {
    return await runWithBranchApiContext(access.context, async () => NextResponse.json(await listStorageCells(access.context, storeId, {
      search: request.nextUrl.searchParams.get("search") ?? "",
      status,
      sort,
      direction: directionValue === "desc" ? "desc" : "asc",
      limit: Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 50)),
      offset: Math.max(0, Number(request.nextUrl.searchParams.get("offset")) || 0),
    })));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  const { storeId } = await params;
  try {
    const body = await request.json() as StorageCellInput;
    const result = await runWithBranchApiContext(access.context, () => createStorageCell(access.context, storeId, body));
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
