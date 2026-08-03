import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageOrganizations, canViewOrganizations, deleteOrganization, getOrganization, updateOrganization, type OrganizationInput } from "@/lib/organizations";

async function updateOrganizationFromRequest(
  request: NextRequest,
  id: string,
  performedByLogin: string
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await updateOrganization(id, (body ?? {}) as OrganizationInput, performedByLogin);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: "notFound" in result ? 404 : 400 });
  return NextResponse.json(result.organization);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!(await canViewOrganizations(session.user))) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const { id } = await params;
  const organization = await getOrganization(id);
  if (!organization) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  return NextResponse.json(organization);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!(await canManageOrganizations(session.user, "organizations.edit"))) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const { id } = await params;
  return updateOrganizationFromRequest(request, id, session.user.login);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!(await canManageOrganizations(session.user, "organizations.edit"))) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const { id } = await params;
  return updateOrganizationFromRequest(request, id, session.user.login);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!(await canManageOrganizations(session.user, "organizations.delete"))) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const { id } = await params;
  const result = await deleteOrganization(id, session.user.login);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, linkedCounts: result.linkedCounts, canArchive: result.canArchive },
      { status: "notFound" in result ? 404 : 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
