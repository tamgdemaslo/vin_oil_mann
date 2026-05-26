import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listLocalRestockNeeds } from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const refresh = request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("refresh") === "true";
  const dateFrom = request.nextUrl.searchParams.get("date_from");
  const dateTo = request.nextUrl.searchParams.get("date_to");

  try {
    return NextResponse.json(await listLocalRestockNeeds({
      mode: "outflow",
      refresh,
      dateFrom,
      dateTo,
    }));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Не удалось рассчитать пополнение",
        rule: "below_min_with_period_outflow",
      },
      { status: 400 }
    );
  }
}
