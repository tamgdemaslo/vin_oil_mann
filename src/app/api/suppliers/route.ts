import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { listActiveSuppliers } from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  return NextResponse.json(await listActiveSuppliers({
    branchId: branchAccess.context.branchId!,
    search: request.nextUrl.searchParams.get("search") ?? "",
    limit: Number(request.nextUrl.searchParams.get("limit") ?? "30"),
  }));
}
