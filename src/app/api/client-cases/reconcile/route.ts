import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processClientCaseWorkflowTransitions } from "@/lib/client-case-workflow";
import { canAccessCrm } from "@/lib/crm-access";
import { prisma } from "@/lib/db";

async function requireCrmSession() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!canAccessCrm(session.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  return null;
}

export async function POST() {
  const accessError = await requireCrmSession();
  if (accessError) return accessError;
  const transitions = await processClientCaseWorkflowTransitions();
  const reconciled = await prisma.$executeRaw`
    UPDATE crm_deals
    SET next_action_at = next_contact_at,
        updated_at = now()
    WHERE status = 'open'
      AND next_action_at IS NULL
      AND next_contact_at IS NOT NULL
  `;
  return NextResponse.json({ ok: true, transitions, reconciled });
}
