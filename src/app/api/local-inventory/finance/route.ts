import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getLocalInventoryFinance } from "@/lib/local-inventory-finance";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ allowAll: false, requireActive: false });
  if (!access.ok) return access.response;

  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? undefined;
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? undefined;
  const organizationId = request.nextUrl.searchParams.get("organizationId") ?? undefined;
  const storeId = request.nextUrl.searchParams.get("storeId") ?? undefined;
  const documentType = request.nextUrl.searchParams.get("documentType") ?? undefined;
  const applicableOnly = request.nextUrl.searchParams.get("applicableOnly") !== "false";
  const includeWriteoffs = request.nextUrl.searchParams.get("includeWriteoffs") !== "false";
  return runWithBranchApiContext(access.context, async () =>
    NextResponse.json(await getLocalInventoryFinance({
      dateFrom,
      dateTo,
      organizationId,
      storeId,
      documentType,
      applicableOnly,
      includeWriteoffs,
    }))
  );
}
