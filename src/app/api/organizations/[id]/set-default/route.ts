import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageOrganizations, setDefaultOrganization } from "@/lib/organizations";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!(await canManageOrganizations(session.user, "organizations.set_default"))) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const { id } = await params;
  const result = await setDefaultOrganization(id, session.user.login);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: "notFound" in result ? 404 : 400 });
  return NextResponse.json(result.organization);
}
