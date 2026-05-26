import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id не указан" }, { status: 400 });
  }

  return NextResponse.json(
    {
      error:
        "Печать через шаблоны МойСклад отключена. Используйте локальные макеты: постер, бирку или Excel заказ-наряд.",
    },
    { status: 410 }
  );
}
