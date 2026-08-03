import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { quickCreateSupplier } from "@/lib/local-inventory-admin";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }
  const result = await quickCreateSupplier(body as Parameters<typeof quickCreateSupplier>[0], branchAccess.context.branchId!);
  if (!result.ok) {
    return NextResponse.json(result, { status: "conflict" in result ? 409 : 400 });
  }
  return NextResponse.json(result.counterparty, { status: 201 });
}
