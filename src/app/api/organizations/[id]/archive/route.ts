import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { archiveOrganization, canManageOrganizations, restoreOrganization } from "@/lib/organizations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!(await canManageOrganizations(session.user, "organizations.archive"))) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { restore?: unknown };
  const result = body.restore ? await restoreOrganization(id, session.user.login) : await archiveOrganization(id, session.user.login);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, unfinished: "unfinished" in result ? result.unfinished : undefined },
      { status: "notFound" in result ? 404 : 400 }
    );
  }
  return NextResponse.json(result.organization);
}
