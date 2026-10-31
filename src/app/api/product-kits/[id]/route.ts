import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { readSharedKit as readKit, updateSharedKit as updateKitState } from "@/lib/shared-product-kits";
import { kitErrorResponse } from "@/lib/product-kit-api-error";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  return runWithBranchApiContext(access.context, async () => {
    try { return NextResponse.json(await readKit(access.context.branchId!, (await context.params).id, request.nextUrl.searchParams.get("storeId"))); }
    catch (error) { return kitErrorResponse(error); }
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  return runWithBranchApiContext(access.context, async () => {
    try {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
      return NextResponse.json(await updateKitState(access.context.branchId!, (await context.params).id, body as Record<string, unknown>));
    } catch (error) { return kitErrorResponse(error); }
  });
}
