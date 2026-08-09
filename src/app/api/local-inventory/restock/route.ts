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
  const dateFrom = request.nextUrl.searchParams.get("date_from");
  const dateTo = request.nextUrl.searchParams.get("date_to");

  try {
    return runWithBranchApiContext(access.context, async () =>
      NextResponse.json(await listLocalRestockNeeds({ mode, refresh, dateFrom, dateTo }))
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось рассчитать пополнение" },
      { status: 400 }
    );
  }
}
