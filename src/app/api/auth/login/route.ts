import { NextRequest, NextResponse } from "next/server";
import { verifyUser, createSession, getSessionCookieOpts } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const login = typeof body.login === "string" ? body.login.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!login || !password) {
      return NextResponse.json({ error: "Укажите логин и пароль" }, { status: 400 });
    }
    const user = await verifyUser(login, password);
    if (!user) {
      return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
    }
    const token = await createSession(user);
    const opts = getSessionCookieOpts();
    const res = NextResponse.json({ user: { login: user.login, name: user.name, role: user.role } });
    res.cookies.set(opts.name, token, {
      maxAge: opts.maxAge,
      path: opts.path,
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
    });
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Ошибка входа" }, { status: 500 });
  }
}
