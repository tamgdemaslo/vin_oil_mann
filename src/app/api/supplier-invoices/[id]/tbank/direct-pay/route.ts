import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Прямой платёж доступен только владельцу." }, { status: 403 });
  }
  return NextResponse.json(
    { error: "Прямые платежи T-Bank выключены в первом этапе. Используйте создание черновика." },
    { status: 409 }
  );
}
