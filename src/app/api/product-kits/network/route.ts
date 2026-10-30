import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { kitErrorResponse } from "@/lib/product-kit-api-error";
import { listNetworkKits } from "@/lib/product-kit-network";

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!access.ok) return access.response;
  try {
    const sp = request.nextUrl.searchParams;
    return NextResponse.json(await listNetworkKits(access.context, {
      branchId: sp.get("branchId") || null, q: sp.get("q")?.trim(), archived: sp.get("archived") === "1",
      page: Math.max(0, Math.min(100_000, parseInt(sp.get("page") ?? "0", 10) || 0)),
    }));
  } catch (error) { return kitErrorResponse(error); }
}
