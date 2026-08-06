import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  return (await getSession()) ? NextResponse.json({ attributes: [], source: "local" }) : NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
}
