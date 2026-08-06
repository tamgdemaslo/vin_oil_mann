import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ requireActive: false }); if (!access.ok) return access.response;
  const organizationId = request.nextUrl.searchParams.get("organizationId")?.trim() ?? "";
  const rows = await prisma.localStore.findMany({ where: { branchId: access.context.branchId!, archived: false, ...(organizationId ? { OR: [{ organizationId }, { organizationId: null }] } : {}) }, orderBy: [{ isMain: "desc" }, { name: "asc" }] });
  return NextResponse.json({ stores: rows.map((row) => ({ id: row.id, name: row.name, organizationId: row.organizationId, isMain: row.isMain, meta: { href: `local://store/${row.id}`, type: "store", mediaType: "application/json" } })) });
}
