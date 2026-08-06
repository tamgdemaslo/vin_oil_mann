import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/messenger/messenger-crypto";
import { getRequestTenant, getScopedBranchId } from "@/lib/request-tenant-store";
import { hasConsecutiveIntegrationFailures, notifyIntegrationOwner } from "@/lib/integration-owner-notifications";

export type AqsiResolvedConfig = {
  registerId: string;
  registerName: string;
  apiKey: string;
  markingBypassPassword?: string;
  baseUrl: string;
  ordersPath: string;
  pendingOrderPath: string;
  devicesPath: string;
  deviceId?: string;
  shopId?: string;
  cashierId?: string;
};

export type AqsiRegisterInput = {
  id?: string;
  name?: string;
  apiKey?: string;
  markingBypassPassword?: string;
  baseUrl?: string;
  ordersPath?: string;
  pendingOrderPath?: string;
  devicesPath?: string;
  deviceId?: string;
  shopId?: string;
  cashierId?: string;
  isDefault?: boolean;
  enabled?: boolean;
};

type SecretBundle = { apiKey?: string; markingBypassPassword?: string };

function tenantOrThrow() {
  const tenant = getRequestTenant();
  const branchId = getScopedBranchId();
  if (!tenant?.organizationId || !tenant.businessGroupId) throw new Error("Не определён контекст филиала для AQSI");
  return { branchId, organizationId: tenant.organizationId, businessGroupId: tenant.businessGroupId, userId: tenant.userId ?? null };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = "", max = 1_000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function optionalText(value: unknown, previous?: string) {
  if (value === undefined) return previous;
  return text(value) || undefined;
}

function decryptBundle(value: unknown): SecretBundle {
  const decrypted = decryptIntegrationSecret(value);
  if (!decrypted) return {};
  try {
    const parsed = JSON.parse(decrypted) as SecretBundle;
    return { apiKey: text(parsed.apiKey), markingBypassPassword: text(parsed.markingBypassPassword) };
  } catch {
    return {};
  }
}

function settingsFrom(value: unknown) {
  const row = object(value);
  return {
    baseUrl: text(row.baseUrl, "https://api.aqsi.ru/pub"),
    ordersPath: text(row.ordersPath, "/v2/Receipts"),
    pendingOrderPath: text(row.pendingOrderPath, "/v2/Orders/simple"),
    devicesPath: text(row.devicesPath, "/v1/Devices"),
    deviceId: text(row.deviceId) || undefined,
    shopId: text(row.shopId) || undefined,
    cashierId: text(row.cashierId) || undefined,
  };
}

async function audit(action: string, status: string, metadata: Record<string, unknown>) {
  const tenant = tenantOrThrow();
  await prisma.integrationAuditLog.create({
    data: {
      id: randomUUID(),
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      channel: "aqsi",
      actorId: tenant.userId,
      action,
      status,
      metadataJson: metadata as Prisma.InputJsonValue,
    },
  });
}

async function assertRegisterCanChange(registerId?: string) {
  const tenant = tenantOrThrow();
  const openShift = await prisma.cashShift.findFirst({
    where: {
      branchId: tenant.branchId,
      status: "open",
      ...(registerId ? { OR: [{ aqsiRegisterId: registerId }, { aqsiRegisterId: null }] } : {}),
    },
    select: { id: true },
  });
  if (openShift) throw new Error("Сначала закройте кассовую смену. После этого подключение можно изменить.");
}

export async function resolveAqsiCashRegister(registerId?: string | null): Promise<AqsiResolvedConfig> {
  const tenant = tenantOrThrow();
  const register = registerId
    ? await prisma.aqsiCashRegister.findFirst({ where: { id: registerId, branchId: tenant.branchId, organizationId: tenant.organizationId, enabled: true } })
    : await prisma.aqsiCashRegister.findFirst({
        where: { branchId: tenant.branchId, organizationId: tenant.organizationId, enabled: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      });
  if (!register) throw new Error("AQSI не настроен для текущего филиала");
  const secrets = decryptBundle(register.credentialsEncrypted);
  if (!secrets.apiKey) throw new Error("Ключ AQSI текущего филиала повреждён или отсутствует");
  return {
    registerId: register.id,
    registerName: register.name,
    apiKey: secrets.apiKey,
    markingBypassPassword: secrets.markingBypassPassword,
    ...settingsFrom(register.settingsJson),
  };
}

export async function getAqsiMarkingBypassPassword(registerId?: string | null) {
  return (await resolveAqsiCashRegister(registerId)).markingBypassPassword ?? null;
}

export async function getAqsiIntegrationStatus() {
  const tenant = tenantOrThrow();
  const rows = await prisma.aqsiCashRegister.findMany({
    where: { branchId: tenant.branchId, organizationId: tenant.organizationId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const pendingWhere = {
    branchId: tenant.branchId,
    organizationId: tenant.organizationId,
    status: { in: ["pending", "processing", "retry", "error"] },
  } satisfies Prisma.AqsiFiscalizationRecordWhereInput;
  const [pending, alerts] = await Promise.all([
    prisma.aqsiFiscalizationRecord.count({ where: pendingWhere }),
    prisma.aqsiFiscalizationRecord.findMany({
      where: { ...pendingWhere, errorMessage: { not: null } },
      orderBy: [{ updatedAt: "desc" }],
      take: 10,
      select: {
        id: true,
        documentId: true,
        status: true,
        attempts: true,
        errorCode: true,
        errorMessage: true,
        nextAttemptAt: true,
        updatedAt: true,
      },
    }),
  ]);
  return {
    configured: rows.some((row) => row.enabled && Boolean(decryptBundle(row.credentialsEncrypted).apiKey)),
    pendingFiscalizations: pending,
    alerts: alerts.map((row) => ({
      ...row,
      nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    })),
    registers: rows.map((row) => {
      const secrets = decryptBundle(row.credentialsEncrypted);
      return {
        id: row.id,
        name: row.name,
        enabled: row.enabled,
        isDefault: row.isDefault,
        apiKeyConfigured: Boolean(secrets.apiKey),
        markingBypassPasswordConfigured: Boolean(secrets.markingBypassPassword),
        ...settingsFrom(row.settingsJson),
        status: row.status,
        lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
        lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
        lastErrorCode: row.lastErrorCode,
        lastErrorMessage: row.lastErrorMessage,
        connectedAt: row.createdAt.toISOString(),
        createdById: row.createdById,
      };
    }),
  };
}

export async function saveAqsiCashRegister(input: AqsiRegisterInput, actorId?: string | null) {
  const tenant = tenantOrThrow();
  const requestedName = text(input.name, "Основная касса", 120);
  const existing = input.id
    ? await prisma.aqsiCashRegister.findFirst({ where: { id: input.id, branchId: tenant.branchId, organizationId: tenant.organizationId } })
    : await prisma.aqsiCashRegister.findFirst({ where: { branchId: tenant.branchId, organizationId: tenant.organizationId, name: requestedName } });
  if (input.id && !existing) throw new Error("Касса AQSI не найдена в текущем филиале");
  await assertRegisterCanChange(input.isDefault === true ? undefined : existing?.id);
  const previousSecrets = existing ? decryptBundle(existing.credentialsEncrypted) : {};
  const apiKey = text(input.apiKey, previousSecrets.apiKey);
  if (!apiKey) throw new Error("Введите API-ключ AQSI");
  const markingBypassPassword = text(input.markingBypassPassword, previousSecrets.markingBypassPassword);
  const previousSettings = settingsFrom(existing?.settingsJson);
  const settings = {
    baseUrl: text(input.baseUrl, previousSettings.baseUrl),
    ordersPath: text(input.ordersPath, previousSettings.ordersPath),
    pendingOrderPath: text(input.pendingOrderPath, previousSettings.pendingOrderPath),
    devicesPath: text(input.devicesPath, previousSettings.devicesPath),
    deviceId: optionalText(input.deviceId, previousSettings.deviceId),
    shopId: optionalText(input.shopId, previousSettings.shopId),
    cashierId: optionalText(input.cashierId, previousSettings.cashierId),
  };
  const id = existing?.id ?? randomUUID();
  const shouldDefault = input.isDefault ?? existing?.isDefault ?? !(await prisma.aqsiCashRegister.count({ where: { branchId: tenant.branchId, enabled: true } }));
  const nextEnabled = input.enabled ?? existing?.enabled ?? true;
  const secretChanged = Boolean(
    (input.apiKey?.trim() && input.apiKey.trim() !== previousSecrets.apiKey)
    || (input.markingBypassPassword?.trim() && input.markingBypassPassword.trim() !== previousSecrets.markingBypassPassword)
  );
  const defaultChanged = Boolean(existing && existing.isDefault !== shouldDefault);
  const changedFields = [
    !existing ? "created" : null,
    existing && existing.name !== requestedName ? "name" : null,
    secretChanged ? "credentials" : null,
    existing && JSON.stringify(previousSettings) !== JSON.stringify(settings) ? "settings" : null,
    defaultChanged ? "isDefault" : null,
    existing && existing.enabled !== nextEnabled ? "enabled" : null,
  ].filter((value): value is string => Boolean(value));
  const requiresRetest = changedFields.some((field) => ["created", "credentials", "settings", "enabled"].includes(field));
  if (existing?.isDefault && !shouldDefault && nextEnabled) {
    const anotherDefault = await prisma.aqsiCashRegister.findFirst({ where: { branchId: tenant.branchId, id: { not: id }, enabled: true, isDefault: true }, select: { id: true } });
    if (!anotherDefault) throw new Error("Сначала назначьте другую кассу AQSI основной");
  }
  await prisma.$transaction(async (tx) => {
    if (shouldDefault) await tx.aqsiCashRegister.updateMany({ where: { branchId: tenant.branchId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
    const data = {
      name: requestedName || existing?.name || "Основная касса",
      isDefault: shouldDefault,
      enabled: nextEnabled,
      credentialsEncrypted: encryptIntegrationSecret(JSON.stringify({ apiKey, ...(markingBypassPassword ? { markingBypassPassword } : {}) })),
      settingsJson: settings as Prisma.InputJsonValue,
      status: requiresRetest ? "not_tested" : existing?.status ?? "not_tested",
      ...(requiresRetest ? { lastErrorCode: null, lastErrorMessage: null } : {}),
      updatedById: actorId ?? tenant.userId,
    };
    if (existing) await tx.aqsiCashRegister.update({ where: { id }, data });
    else await tx.aqsiCashRegister.create({ data: { id, branchId: tenant.branchId, businessGroupId: tenant.businessGroupId, organizationId: tenant.organizationId, createdById: actorId ?? tenant.userId, ...data } });
  });
  await audit("aqsi_register_saved", "ok", {
    registerId: id,
    changedFields,
    secretChanged,
    oldStatus: existing?.status ?? "not_configured",
    newStatus: requiresRetest ? "not_tested" : existing?.status ?? "not_tested",
  });
  if (!existing) {
    await notifyIntegrationOwner({ channel: "aqsi", eventKey: "cash_register_connected", entityId: id, message: `Подключена новая касса AQSI «${requestedName}».`, throttleMinutes: 5 });
  }
  if (secretChanged && existing) {
    await notifyIntegrationOwner({ channel: "aqsi", eventKey: "credentials_replaced", entityId: id, message: `Заменены реквизиты кассы AQSI «${requestedName}».`, throttleMinutes: 5 });
  }
  if (defaultChanged) {
    await notifyIntegrationOwner({ channel: "aqsi", eventKey: "default_register_changed", entityId: id, message: `Изменена основная касса AQSI: «${requestedName}».`, throttleMinutes: 5 });
  }
  return getAqsiIntegrationStatus();
}

export async function disconnectAqsiCashRegister(registerId: string, actorId?: string | null) {
  const tenant = tenantOrThrow();
  await assertRegisterCanChange(registerId);
  const current = await prisma.aqsiCashRegister.findFirst({ where: { id: registerId, branchId: tenant.branchId, organizationId: tenant.organizationId }, select: { id: true, isDefault: true } });
  if (!current) throw new Error("Касса AQSI не найдена в текущем филиале");
  const replacement = current.isDefault
    ? await prisma.aqsiCashRegister.findFirst({ where: { branchId: tenant.branchId, organizationId: tenant.organizationId, enabled: true, id: { not: registerId } }, orderBy: [{ createdAt: "asc" }], select: { id: true } })
    : null;
  await prisma.aqsiCashRegister.updateMany({
    where: { id: registerId, branchId: tenant.branchId, organizationId: tenant.organizationId },
    data: { enabled: false, isDefault: false, status: "disabled", updatedById: actorId ?? tenant.userId },
  });
  if (replacement) await prisma.aqsiCashRegister.update({ where: { id: replacement.id }, data: { isDefault: true, updatedById: actorId ?? tenant.userId } });
  await audit("aqsi_register_disabled", "ok", { registerId, changedFields: ["enabled", "isDefault"], oldStatus: "connected", newStatus: "disabled" });
  await notifyIntegrationOwner({ channel: "aqsi", eventKey: "cash_register_disconnected", entityId: registerId, message: "Касса AQSI отключена. История операций сохранена.", throttleMinutes: 5 });
  return getAqsiIntegrationStatus();
}

export async function recordAqsiCheck(registerId: string, error?: { code: string; message: string } | null) {
  const tenant = tenantOrThrow();
  await prisma.aqsiCashRegister.updateMany({
    where: { id: registerId, branchId: tenant.branchId, organizationId: tenant.organizationId },
    data: error
      ? { status: "error", lastErrorAt: new Date(), lastErrorCode: error.code, lastErrorMessage: error.message }
      : { status: "connected", lastSuccessAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
  });
  await audit(error ? "aqsi_connection_failed" : "aqsi_connection_verified", error ? "error" : "ok", { registerId, code: error?.code ?? null });
  if (error) {
    const repeated = error.code === "AQSI_AUTH_FAILED" || await hasConsecutiveIntegrationFailures({
      channel: "aqsi",
      failureAction: "aqsi_connection_failed",
      successAction: "aqsi_connection_verified",
      count: 3,
    });
    if (repeated) await notifyIntegrationOwner({
      channel: "aqsi",
      eventKey: error.code === "AQSI_AUTH_FAILED" ? "authorization_rejected" : "repeated_connection_failure",
      entityId: registerId,
      message: error.code === "AQSI_AUTH_FAILED" ? "AQSI отклонила авторизацию кассы филиала." : "Три последовательные проверки AQSI завершились ошибкой.",
      throttleMinutes: 180,
    });
  }
}

export function safeAqsiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/(401|403|ключ|authoriz|auth)/i.test(message)) return { code: "AQSI_AUTH_FAILED", message: "AQSI не принял ключ этой кассы" };
  if (/timeout|fetch|connect|network/i.test(message)) return { code: "AQSI_TEMPORARILY_UNAVAILABLE", message: "AQSI временно недоступен" };
  if (/(устройств|device|несколько устройств)/i.test(message)) return { code: "AQSI_DEVICE_REQUIRED", message: "Выберите устройство AQSI для этой кассы" };
  return { code: "AQSI_CHECK_FAILED", message: "Проверка AQSI не выполнена. Проверьте настройки кассы." };
}
