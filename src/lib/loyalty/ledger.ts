import type { LoyaltyLot, Prisma } from "@prisma/client";
import { LoyaltyError, operation, type LoyaltyScope } from "./accounts";

type ReadDb = Pick<Prisma.TransactionClient, "loyaltyAccount" | "loyaltyLot">;
type Allocation = { lotId: string; points: number };
type Origin = { counterpartyId?: string; shipmentId?: string; campaignId?: string; reason?: string; requestKey?: string; requestDigest?: string };

const lotOrder = [{ expiresAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }] satisfies Prisma.LoyaltyLotOrderByWithRelationInput[];

async function activeLots(db: ReadDb, accountId: string, now: Date) {
  return db.loyaltyLot.findMany({
    where: { accountId, remaining: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: lotOrder,
  });
}

export async function loyaltyBalance(db: ReadDb, groupId: string, accountId: string, now = new Date()) {
  const account = await db.loyaltyAccount.findFirst({ where: { id: accountId, businessGroupId: groupId }, select: { debt: true } });
  if (!account) throw new LoyaltyError("Бонусный счёт недоступен");
  const lots = await activeLots(db, accountId, now);
  const nearest = lots[0]?.expiresAt ?? null;
  const expires = nearest ? { at: nearest, points: lots.filter((lot) => +lot.expiresAt! === +nearest).reduce((n, lot) => n + lot.remaining, 0) } : null;
  const balance = lots.reduce((n, lot) => n + lot.remaining, -account.debt);
  return { balance, available: Math.max(0, balance), expires };
}

export async function lockLoyaltyAccount(tx: Prisma.TransactionClient, scope: LoyaltyScope, accountId: string) {
  const [account] = await tx.$queryRaw<Array<{ debt: number }>>`SELECT debt FROM loyalty_accounts
    WHERE id = ${accountId} AND business_group_id = ${scope.businessGroupId} FOR UPDATE`;
  if (!account) throw new LoyaltyError("Бонусный счёт недоступен");
  return account;
}

async function consumeLots(tx: Prisma.TransactionClient, lots: LoyaltyLot[], points: number) {
  let remaining = points;
  const allocation: Allocation[] = [];
  for (const lot of lots) {
    const take = Math.min(lot.remaining, remaining);
    if (take === 0) break;
    await tx.loyaltyLot.update({ where: { id: lot.id }, data: { remaining: { decrement: take } } });
    allocation.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  return { allocation, remaining };
}

async function payDebt(tx: Prisma.TransactionClient, scope: LoyaltyScope, accountId: string, now: Date) {
  const { debt } = await lockLoyaltyAccount(tx, scope, accountId);
  if (!debt) return;
  const { allocation, remaining } = await consumeLots(tx, await activeLots(tx, accountId, now), debt);
  if (debt === remaining) return;
  await tx.loyaltyAccount.update({ where: { id: accountId }, data: { debt: remaining } });
  await operation(tx, scope, { accountId, kind: "DEBT_PAYMENT", points: 0, allocation });
}

export async function recordExpirations(tx: Prisma.TransactionClient, scope: LoyaltyScope, accountId: string, now: Date) {
  const expired = await tx.loyaltyLot.findMany({
    where: { accountId, branchId: scope.branchId, expiresAt: { lte: now }, expirationRecorded: false, remaining: { gt: 0 } },
  });
  for (const lot of expired) {
    await operation(tx, scope, {
      accountId, kind: "EXPIRED", points: -lot.remaining, reason: lot.expiresAt!.toISOString(),
      allocation: [{ lotId: lot.id, points: lot.remaining }],
    });
    await tx.loyaltyLot.update({ where: { id: lot.id }, data: { expirationRecorded: true } });
  }
}

/** All mutations are called with the account row locked for the remainder of the transaction. */
export async function grantLoyalty(tx: Prisma.TransactionClient, scope: LoyaltyScope, accountId: string, kind: string, points: number, origin: Origin, expiresAt: Date | null, now: Date) {
  const event = await operation(tx, scope, { accountId, kind, points, ...origin });
  await tx.loyaltyLot.create({ data: { id: event.id, accountId, branchId: scope.branchId, remaining: points, expiresAt } });
  await payDebt(tx, scope, accountId, now);
  return event.id;
}

export async function spendLoyalty(tx: Prisma.TransactionClient, scope: LoyaltyScope, accountId: string, kind: string, points: number, origin: Origin, now: Date) {
  const { available } = await loyaltyBalance(tx, scope.businessGroupId, accountId, now);
  if (points > available) throw new LoyaltyError("Доступный остаток изменился");
  const { allocation } = await consumeLots(tx, await activeLots(tx, accountId, now), points);
  return (await operation(tx, scope, { accountId, kind, points: -points, ...origin, allocation })).id;
}

export async function reverseEarned(tx: Prisma.TransactionClient, scope: LoyaltyScope, accountId: string,
  lotId: string, points: number, origin: Origin, now: Date) {
  const lot = await tx.loyaltyLot.findFirstOrThrow({ where: { id: lotId, accountId } });
  const availableFromLot = Math.min(points, lot.remaining);
  await tx.loyaltyLot.update({ where: { id: lot.id }, data: { remaining: { decrement: availableFromLot } } });
  await operation(tx, scope, { accountId, kind: "PURCHASE_REVERSED", points: -points, ...origin,
    allocation: [{ lotId, points: availableFromLot }] });
  if (availableFromLot === points) return;
  await tx.loyaltyAccount.update({ where: { id: accountId }, data: { debt: { increment: points - availableFromLot } } });
  await payDebt(tx, scope, accountId, now);
}

export async function restoreSpent(tx: Prisma.TransactionClient, scope: LoyaltyScope, accountId: string, spendId: string,
  previous: number, points: number, origin: Origin, now: Date) {
  const event = await tx.loyaltyOperation.findFirstOrThrow({ where: { id: spendId, accountId, kind: "PURCHASE_SPEND" } });
  const original = event.allocation as Allocation[];
  const restored: Allocation[] = [];
  let offset = 0;
  for (const part of original) {
    const count = Math.min(previous + points, offset + part.points) - Math.max(previous, offset);
    offset += part.points;
    if (count <= 0) continue;
    const lot = await tx.loyaltyLot.findFirstOrThrow({ where: { id: part.lotId, accountId } });
    if (lot.expiresAt && lot.expiresAt <= now) {
      await operation(tx, scope, { accountId, kind: "RESTORATION_EXPIRED", points: -count, ...origin,
        reason: lot.expiresAt.toISOString(), allocation: [{ lotId: part.lotId, points: count }] });
    } else {
      await tx.loyaltyLot.update({ where: { id: part.lotId }, data: { remaining: { increment: count } } });
    }
    restored.push({ lotId: part.lotId, points: count });
  }
  if (restored.reduce((sum, part) => sum + part.points, 0) !== points) throw new Error("Нарушена история списания");
  await operation(tx, scope, { accountId, kind: "PURCHASE_SPEND_RESTORED", points, ...origin, allocation: restored });
  await payDebt(tx, scope, accountId, now);
}
