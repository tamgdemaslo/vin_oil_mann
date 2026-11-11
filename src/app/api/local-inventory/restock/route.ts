import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { listLocalRestockNeeds } from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ allowAll: false, requireActive: false });
  if (!access.ok) return access.response;

  const mode = request.nextUrl.searchParams.get("mode") ?? "";
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const summary = mode === "below_min" && request.nextUrl.searchParams.get("summary") === "1";
  const dateFrom = request.nextUrl.searchParams.get("date_from");
  const dateTo = request.nextUrl.searchParams.get("date_to");

  try {
    return runWithBranchApiContext(access.context, async () => {
      const result = await listLocalRestockNeeds({ mode, refresh, dateFrom, dateTo });
      if (!summary) return NextResponse.json(result);
      return NextResponse.json({
        count: result.items.length,
        items: result.items.slice(0, 3).map(({ productId, name, code, shortage }) => ({
          productId, name, code, shortage,
        })),
      });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось рассчитать пополнение" },
      { status: 400 }
    );
  }
}
