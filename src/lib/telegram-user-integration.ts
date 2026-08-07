import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveBranchIntegration, IntegrationNotConfiguredForBranch } from "@/lib/branch-integration-credentials";
import { assertIntegrationEncryptionConfigured, encryptIntegrationSecret } from "@/lib/messenger/messenger-crypto";
import { getRequestTenant, getScopedBranchId } from "@/lib/request-tenant-store";
import { notifyIntegrationOwner } from "@/lib/integration-owner-notifications";

const CHANNEL = "telegram_user";
const KEYS = ["apiId", "apiHash"] as const;

function tenantOrThrow() {
  const tenant = getRequestTenant();
  const branchId = getScopedBranchId();
  if (!tenant?.organizationId || !tenant.businessGroupId) throw new Error("Не определён контекст филиала для Telegram");
  return { branchId, organizationId: tenant.organizationId, businessGroupId: tenant.businessGroupId, userId: tenant.userId ?? null };
}

async function audit(action: string, status: string, metadata: Record<string, unknown>) {
  const tenant = tenantOrThrow();
  await prisma.integrationAuditLog.create({
    data: {
      id: randomUUID(),
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      channel: CHANNEL,
      actorId: tenant.userId,
      action,
      status,
      metadataJson: metadata as Prisma.InputJsonValue,
    },
  });
}

export async function resolveTelegramUserCredentials() {
  const resolved = await resolveBranchIntegration(CHANNEL, KEYS, KEYS);
  const apiId = Number(resolved.values.apiId);
  if (!Number.isInteger(apiId) || apiId <= 0 || !resolved.values.apiHash) {
    throw new IntegrationNotConfiguredForBranch(CHANNEL, [...KEYS]);
  }
  return { apiId, apiHash: resolved.values.apiHash };
}

async function currentValues() {
  try {
    return (await resolveBranchIntegration(CHANNEL, KEYS, [])).values;
  } catch {
    return {} as Record<string, string>;
  }
}

export async function getTelegramUserIntegrationStatus() {
  const tenant = tenantOrThrow();
  const values = await currentValues();
  const account = await prisma.messengerAccount.findFirst({
    where: { branchId: tenant.branchId, organizationId: tenant.organizationId, channel: "telegram", mode: "user_session" },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    select: { id: true, displayName: true, phone: true, username: true, status: true, lastSyncAt: true, errorCode: true, errorMessage: true, updatedAt: true },
  });
  const configured = Boolean(values.apiId && values.apiHash);
  return {
    configured,
    apiIdConfigured: Boolean(values.apiId),
    apiHashConfigured: Boolean(values.apiHash),
    status: !configured ? "not_configured" : account?.status ?? "not_connected",
    account: account ? {
      id: account.id,
      displayName: account.displayName,
      phoneMasked: account.phone ? `***${account.phone.replace(/\D/g, "").slice(-4)}` : null,
      username: account.username,
      status: account.status,
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
      lastErrorCode: account.errorCode,
      lastError: account.errorMessage ? (account.status === "needs_auth" ? "Требуется повторное подключение" : "Telegram требует проверки") : null,
      updatedAt: account.updatedAt.toISOString(),
    } : null,
  };
}

async function saveValue(key: (typeof KEYS)[number], value: string, actorId?: string | null) {
  const tenant = tenantOrThrow();
  const existing = await prisma.integrationCredential.findFirst({
    where: { branchId: tenant.branchId, organizationId: tenant.organizationId, businessGroupId: tenant.businessGroupId, channel: CHANNEL, key },
    orderBy: [{ rotatedAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  const data = {
    encryptedValue: encryptIntegrationSecret(value),
    metadataJson: { provider: "Telegram", credentialType: "secret", mode: "user_session" } as Prisma.InputJsonValue,
    status: "active",
    lastErrorCode: null,
    createdById: actorId ?? tenant.userId,
    rotatedAt: new Date(),
  };
  if (existing) return prisma.integrationCredential.update({ where: { id: existing.id }, data });
  return prisma.integrationCredential.create({
    data: {
      id: randomUUID(),
      branchId: tenant.branchId,
      businessGroupId: tenant.businessGroupId,
      organizationId: tenant.organizationId,
      channel: CHANNEL,
      key,
      ...data,
    },
  });
}

/** Пустые поля не стирают сохранённые секреты. */
export async function saveTelegramUserIntegration(input: { apiId?: string; apiHash?: string }, actorId?: string | null) {
  assertIntegrationEncryptionConfigured();
  const before = await currentValues();
  const apiId = input.apiId?.trim() ?? "";
  const apiHash = input.apiHash?.trim() ?? "";
  if (apiId && (!/^\d+$/.test(apiId) || Number(apiId) <= 0)) throw new Error("API ID Telegram должен быть положительным числом");
  if (apiHash && apiHash.length < 16) throw new Error("Проверьте API Hash Telegram");
  const changed: string[] = [];
  if (apiId) { await saveValue("apiId", apiId, actorId); changed.push("apiId"); }
  if (apiHash) { await saveValue("apiHash", apiHash, actorId); changed.push("apiHash"); }
  const after = await currentValues();
  if (!after.apiId || !after.apiHash) throw new Error("Сохраните API ID и API Hash Telegram");
  const credentialsChanged = changed.some((key) => before[key] && before[key] !== after[key]);
  if (credentialsChanged) {
    const tenant = tenantOrThrow();
    await prisma.messengerAccount.updateMany({
      where: { branchId: tenant.branchId, organizationId: tenant.organizationId, channel: "telegram", mode: "user_session", status: "connected" },
      data: { status: "needs_auth", errorCode: "credentials_rotated", errorMessage: "Требуется повторное подключение после смены API-реквизитов" },
    });
    await prisma.telegramUserSession.updateMany({
      where: { branchId: tenant.branchId, organizationId: tenant.organizationId, status: "connected" },
      data: { status: "needs_auth", errorMessage: "Требуется повторное подключение" },
    });
  }
  await audit("telegram_user_settings_saved", "ok", { changedKeys: changed, credentialsChanged });
  if (changed.length) await notifyIntegrationOwner({
    channel: CHANNEL,
    eventKey: credentialsChanged ? "credentials_replaced" : "credentials_saved",
    message: credentialsChanged ? "Заменены API-реквизиты рабочего Telegram филиала." : "Сохранены API-реквизиты рабочего Telegram филиала.",
    throttleMinutes: 5,
  });
  if (credentialsChanged) await notifyIntegrationOwner({
    channel: CHANNEL,
    eventKey: "reauthorization_required",
    message: "Рабочему Telegram требуется повторная авторизация после замены API-реквизитов.",
    throttleMinutes: 60,
  });
  return getTelegramUserIntegrationStatus();
}

export async function disconnectTelegramUserCredentials(actorId?: string | null) {
  const tenant = tenantOrThrow();
  await prisma.integrationCredential.updateMany({
    where: { branchId: tenant.branchId, organizationId: tenant.organizationId, businessGroupId: tenant.businessGroupId, channel: CHANNEL, status: "active" },
    data: { status: "inactive", createdById: actorId ?? tenant.userId },
  });
  await audit("telegram_user_credentials_disabled", "ok", {});
  await notifyIntegrationOwner({ channel: CHANNEL, eventKey: "credentials_disabled", message: "Реквизиты рабочего Telegram отключены. История переписки сохранена.", throttleMinutes: 5 });
  return getTelegramUserIntegrationStatus();
}
