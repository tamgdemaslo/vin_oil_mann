import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessCrm } from "@/lib/crm-access";
import { prisma } from "@/lib/db";

async function requireCrmSession() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!canAccessCrm(session.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accessError = await requireCrmSession();
  if (accessError) return accessError;
  const { id } = await params;
  const events = await prisma.clientCaseEvent.findMany({ where: { caseId: id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ events });
}
