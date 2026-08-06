import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getRequestTenant, getScopedBranchId } from "@/lib/request-tenant-store";

const CHANNELS = ["aqsi", "telegram_user", "rossko"];

function tenantOrThrow() {
  const tenant = getRequestTenant();
  const branchId = getScopedBranchId();
  if (!tenant?.organizationId || !tenant.businessGroupId) throw new Error("Не определён контекст филиала для уведомления");
  return { branchId, organizationId: tenant.organizationId, businessGroupId: tenant.businessGroupId, userId: tenant.userId ?? null };
}

function record(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function recordIntegrationAudit(input: {
  channel: "aqsi" | "telegram_user" | "rossko";
  action: string;
  status?: string;
  message?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const tenant = tenantOrThrow();
  return prisma.integrationAuditLog.create({
    data: {
      id: randomUUID(),
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      channel: input.channel,
      actorId: input.actorId ?? tenant.userId,
      action: input.action,
      status: input.status ?? "ok",
      message: input.message?.slice(0, 500) ?? null,
      metadataJson: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/**
 * Внутреннее филиальное уведомление хранится рядом с неизменяемым integration audit.
 * Оно адресуется владельцам бизнес-группы, дедуплицируется и не содержит provider payload.
 */
export async function notifyIntegrationOwner(input: {
  channel: "aqsi" | "telegram_user" | "rossko";
  eventKey: string;
  message: string;
  entityId?: string | null;
  throttleMinutes?: number;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  const tenant = tenantOrThrow();
  const dedupeKey = `${input.eventKey}:${input.entityId ?? "branch"}`;
  const cutoff = new Date(Date.now() - Math.max(1, input.throttleMinutes ?? 60) * 60_000);
  const recent = await prisma.integrationAuditLog.findMany({
    where: {
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      channel: input.channel,
      action: "owner_notification",
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, metadataJson: true },
  });
  if (recent.some((row) => record(row.metadataJson).dedupeKey === dedupeKey)) return { created: false as const, id: recent[0]?.id ?? null };

  const owners = await prisma.businessGroupMembership.findMany({
    where: { businessGroupId: tenant.businessGroupId, role: "group_owner", status: "active" },
    select: { userId: true },
  });
  const id = randomUUID();
  await prisma.integrationAuditLog.create({
    data: {
      id,
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      channel: input.channel,
      actorId: tenant.userId,
      action: "owner_notification",
      status: "notice",
      message: input.message.slice(0, 500),
      metadataJson: {
        eventKey: input.eventKey,
        dedupeKey,
        entityId: input.entityId ?? null,
        recipientUserIds: owners.map((owner) => owner.userId),
        ...(input.metadata ?? {}),
      } as Prisma.InputJsonValue,
    },
  });
  return { created: true as const, id };
}

export async function hasConsecutiveIntegrationFailures(input: {
  channel: "aqsi" | "telegram_user" | "rossko";
  failureAction: string;
  successAction: string;
  count?: number;
}) {
  const tenant = tenantOrThrow();
  const count = Math.max(2, input.count ?? 3);
  const rows = await prisma.integrationAuditLog.findMany({
    where: {
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      channel: input.channel,
      action: { in: [input.failureAction, input.successAction] },
    },
    orderBy: { createdAt: "desc" },
    take: count,
    select: { action: true },
  });
  return rows.length >= count && rows.every((row) => row.action === input.failureAction);
}

export async function listIntegrationActivity(limit = 50) {
  const tenant = tenantOrThrow();
  const rows = await prisma.integrationAuditLog.findMany({
    where: {
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      channel: { in: CHANNELS },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
    select: { id: true, channel: true, actorId: true, action: true, status: true, message: true, metadataJson: true, createdAt: true },
  });
  const actorIds = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    action: row.action,
    status: row.status,
    message: row.message,
    metadata: record(row.metadataJson),
    actorName: row.actorId ? actorNames.get(row.actorId) ?? (row.actorId.startsWith("system:") ? "Система" : "Пользователь") : "Система",
    createdAt: row.createdAt.toISOString(),
  }));
}
