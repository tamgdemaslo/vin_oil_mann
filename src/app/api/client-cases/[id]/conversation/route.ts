import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canAccessClientCases } from "@/lib/crm-access";
import { prisma } from "@/lib/db";
import { caseCorrespondence, caseCorrespondenceLink } from "@/lib/client-case-correspondence";
import { CASE_CHAT_CHANNELS, caseChatPhoneLink, validCaseChatLink } from "@/lib/client-case-chat-link";
import { caseCounterpartyPhoneKeys, uniqueCaseCounterpartyId } from "@/lib/client-case-counterparty";
import { anonymousRetailCounterpartyExclusion } from "@/lib/anonymous-retail-counterparty";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";

export const dynamic = "force-dynamic";

type Match = { id: string; clientId: string | null; peerId: string; priority: number };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!canAccessClientCases(session.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  return runWithBranchApiContext(access.context, async () => {
    try {
      const { id } = await params;
      const branchId = access.context.branchId!;
      const row = await prisma.crmDeal.findFirst({ where: { id, branchId }, select: { notes: true, phoneNormalized: true, conversationId: true } });
      if (!row) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
      const channel = caseCorrespondence(row.notes);
      if (!channel) return NextResponse.json({ error: "Сначала выберите мессенджер", needsLink: true }, { status: 400 });
      const savedLink = caseCorrespondenceLink(row.notes);
      if (savedLink && validCaseChatLink(savedLink, channel, process.env.APP_ORIGIN || _request.url)) return NextResponse.json({ url: savedLink });
      const phones = caseCounterpartyPhoneKeys(row.phoneNormalized);
      const fallback = caseChatPhoneLink(channel, row.phoneNormalized);
      const dbChannel = CASE_CHAT_CHANNELS[channel];
      let matches: Match[] = [];
      if (dbChannel) {
        const clients = phones.length ? await prisma.localCounterparty.findMany({
          where: { branchId, archived: false, ...anonymousRetailCounterpartyExclusion(branchId), normalizedPhone: { in: phones } },
          select: { id: true, normalizedPhone: true },
        }) : [];
        const clientId = uniqueCaseCounterpartyId(row.phoneNormalized, clients);
        const organizationId = getMessengerOrganizationId();
        const linkedCase = Prisma.sql`EXISTS (SELECT 1 FROM conversation_entity_links l WHERE l.branch_id = ${branchId} AND l.organization_id = ${organizationId} AND l.conversation_id = c.id AND l.entity_type = 'CRM_CASE' AND l.entity_id = ${id})`;
        const byPhone = phones.length ? Prisma.sql`(
          (c.client_id IS NULL OR c.client_id = ${clientId}) AND (
            regexp_replace(COALESCE(c.participant_phone, ''), '[^0-9]', '', 'g') IN (${Prisma.join(phones)})
            OR EXISTS (SELECT 1 FROM communication_identities i WHERE i.branch_id = ${branchId} AND i.organization_id = ${organizationId} AND i.channel = ${dbChannel} AND i.messenger_account_id = c.messenger_account_id AND i.status <> 'UNLINKED' AND (i.external_user_id = c.external_user_id OR i.external_conversation_id = c.external_conversation_id) AND regexp_replace(COALESCE(i.phone_normalized, ''), '[^0-9]', '', 'g') IN (${Prisma.join(phones)}))
          ))` : Prisma.sql`FALSE`;
        try {
          matches = await prisma.$queryRaw<Match[]>(Prisma.sql`
            SELECT c.id, c.client_id AS "clientId", COALESCE(c.external_user_id, c.external_conversation_id, c.id) AS "peerId",
              CASE WHEN c.id = ${row.conversationId} THEN 0 WHEN ${linkedCase} THEN 1 WHEN c.client_id = ${clientId} THEN 2 ELSE 3 END AS priority
            FROM messenger_conversations c
            WHERE c.branch_id = ${branchId} AND c.organization_id = ${organizationId} AND c.channel = ${dbChannel} AND c.status <> 'blocked'
              AND (c.id = ${row.conversationId} OR ${linkedCase} OR c.client_id = ${clientId} OR ${byPhone})
            ORDER BY priority, c.last_message_at DESC LIMIT 20
          `);
        } catch (error) {
          const cause = error as { code?: string; meta?: { code?: string } };
          if (cause.code !== "P2021" && cause.meta?.code !== "42P01") throw error;
          // Older branches may not have messenger tables; phone links still work.
        }
      }
      if (matches.length) {
        const best = matches.filter(match => match.priority === matches[0].priority);
        if (matches[0].priority >= 3 && (matches.length === 20 || new Set(best.map(match => match.clientId ? `client:${match.clientId}` : `peer:${match.peerId}`)).size > 1)) {
          return NextResponse.json({ error: "Найдено несколько диалогов. Сохраните ссылку на нужную переписку.", needsLink: true }, { status: 409 });
        }
        return NextResponse.json({ url: `/messages?conversationId=${encodeURIComponent(matches[0].id)}` });
      }
      if (fallback) return NextResponse.json({ url: fallback });
      return NextResponse.json({ error: `Добавьте ссылку на переписку в ${channel}.`, needsLink: true }, { status: 404 });
    } catch (error) {
      console.error("[client-cases/conversation GET]", error);
      return NextResponse.json({ error: "Не удалось открыть переписку. Попробуйте ещё раз." }, { status: 500 });
    }
  });
}
