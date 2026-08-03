import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listMannMakes } from "@/lib/mann-catalog";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  return NextResponse.json({ makes: await listMannMakes() });
}
