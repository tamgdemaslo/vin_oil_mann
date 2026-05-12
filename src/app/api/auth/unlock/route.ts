import { NextRequest, NextResponse } from "next/server";
import { getSession, verifyUser } from "@/lib/auth";

const PIN_REGEX = /^\d{4}$/;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const password = typeof body.password === "string" ? body.password.trim() : "";

    if (!PIN_REGEX.test(password)) {
      return NextResponse.json({ error: "Введите 4 цифры" }, { status: 400 });
    }

    const user = await verifyUser(session.user.login, password);
    if (!user) {
      return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Ошибка проверки пароля" }, { status: 500 });
  }
}
