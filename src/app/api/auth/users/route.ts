import { NextResponse } from "next/server";
import { getPublicUsers } from "@/lib/auth";

export async function GET() {
  const users = await getPublicUsers();
  return NextResponse.json({ users });
}
