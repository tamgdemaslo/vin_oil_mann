import { NextResponse } from "next/server";
import { getPublicUsers } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const users = await getPublicUsers();
  return NextResponse.json(
    { users },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
