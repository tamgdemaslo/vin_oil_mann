import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listLocalProductGroups } from "@/lib/local-inventory-admin";
import { requireBranchApi } from "@/lib/branch-api";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  const includeArchived = request.nextUrl.searchParams.get("archived") === "1";
  const groups = await listLocalProductGroups({ branchId: branchAccess.context.branchId!, includeArchived });
  return NextResponse.json({ groups });
}
