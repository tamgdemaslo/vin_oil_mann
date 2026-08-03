import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isClientCaseStatus } from "@/lib/client-case-shared";
import { writeClientCaseEvent } from "@/lib/client-case-workflow";
import { canAccessCrm } from "@/lib/crm-access";
import { prisma } from "@/lib/db";

async function requireCrmSession() {
  const session = await getSession();
  if (!session) return { session: null, response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (!canAccessCrm(session.user.role)) return { session: null, response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return { session, response: null };
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function date(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCrmSession();
  if (access.response) return access.response;
  const { id } = await params;
  const item = await prisma.crmDeal.findUnique({ where: { id }, include: { stage: true, events: { orderBy: { createdAt: "asc" } } } });
  if (!item) return NextResponse.json({ error: "Дело не найдено" }, { status: 404 });
  return NextResponse.json({ case: item });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCrmSession();
  if (access.response) return access.response;
  const session = access.session!;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (body.status !== undefined || body.caseStatus !== undefined) {
    const status = body.caseStatus ?? body.status;
    if (isClientCaseStatus(status)) data.caseStatus = status;
  }
  if (body.responsibleUserId !== undefined || body.responsibleLogin !== undefined) data.responsibleLogin = text(body.responsibleUserId ?? body.responsibleLogin);
  if (body.nextActionAt !== undefined) {
    data.nextActionAt = date(body.nextActionAt);
    data.nextContactAt = data.nextActionAt;
  }
  if (body.title !== undefined) data.title = text(body.title) ?? "Новое дело клиента";
  if (body.description !== undefined || body.notes !== undefined) data.notes = text(body.description ?? body.notes);
  if (body.closedReason !== undefined || body.closeReason !== undefined) data.closeReason = text(body.closedReason ?? body.closeReason);
  if (data.caseStatus === "closed" || data.caseStatus === "cancelled" || data.caseStatus === "duplicate") {
    data.status = data.caseStatus === "closed" ? "won" : "lost";
    data.closedAt = new Date();
  }
  const updated = await prisma.crmDeal.update({ where: { id }, data });
  await writeClientCaseEvent({ caseId: id, actorLogin: session.user.login, eventType: "case_updated", title: "Дело обновлено", metadata: data });
  return NextResponse.json({ case: updated });
}
