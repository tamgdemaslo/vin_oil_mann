import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageOrganizations } from "@/lib/organizations";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  return NextResponse.json({
    user: session.user,
    permissions: {
      canManageOrganizations: await canManageOrganizations(session.user),
    },
  });
}
