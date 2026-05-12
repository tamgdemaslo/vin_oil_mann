import { NextRequest, NextResponse } from "next/server";
import { getSession, setUserPassword, verifyUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword.trim() : "";

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Укажите текущий и новый пароль" }, { status: 400 });
    }

    if (newPassword.length < 4) {
      return NextResponse.json({ error: "Новый пароль должен быть не короче 4 символов" }, { status: 400 });
    }

    const verifiedUser = await verifyUser(session.user.login, currentPassword);
    if (!verifiedUser) {
      return NextResponse.json({ error: "Текущий пароль указан неверно" }, { status: 400 });
    }

    await setUserPassword(session.user.login, newPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Не удалось сохранить новый пароль" }, { status: 500 });
  }
}
