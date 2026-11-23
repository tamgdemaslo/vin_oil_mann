import { z } from "zod";
import { Prisma, type LocalCounterparty } from "@prisma/client";
import { runWithBranchApiTargetContext } from "@/lib/branch-api";
import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { loadCustomerReturnQueue, getAnalyticsTodayYmd } from "@/lib/customer-analytics";
import { listCustomerReturnStates } from "@/lib/customer-return-state";
import { effectiveCustomerReturnState } from "@/lib/customer-return-contact-policy";
import { inspectLoyaltyClient, loyaltyIdentity, loyaltyProgram, loyaltyScope, LoyaltyError } from "@/lib/loyalty/accounts";
import { loyaltyExpiration } from "@/lib/loyalty/calculation";
import { entityId, expiryDate, loyaltyApi, loyaltyBody, pointsAmount, reasonText, requestId } from "@/lib/loyalty/http";
import { grantLoyalty, lockLoyaltyAccount, recordExpirations } from "@/lib/loyalty/ledger";
import { loyaltyLock, requestDigest } from "@/lib/loyalty/posting-request";
import { matchesLoyaltyQueueFilter } from "@/lib/loyalty/queue-filter";

const filters = z.object({
  tab: z.enum(["ready", "processing", "sent", "errors", "review", "skipped"]),
  todayResult: z.enum(["processing", "sent", "failed", "unknown"]).nullish(),
  scenario: z.enum(["all", "missed_interval", "oil_soon", "single_visit"]),
  search: z.string().max(240),
});
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("preview"), id: requestId, branchId: entityId, mode: z.enum(["one", "selected", "filter", "all"]),
    keys: z.array(z.string().min(1).max(400)).max(10_000), filters,
    points: pointsAmount, reason: reasonText, expires: expiryDate, serviceDate: z.string(),
  }),
  z.object({ action: z.literal("run"), id: requestId, branchId: entityId, errorCursor: entityId.optional() }),
]);
type Preview = Extract<z.infer<typeof schema>, { action: "preview" }>;

async function summarize(context: BranchContext, id: string) {
  const scope = loyaltyScope(context);
  const campaign = await prisma.loyaltyCampaign.findFirst({
    where: { id, businessGroupId: scope.businessGroupId, branchId: scope.branchId },
    select: { id: true, confirmedAt: true, filters: true, expiresAt: true, points: true, reason: true },
  });
  if (!campaign) throw new LoyaltyError("Акция не найдена в текущем филиале", 404);
  const [counts, skips] = await Promise.all([
    prisma.loyaltyCampaignRecipient.groupBy({ by: ["status"], where: { campaignId: id }, _count: { _all: true } }),
    prisma.loyaltyCampaignRecipient.groupBy({ by: ["status", "error"], where: { campaignId: id, error: { not: null } }, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(counts.map((row) => [row.status, row._count._all]));
  const recipients = (byStatus.pending ?? 0) + (byStatus.done ?? 0) + (byStatus.error ?? 0);
  return { ...campaign, counts: byStatus, skips, recipients, total: recipients * campaign.points,
    deliveryStatus: "unavailable", deliveryMessage: "Для бонусных сообщений пока нет рабочего канала CRM." };
}

async function audience(context: BranchContext, input: Preview) {
  const scope = loyaltyScope(context);
  const branches = input.mode === "all" ? context.branches.filter((branch) => branch.status === "active").map((branch) => branch.id) : [scope.branchId];
  const missing: { branchId: string; counterpartyId: string; status: string; error: string }[] = [];
  const clients: LocalCounterparty[] = [];
  for (const branchId of branches) {
    await runWithBranchApiTargetContext(context, branchId, async () => {
      if (input.mode === "all") {
        clients.push(...await prisma.localCounterparty.findMany({
          where: { branchId, category: "INDIVIDUAL", companyType: { equals: "individual", mode: "insensitive" }, archived: false, status: "ACTIVE" },
          orderBy: { id: "asc" },
        }));
        return;
      }
      if (input.serviceDate !== getAnalyticsTodayYmd()) throw new LoyaltyError("Дата подборки изменилась. Обновите страницу.");
      const [candidates, saved] = await Promise.all([loadCustomerReturnQueue(input.serviceDate), listCustomerReturnStates(input.serviceDate)]);
      const states = new Map(saved.map((state) => [state.clientKey, state]));
      const keys = new Set(input.keys);
      if ((input.mode === "one" && keys.size !== 1) || (input.mode === "selected" && keys.size === 0)) {
        throw new LoyaltyError("Выберите клиентов");
      }
      const selected = candidates.filter((candidate) => {
        const state = states.get(candidate.clientKey);
        return input.mode === "filter"
          ? matchesLoyaltyQueueFilter(candidate, state ? effectiveCustomerReturnState(candidate, state) : undefined, input.filters)
          : keys.has(candidate.id);
      });
      for (const candidate of selected) {
        if (!candidate.counterpartyId) missing.push({
          branchId, counterpartyId: `queue:${candidate.id}`, status: "skipped", error: "В подборке нет однозначной карточки клиента",
        });
      }
      const selectedKeys = new Set(selected.map(({ id }) => id));
      if (input.mode !== "filter") {
        for (const key of keys) if (!selectedKeys.has(key)) missing.push({
          branchId, counterpartyId: `queue:${key}`, status: "skipped", error: "Клиент больше не входит в подборку",
        });
      }
      const ids = [...new Set(selected.flatMap((candidate) => candidate.counterpartyId ? [candidate.counterpartyId] : []))];
      for (let index = 0; index < ids.length; index += 1000) {
        clients.push(...await prisma.localCounterparty.findMany({ where: { branchId, id: { in: ids.slice(index, index + 1000) } }, orderBy: { id: "asc" } }));
      }
    });
  }
  return { clients, missing };
}

async function makePreview(context: BranchContext, input: Preview) {
  const scope = loyaltyScope(context);
  if (!(await loyaltyProgram(prisma, scope.businessGroupId)).enabled) throw new LoyaltyError("Программа лояльности отключена");
  const signature = requestDigest(input);
  const existing = await prisma.loyaltyCampaign.findFirst({ where: { id: input.id, businessGroupId: scope.businessGroupId, branchId: scope.branchId } });
  if (existing) {
    if ((existing.filters as { signature?: string }).signature !== signature) throw new LoyaltyError("Ключ предпросмотра уже использован");
    return summarize(context, input.id);
  }
  let expiresAt: Date | null;
  try { expiresAt = loyaltyExpiration(input.expires); } catch { throw new LoyaltyError("Укажите корректный срок", 400); }
  if (expiresAt && expiresAt <= new Date()) throw new LoyaltyError("Срок уже истёк", 400);
  const { clients, missing } = await audience(context, input);
  const identities = new Map(clients.map((client) => [client.id, loyaltyIdentity(client)]));
  const phones = [...new Set([...identities.values()].flatMap((identity) => identity?.phoneKey ? [identity.phoneKey] : []))];
  const accounts = new Map<string, { id: string; nameKey: string }[]>();
  const links = new Map<string, { accountId: string | null; review: boolean; excluded: boolean }>();
  const clientsByBranch = new Map<string, string[]>();
  for (const client of clients) {
    const ids = clientsByBranch.get(client.branchId) ?? [];
    ids.push(client.id);
    clientsByBranch.set(client.branchId, ids);
  }
  for (const [branchId, ids] of clientsByBranch) {
    await runWithBranchApiTargetContext(context, branchId, async () => {
      for (let i = 0; i < ids.length; i += 1000) {
        const rows = await prisma.loyaltyLink.findMany({
          where: { branchId, businessGroupId: scope.businessGroupId, counterpartyId: { in: ids.slice(i, i + 1000) } },
        });
        rows.forEach((row) => links.set(row.counterpartyId, row));
      }
    });
  }
  for (let i = 0; i < phones.length; i += 1000) {
    const rows = await prisma.loyaltyAccount.findMany({ where: { businessGroupId: scope.businessGroupId, phoneKey: { in: phones.slice(i, i + 1000) } },
      select: { id: true, phoneKey: true, nameKey: true } });
    for (const row of rows) accounts.set(row.phoneKey, [...accounts.get(row.phoneKey) ?? [], row]);
  }
  const namesByPhone = new Map<string, Set<string>>();
  for (const identity of identities.values()) {
    if (!identity?.phoneKey) continue;
    const names = namesByPhone.get(identity.phoneKey) ?? new Set();
    names.add(identity.nameKey);
    namesByPhone.set(identity.phoneKey, names);
  }
  const seen = new Set<string>();
  const recipients = clients.map((client) => {
    const identity = identities.get(client.id);
    const link = links.get(client.id);
    let error: string | null = null;
    const accountId = link?.accountId ?? null;
    let unique = accountId;
    if (!identity || link?.excluded) error = "Карточка не участвует в программе";
    else if (!accountId) {
      if (!identity.phoneKey || identity.nameKey.split(" ").length < 2) error = "В карточке нужны телефон и ФИО";
      else {
        const matches = accounts.get(identity.phoneKey) ?? [];
        if (link?.review || (namesByPhone.get(identity.phoneKey)?.size ?? 0) > 1 || (matches.length && matches.filter((row) => row.nameKey === identity.nameKey).length !== 1)) {
          error = "Совпадение требует проверки управляющим";
        } else if (matches.length) error = "Требуется подтверждение привязки счёта";
        else unique = requestDigest([identity.phoneKey, identity.nameKey]);
      }
    }
    if (!error && unique && seen.has(unique)) error = "Этот бонусный счёт уже включён в акцию";
    if (!error && unique) seen.add(unique);
    return { counterpartyId: client.id, branchId: client.branchId, accountId, status: error ? "skipped" : "pending", error };
  });
  await prisma.$transaction(async (tx) => {
    await loyaltyLock(tx, `loyalty:campaign:${input.id}`);
    const current = await tx.loyaltyCampaign.findUnique({ where: { id: input.id } });
    if (current) {
      if (current.branchId !== scope.branchId || current.businessGroupId !== scope.businessGroupId
        || (current.filters as { signature?: string }).signature !== signature) throw new LoyaltyError("Ключ предпросмотра уже использован");
      return;
    }
    await tx.loyaltyCampaign.create({ data: {
      id: input.id, ...scope, points: input.points, reason: input.reason, expiresAt,
      filters: { ...input.filters, mode: input.mode, serviceDate: input.serviceDate, signature },
    } });
    const rows: Prisma.LoyaltyCampaignRecipientCreateManyInput[] = [...recipients, ...missing]
      .map((row) => ({ ...row, campaignId: input.id }));
    for (let offset = 0; offset < rows.length; offset += 1000) {
      await tx.loyaltyCampaignRecipient.createMany({ data: rows.slice(offset, offset + 1000) });
    }
  }, { timeout: 30_000 });
  return summarize(context, input.id);
}

async function runCampaign(context: BranchContext, id: string, errorCursor?: string) {
  const scope = loyaltyScope(context);
  const campaign = await prisma.loyaltyCampaign.findFirst({ where: { id, businessGroupId: scope.businessGroupId, branchId: scope.branchId } });
  if (!campaign) throw new LoyaltyError("Акция не найдена в текущем филиале", 404);
  if (!(await loyaltyProgram(prisma, scope.businessGroupId)).enabled) throw new LoyaltyError("Программа лояльности отключена");
  await prisma.loyaltyCampaign.updateMany({ where: { id, confirmedAt: null }, data: { confirmedAt: new Date() } });
  const batchSize = 30;
  const pending = errorCursor ? [] : await prisma.loyaltyCampaignRecipient.findMany({
    where: { campaignId: id, status: "pending" }, take: batchSize, orderBy: { counterpartyId: "asc" },
  });
  const retries = pending.length ? [] : await prisma.loyaltyCampaignRecipient.findMany({
    where: { campaignId: id, status: "error", ...(errorCursor ? { counterpartyId: { gt: errorCursor } } : {}) },
    take: batchSize + 1, orderBy: { counterpartyId: "asc" },
  });
  const entries = pending.length ? pending : retries.slice(0, batchSize);
  for (const entry of entries) {
    const key = { campaignId: id, counterpartyId: entry.counterpartyId };
    const update = async (status: string, error: string) => prisma.loyaltyCampaignRecipient.updateMany({
      where: { ...key, status: { in: ["pending", "error"] } }, data: { status, error },
    });
    if (!context.branches.some((branch) => branch.id === entry.branchId && branch.status === "active")) {
      await update("skipped", "Филиал недоступен");
      continue;
    }
    try {
      await runWithBranchApiTargetContext(context, entry.branchId, () => prisma.$transaction(async (tx) => {
        await loyaltyLock(tx, `loyalty:recipient:${id}:${entry.counterpartyId}`);
        const where = { campaignId_counterpartyId: key };
        const row = await tx.loyaltyCampaignRecipient.findUniqueOrThrow({ where });
        if (row.status !== "pending" && row.status !== "error") return;
        const skip = (error: string) => tx.loyaltyCampaignRecipient.update({ where, data: { status: "skipped", error } });
        const client = await tx.localCounterparty.findFirst({ where: { branchId: entry.branchId, id: entry.counterpartyId } });
        const recipientScope = { ...scope, branchId: entry.branchId };
        if (campaign.expiresAt && campaign.expiresAt <= new Date()) return skip("Срок акции истёк");
        const match = await inspectLoyaltyClient(tx, recipientScope, client, { mode: "campaign" });
        if (match.status !== "linked" || (entry.accountId && entry.accountId !== match.accountId)) {
          return skip("Бонусная привязка изменилась или требует подтверждения");
        }
        const { accountId } = match;
        await lockLoyaltyAccount(tx, recipientScope, accountId);
        const duplicate = await tx.loyaltyCampaignRecipient.findFirst({
          where: { campaignId: id, accountId, status: "done" }, select: { counterpartyId: true },
        });
        if (duplicate) return skip("Этот бонусный счёт уже получил начисление по акции");
        const now = new Date();
        await recordExpirations(tx, recipientScope, accountId, now);
        await grantLoyalty(tx, recipientScope, accountId, "CAMPAIGN", campaign.points,
          { campaignId: id, counterpartyId: entry.counterpartyId, reason: campaign.reason }, campaign.expiresAt, now);
        await tx.loyaltyCampaignRecipient.update({ where, data: { accountId, status: "done", error: null } });
      }));
    } catch (error) {
      console.error("[loyalty campaign recipient]", id, error);
      await update("error", "Начисление не подтверждено. Можно повторить обработку");
    }
  }
  return {
    ...await summarize(context, id),
    errorCursor: retries.length > batchSize ? entries.at(-1)?.counterpartyId : undefined,
  };
}

export function GET(request: Request) {
  return loyaltyApi("owner", async (context) => {
    const id = new URL(request.url).searchParams.get("id");
    if (id) return summarize(context, id);
    const scope = loyaltyScope(context);
    const campaigns = await prisma.loyaltyCampaign.findMany({
      where: { branchId: scope.branchId, businessGroupId: scope.businessGroupId },
      orderBy: { createdAt: "desc" }, take: 20, select: { id: true, reason: true, createdAt: true, confirmedAt: true },
    });
    return { enabled: (await loyaltyProgram(prisma, scope.businessGroupId)).enabled, campaigns };
  });
}

export function POST(request: Request) {
  return loyaltyApi("owner", async (context) => {
    const input = await loyaltyBody(request, schema);
    if (input.branchId !== context.branchId) throw new LoyaltyError("Активный филиал изменился. Обновите страницу.");
    return input.action === "preview" ? makePreview(context, input) : runCampaign(context, input.id, input.errorCursor);
  });
}
