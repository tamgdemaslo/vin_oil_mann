import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessCrm } from "@/lib/crm-access";
import { prisma } from "@/lib/db";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";

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
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  return runWithBranchApiContext(branch.context, async () => {
    try {
      const branchId = branch.context.branchId!;
      const row = await prisma.crmDeal.findFirst({ where: { id, branchId }, select: { id: true } });
      if (!row) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
      const events = await prisma.clientCaseEvent.findMany({ where: { caseId: id, branchId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, actorLogin: true, eventType: true, title: true, metadata: true, createdAt: true } });
      return NextResponse.json({ events });
    } catch (error) {
      console.error("[client-cases/timeline]", error);
      return NextResponse.json({ error: "Не удалось загрузить историю изменений" }, { status: 500 });
    }
  });
}
