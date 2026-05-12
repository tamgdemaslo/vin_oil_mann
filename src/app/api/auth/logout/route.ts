import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSession, getSessionCookieOpts } from "@/lib/auth";

export async function POST() {
  const store = await cookies();
  const token = store.get(getSessionCookieOpts().name)?.value;
  if (token) await clearSession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(getSessionCookieOpts().name, "", { maxAge: 0, path: "/" });
  return res;
}
