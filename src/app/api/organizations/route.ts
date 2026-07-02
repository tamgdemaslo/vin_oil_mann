import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageOrganizations, canViewOrganizations, createOrganization, listOrganizations, type OrganizationInput } from "@/lib/organizations";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!(await canViewOrganizations(session.user))) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  return NextResponse.json(await listOrganizations());
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!(await canManageOrganizations(session.user, "organizations.create"))) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await createOrganization((body ?? {}) as OrganizationInput, session.user.login);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.organization, { status: 201 });
}
