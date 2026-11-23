import { z } from "zod";
import { prisma } from "@/lib/db";
import { flagLoyaltyReview, inspectLoyaltyClient, loyaltyIdentity, operation, loyaltyPermissions, loyaltyProgram, loyaltyScope, LoyaltyError } from "@/lib/loyalty/accounts";
import { entityId, expiryDate, loyaltyApi, loyaltyBody, pointsAmount, reasonText, requestId } from "@/lib/loyalty/http";
import { grantLoyalty, lockLoyaltyAccount, loyaltyBalance, recordExpirations, spendLoyalty } from "@/lib/loyalty/ledger";
import { loyaltyExpiration } from "@/lib/loyalty/calculation";
import { loyaltyLock, requestDigest } from "@/lib/loyalty/posting-request";

type Params = { params: Promise<{ id: string }> };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), branchId: entityId }),
  z.object({ action: z.literal("eligibility"), branchId: entityId, excluded: z.boolean(), reason: reasonText }),
  z.object({ action: z.literal("resolve"), branchId: entityId, accountId: entityId.optional(), separate: z.boolean().optional(), reason: reasonText }),
  z.object({ action: z.literal("adjust"), branchId: entityId, requestKey: requestId, points: pointsAmount,
    reason: reasonText, expires: expiryDate, remove: z.boolean().optional(), shipmentId: entityId.optional() }),
]);

export function GET(_request: Request, { params }: Params) {
  return loyaltyApi("employee", async (context) => {
    const { id } = await params;
    const scope = loyaltyScope(context);
    const permissions = loyaltyPermissions(context);
    const result = await prisma.$transaction(async (tx) => {
      const rules = await loyaltyProgram(tx, scope.businessGroupId);
      if (!rules.enabled) return { status: "disabled" };
      const client = await tx.localCounterparty.findFirst({ where: { branchId: scope.branchId, id } });
      if (!client) throw new LoyaltyError("Карточка клиента не найдена", 404);
      const match = await flagLoyaltyReview(tx, scope, client);
      if (match.status === "review") return { status: "review", candidates: permissions.manager ? match.candidates : undefined };
      if (match.status !== "linked") return { status: match.status };
      await lockLoyaltyAccount(tx, scope, match.accountId);
      await recordExpirations(tx, scope, match.accountId, new Date());
      const balance = await loyaltyBalance(tx, scope.businessGroupId, match.accountId);
      const history = await tx.loyaltyOperation.findMany({
        where: {
          businessGroupId: scope.businessGroupId, branchId: scope.branchId,
          OR: [{ accountId: match.accountId }, { counterpartyId: id, kind: "LINK_REVIEW" }],
        },
        select: { id: true, kind: true, points: true, reason: true, shipmentId: true, campaignId: true, actor: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
      });
      return { status: "linked", ...balance, history, centsPerPoint: rules.centsPerPoint, compensationLimit: rules.compensationLimit };
    });
    return { ...result, branchId: scope.branchId, permissions };
  });
}

export function POST(request: Request, { params }: Params) {
  return loyaltyApi("employee", async (context) => {
    const { id } = await params;
    const input = await loyaltyBody(request, schema);
    const scope = loyaltyScope(context);
    const permissions = loyaltyPermissions(context);
    if (input.branchId !== scope.branchId) throw new LoyaltyError("Активный филиал изменился. Обновите страницу.");
    if ((input.action === "resolve" || input.action === "eligibility") && !permissions.manager) throw new LoyaltyError("Совпадение разбирает управляющий", 403);
    if (input.action === "adjust" && !permissions.owner && (!permissions.master || !input.shipmentId || input.remove)) {
      throw new LoyaltyError("Мастер может начислить компенсацию по проведённой отгрузке", 403);
    }
    return prisma.$transaction(async (tx) => {
      const client = await tx.localCounterparty.findFirst({ where: { branchId: scope.branchId, id } });
      if (!client) throw new LoyaltyError("Карточка клиента не найдена", 404);
      let key: string | undefined;
      const rules = await loyaltyProgram(tx, scope.businessGroupId);
      if (input.action === "adjust") {
        key = `adjust:${input.requestKey}`;
        const hash = requestDigest([id, scope.actor, input]);
        await loyaltyLock(tx, `loyalty:${scope.branchId}:${key}`);
        const used = await tx.loyaltyOperation.findFirst({ where: { branchId: scope.branchId, businessGroupId: scope.businessGroupId, requestKey: key } });
        if (used) {
          if (used.requestDigest !== hash) throw new LoyaltyError("Ключ корректировки уже использован с другими данными");
          return { ok: true, operationId: used.id };
        }
        if (!permissions.owner) {
          const [sale] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM local_demands
            WHERE id = ${input.shipmentId} AND branch_id = ${scope.branchId} AND counterparty_id = ${id} AND applicable = true FOR UPDATE`;
          if (!sale) throw new LoyaltyError("Выберите проведённую отгрузку этого клиента в текущем филиале");
        }
      }
      if (!rules.enabled) throw new LoyaltyError("Программа лояльности отключена");
      if (input.action === "eligibility") {
        if (!loyaltyIdentity(client)) throw new LoyaltyError("Эта карточка не может участвовать в программе");
        await loyaltyLock(tx, `loyalty:card:${id}`);
        const existing = await tx.loyaltyLink.findFirst({ where: { counterpartyId: id, branchId: scope.branchId, businessGroupId: scope.businessGroupId } });
        if ((existing?.excluded ?? false) !== input.excluded) {
          await tx.loyaltyLink.upsert({
            where: { counterpartyId: id },
            create: { counterpartyId: id, branchId: scope.branchId, businessGroupId: scope.businessGroupId, excluded: input.excluded },
            update: { excluded: input.excluded },
          });
          await operation(tx, scope, { counterpartyId: id, accountId: existing?.accountId, points: 0,
            kind: input.excluded ? "CARD_EXCLUDED" : "CARD_RESTORED", reason: input.reason });
        }
        return { ok: true };
      }
      if (input.action === "confirm" || input.action === "resolve") {
        const result = await inspectLoyaltyClient(tx, scope, client, input.action === "confirm" ? { mode: "confirm" } : {
          mode: "manage", chosenAccountId: input.accountId, allowSeparate: input.separate, reason: input.reason,
        });
        return { status: result.status };
      }
      const match = await inspectLoyaltyClient(tx, scope, client, { mode: "sale" });
      if (match.status !== "linked") throw new LoyaltyError("Сначала подтвердите бонусный счёт клиента");
      const { accountId } = match;
      await lockLoyaltyAccount(tx, scope, accountId);
      const now = new Date();
      const hash = requestDigest([id, scope.actor, input]);
      if (!permissions.owner) {
        const totals = await tx.loyaltyOperation.aggregate({
          where: { businessGroupId: scope.businessGroupId, branchId: scope.branchId, accountId, shipmentId: input.shipmentId,
            kind: "COMPENSATION" },
          _sum: { points: true },
        });
        if ((totals._sum.points ?? 0) + input.points > rules.compensationLimit) {
          throw new LoyaltyError(`Лимит компенсации по отгрузке составляет ${rules.compensationLimit} бонусов`);
        }
      }
      let expiresAt: Date | null;
      try { expiresAt = loyaltyExpiration(input.expires); } catch { throw new LoyaltyError("Укажите корректный срок", 400); }
      if (expiresAt && expiresAt <= now) throw new LoyaltyError("Срок уже истёк", 400);
      await recordExpirations(tx, scope, accountId, now);
      const origin = { counterpartyId: id, shipmentId: permissions.owner ? undefined : input.shipmentId, reason: input.reason, requestKey: key, requestDigest: hash };
      const operationId = input.remove
        ? await spendLoyalty(tx, scope, accountId, "MANUAL_REMOVE", input.points, origin, now)
        : await grantLoyalty(tx, scope, accountId, permissions.owner ? "MANUAL_GRANT" : "COMPENSATION", input.points, origin, expiresAt, now);
      return { ok: true, operationId };
    });
  });
}
