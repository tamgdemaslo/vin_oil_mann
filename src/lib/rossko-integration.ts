import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { assertIntegrationEncryptionConfigured, decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/messenger/messenger-crypto";
import { prisma } from "@/lib/db";
import { getRequestTenant, getScopedBranchId } from "@/lib/request-tenant-store";
import { IntegrationNotConfiguredForBranch } from "@/lib/branch-integration-credentials";
import { hasConsecutiveIntegrationFailures, notifyIntegrationOwner, recordIntegrationAudit } from "@/lib/integration-owner-notifications";
import { getAgentSettings } from "@/lib/ai-agent/settings";
import type { AIRosskoMarkupRule } from "@/lib/ai-agent/types";
import { classifyRosskoRuntimeFailure } from "@/lib/rossko-error-classification";
import { RosskoError } from "@/lib/rossko";

const ROSSKO_CHANNEL = "rossko";
const SECRET_KEYS = new Set(["key1", "key2"]);
/**
 * These settings all have an explicit counterpart in GetCheckout or GetSearch.
 * `profile` and `preferredStore` deliberately do not appear here: legacy values
 * stay encrypted in integration_credentials, but can no longer be read or
 * changed through the ROSSKO UI/API.
 */
const SETTING_KEYS = [
  "deliveryId",
  "addressId",
  "paymentId",
  "requisiteId",
  "contactName",
  "contactPhone",
  "contactComment",
  "deliveryParts",
  "offerPriority",
  "timeoutMs",
  "requestsPerSecond",
] as const;

type RosskoSettingKey = (typeof SETTING_KEYS)[number];
type RosskoCredentialKey = "key1" | "key2" | RosskoSettingKey;

export type RosskoIntegrationInput = Partial<Record<RosskoCredentialKey, string>>;

export type RosskoIntegrationStatus = {
  configured: boolean;
  connected: boolean;
  key1Configured: boolean;
  key2Configured: boolean;
  key1Masked: string | null;
  key2Masked: string | null;
  deliveryId: string;
  addressId: string;
  paymentId: string;
  requisiteId: string;
  contactName: string;
  contactPhone: string;
  contactComment: string;
  deliveryParts: boolean;
  offerPriority: "optimal" | "fastest" | "lowest_price" | "local_stock";
  timeoutMs: string;
  requestsPerSecond: string;
  markupRules: AIRosskoMarkupRule[];
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastCheckStatus: "never" | "ok" | "error";
  lastErrorCode: string | null;
};

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function tenantOrThrow() {
  const branchId = getScopedBranchId();
  const tenant = getRequestTenant();
  if (!tenant?.organizationId || !tenant.businessGroupId) throw new Error("Не определён контекст филиала для ROSSKO");
  return { branchId, organizationId: tenant.organizationId, businessGroupId: tenant.businessGroupId, userId: tenant.userId ?? null };
}

async function rowsForCurrentBranch() {
  const { branchId, organizationId } = tenantOrThrow();
  return prisma.integrationCredential.findMany({
    where: { branchId, organizationId, channel: ROSSKO_CHANNEL },
    orderBy: [{ rotatedAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true, key: true, encryptedValue: true, status: true, lastValidatedAt: true, lastErrorCode: true, updatedAt: true },
  });
}

function latestValues(rows: Awaited<ReturnType<typeof rowsForCurrentBranch>>) {
  const values: Record<string, string> = {};
  for (const row of rows) {
    if (row.status !== "active" || values[row.key] !== undefined) continue;
    const value = decryptIntegrationSecret(row.encryptedValue);
    if (value) values[row.key] = value;
  }
  return values;
}

export async function getRosskoIntegrationStatus(): Promise<RosskoIntegrationStatus> {
  const tenant = tenantOrThrow();
  const [rows, agentSettings] = await Promise.all([
    rowsForCurrentBranch(),
    getAgentSettings(tenant.organizationId),
  ]);
  const values = latestValues(rows);
  const activeRows = rows.filter((row) => row.status === "active");
  const validated = activeRows.map((row) => row.lastValidatedAt).filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const lastErrorCode = activeRows.find((row) => row.lastErrorCode)?.lastErrorCode ?? null;
  const key1Configured = Boolean(values.key1);
  const key2Configured = Boolean(values.key2);
  const configured = key1Configured && key2Configured;
  const [lastSuccess, lastFailure] = await Promise.all([
    prisma.integrationAuditLog.findFirst({
      where: { branchId: tenant.branchId, organizationId: tenant.organizationId, channel: ROSSKO_CHANNEL, action: "rossko_connection_verified" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.integrationAuditLog.findFirst({
      where: { branchId: tenant.branchId, organizationId: tenant.organizationId, channel: ROSSKO_CHANNEL, action: "rossko_connection_failed" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    configured,
    connected: configured && !lastErrorCode,
    key1Configured,
    key2Configured,
    key1Masked: key1Configured ? "••••••••" : null,
    key2Masked: key2Configured ? "••••••••" : null,
    deliveryId: values.deliveryId ?? "",
    addressId: values.addressId ?? "",
    paymentId: values.paymentId ?? "",
    requisiteId: values.requisiteId ?? "",
    contactName: values.contactName ?? "",
    contactPhone: values.contactPhone ?? "",
    contactComment: values.contactComment ?? "",
    deliveryParts: !["0", "false", "no"].includes((values.deliveryParts ?? "true").toLowerCase()),
    offerPriority: parseOfferPriority(values.offerPriority),
    timeoutMs: values.timeoutMs ?? "20000",
    requestsPerSecond: values.requestsPerSecond ?? "4",
    markupRules: agentSettings.rosskoMarkupRules,
    lastCheckedAt: validated?.toISOString() ?? null,
    lastSuccessAt: lastSuccess?.createdAt.toISOString() ?? null,
    lastErrorAt: lastFailure?.createdAt.toISOString() ?? null,
    lastErrorMessage: lastErrorCode ? (lastErrorCode === "ROSSKO_AUTH_FAILED" ? "ROSSKO отклонил авторизацию филиала" : "Проверка ROSSKO завершилась ошибкой") : null,
    lastCheckStatus: !validated ? "never" : lastErrorCode ? "error" : "ok",
    lastErrorCode,
  };
}

export async function saveRosskoMarkupRules(rules: AIRosskoMarkupRule[], actorId?: string | null) {
  const tenant = tenantOrThrow();
  await prisma.aIAgentSetting.upsert({
    where: { branchId_organizationId: { branchId: tenant.branchId, organizationId: tenant.organizationId } },
    update: { rosskoMarkupRulesJson: rules as unknown as Prisma.InputJsonValue, updatedById: actorId ?? tenant.userId },
    create: {
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      rosskoMarkupRulesJson: rules as unknown as Prisma.InputJsonValue,
      createdById: actorId ?? tenant.userId,
      updatedById: actorId ?? tenant.userId,
    },
  });
  await audit("rossko_markup_rules_saved", { changedFields: ["rosskoMarkupRules"], ruleCount: rules.length });
  return getRosskoIntegrationStatus();
}

function parseOfferPriority(value: string | undefined): RosskoIntegrationStatus["offerPriority"] {
  if (value === "fastest" || value === "lowest_price" || value === "local_stock") return value;
  return "optimal";
}

async function audit(action: string, metadata: Record<string, unknown>) {
  await recordIntegrationAudit({
    channel: ROSSKO_CHANNEL,
    action,
    status: action.endsWith("_failed") ? "error" : "ok",
    metadata,
  });
}

async function saveValue(key: RosskoCredentialKey, value: string, actorId?: string | null) {
  const tenant = tenantOrThrow();
  const existing = await prisma.integrationCredential.findFirst({
    where: { branchId: tenant.branchId, organizationId: tenant.organizationId, channel: ROSSKO_CHANNEL, key },
    orderBy: [{ rotatedAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  const data = {
    encryptedValue: encryptIntegrationSecret(value),
    metadataJson: { provider: "ROSSKO", credentialType: SECRET_KEYS.has(key) ? "secret" : "setting" } as Prisma.InputJsonValue,
    status: "active",
    lastErrorCode: null,
    createdById: actorId ?? tenant.userId,
    rotatedAt: new Date(),
  };
  if (existing) {
    await prisma.integrationCredential.update({ where: { id: existing.id }, data });
    return "updated" as const;
  }
  await prisma.integrationCredential.create({
    data: {
      id: randomUUID(),
      branchId: tenant.branchId,
      businessGroupId: tenant.businessGroupId,
      organizationId: tenant.organizationId,
      channel: ROSSKO_CHANNEL,
      key,
      ...data,
    },
  });
  return "created" as const;
}

/** Blank key fields mean "keep the existing encrypted key", never erase it. */
export async function saveRosskoIntegration(input: RosskoIntegrationInput, actorId?: string | null) {
  assertIntegrationEncryptionConfigured();
  const saved: Array<{ key: RosskoCredentialKey; result: "created" | "updated" }> = [];
  for (const key of ["key1", "key2", ...SETTING_KEYS] as RosskoCredentialKey[]) {
    const value = text(input[key], key.startsWith("key") ? 1_000 : 500);
    if (!value) continue;
    saved.push({ key, result: await saveValue(key, value, actorId) });
  }
  await audit("rossko_settings_saved", { changedKeys: saved.map((item) => item.key), secretKeysChanged: saved.filter((item) => SECRET_KEYS.has(item.key)).map((item) => item.key) });
  const secretKeysChanged = saved.filter((item) => SECRET_KEYS.has(item.key));
  if (secretKeysChanged.length) await notifyIntegrationOwner({
    channel: ROSSKO_CHANNEL,
    eventKey: secretKeysChanged.some((item) => item.result === "updated") ? "credentials_replaced" : "credentials_saved",
    message: secretKeysChanged.some((item) => item.result === "updated") ? "Заменены credentials ROSSKO филиала." : "Сохранены credentials ROSSKO филиала.",
    throttleMinutes: 5,
  });
  return { status: await getRosskoIntegrationStatus(), saved };
}

export async function disconnectRosskoIntegration(actorId?: string | null) {
  const tenant = tenantOrThrow();
  const result = await prisma.integrationCredential.updateMany({
    where: { branchId: tenant.branchId, organizationId: tenant.organizationId, channel: ROSSKO_CHANNEL, status: "active" },
    data: { status: "inactive", lastErrorCode: null, createdById: actorId ?? tenant.userId },
  });
  await audit("rossko_disconnected", { credentialsDeactivated: result.count });
  await notifyIntegrationOwner({ channel: ROSSKO_CHANNEL, eventKey: "disconnected", message: "ROSSKO отключён для филиала.", throttleMinutes: 5 });
  return getRosskoIntegrationStatus();
}

export async function recordRosskoCheck(code: string | null) {
  const tenant = tenantOrThrow();
  await prisma.integrationCredential.updateMany({
    where: { branchId: tenant.branchId, organizationId: tenant.organizationId, channel: ROSSKO_CHANNEL, status: "active" },
    data: { lastValidatedAt: new Date(), lastErrorCode: code },
  });
  await audit(code ? "rossko_connection_failed" : "rossko_connection_verified", { result: code ? "failed" : "passed", code });
  if (code) {
    const repeated = code === "ROSSKO_AUTH_FAILED" || await hasConsecutiveIntegrationFailures({
      channel: ROSSKO_CHANNEL,
      failureAction: "rossko_connection_failed",
      successAction: "rossko_connection_verified",
      count: 3,
    });
    if (repeated) await notifyIntegrationOwner({
      channel: ROSSKO_CHANNEL,
      eventKey: code === "ROSSKO_AUTH_FAILED" ? "authorization_rejected" : "repeated_connection_failure",
      message: code === "ROSSKO_AUTH_FAILED" ? "ROSSKO отклонил авторизацию филиала." : "Три последовательные проверки ROSSKO завершились ошибкой.",
      throttleMinutes: 180,
    });
  }
  return getRosskoIntegrationStatus();
}

export function rosskoIntegrationError(error: unknown, operation: "search" | "check" | "request" = "request") {
  if (error instanceof IntegrationNotConfiguredForBranch) {
    return { code: "ROSSKO_NOT_CONFIGURED", error: "Добавьте оба ключа ROSSKO для этого филиала." };
  }
  const failure = classifyRosskoRuntimeFailure(error, { operation, providerError: error instanceof RosskoError });
  console.error("[rossko.integration] request failed", { code: failure.code, diagnostic: failure.diagnosticMessage });
  return { code: failure.code, error: failure.publicMessage };
}
