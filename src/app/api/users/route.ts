import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUsersFromEnv } from "@/lib/auth";

/** GET: список сотрудников (логин + имя). Только для владельца. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Доступ только для владельца" }, { status: 403 });
  }

  const envUsers = await getUsersFromEnv();
  const users = envUsers.map((u) => ({ login: u.login, name: u.name || u.login, role: u.role }));
  return NextResponse.json({ users });
}
