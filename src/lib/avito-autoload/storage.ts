import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getRequestTenant, getScopedBranchId, runWithRequestTenant } from "@/lib/request-tenant-store";
import { assertIntegrationEncryptionConfigured, decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/messenger/messenger-crypto";
import type { AvitoConnection, AvitoSettings } from "./types";
import { normalizeAvitoSettings } from "./domain";
import { avitoBranchAddress } from "./content";

export const AVITO_CHANNEL = "avito_autoload";
export type AvitoScope = { branchId: string; organizationId: string; businessGroupId: string; userId: string | null };
export type StoredAvitoProfile = { version: 1; settings: AvitoSettings; feedToken: string; connection: AvitoConnection };
export type AvitoSnapshot = { createdAt: string; adIds: string[]; productIds: string[]; photoIds: string[] };

export function resolveAvitoProfile(profile: StoredAvitoProfile, branch: { address: string | null; name: string; shortName: string }) {
  const settings = normalizeAvitoSettings(profile.settings);
  if (settings.addressSource === "branch") settings.address = avitoBranchAddress(branch.address, branch.shortName || branch.name);
  return { ...profile, settings };
}

export function avitoScope(): AvitoScope {
  const tenant = getRequestTenant();
  const branchId = getScopedBranchId();
  if (!tenant?.organizationId || !tenant.businessGroupId) throw new Error("Для Авито требуется точный контекст филиала");
  return { branchId, organizationId: tenant.organizationId, businessGroupId: tenant.businessGroupId, userId: tenant.userId ?? null };
}

export function avitoCredentialId(scope: AvitoScope, key: string) {
  return "avito_" + createHash("sha256").update(`${scope.businessGroupId}\0${scope.branchId}\0${scope.organizationId}\0${key}`).digest("hex");
}

export function avitoAdId(scope: Pick<AvitoScope, "branchId">, productId: string) {
  return "eco" + createHash("sha256").update(`${scope.branchId}\0${productId}`).digest("hex").slice(0, 40);
}

export function decodeAvitoValue<T>(payload: unknown): T | null {
  const plain = decryptIntegrationSecret(payload);
  if (!plain) return null;
  try { return JSON.parse(plain) as T; } catch { return null; }
}

export async function readAvitoValue<T>(scope: AvitoScope, key: string, db: Prisma.TransactionClient = prisma): Promise<T | null> {
  const row = await db.integrationCredential.findFirst({
    where: { id: avitoCredentialId(scope, key), branchId: scope.branchId, organizationId: scope.organizationId, businessGroupId: scope.businessGroupId, channel: AVITO_CHANNEL, key, status: "active" },
    select: { encryptedValue: true },
  });
  if (!row) return null;
  const value = decodeAvitoValue<T>(row.encryptedValue);
  if (value === null) throw new Error("Не удалось прочитать сохранённые настройки Авито");
  return value;
}

export async function writeAvitoValue(scope: AvitoScope, key: string, value: unknown, db: Prisma.TransactionClient = prisma) {
  assertIntegrationEncryptionConfigured();
  const encryptedValue = encryptIntegrationSecret(JSON.stringify(value)) as unknown as Prisma.InputJsonValue;
  const data = { encryptedValue, status: "active", rotatedAt: new Date(), lastErrorCode: null };
  await db.integrationCredential.upsert({
    where: { id: avitoCredentialId(scope, key), branchId: scope.branchId },
    create: { id: avitoCredentialId(scope, key), branchId: scope.branchId, organizationId: scope.organizationId, businessGroupId: scope.businessGroupId, channel: AVITO_CHANNEL, key, ...data, createdById: scope.userId, metadataJson: { module: AVITO_CHANNEL, version: 1 } },
    update: data,
  });
}

export async function avitoAudit(scope: AvitoScope, action: string, status: string, message: string, metadata: Record<string, unknown> = {}, db: Prisma.TransactionClient = prisma) {
  return db.integrationAuditLog.create({ data: {
    id: randomUUID(), branchId: scope.branchId, organizationId: scope.organizationId, channel: AVITO_CHANNEL,
    actorId: scope.userId, action, status, message: message.slice(0, 500), metadataJson: metadata as Prisma.InputJsonValue,
  } });
}

/** The token is authenticated encryption, bound to a saved branch profile. It carries no API credentials. */
export function newAvitoFeedToken(scope: AvitoScope) {
  return Buffer.from(JSON.stringify(encryptIntegrationSecret(JSON.stringify({
    branchId: scope.branchId, organizationId: scope.organizationId, businessGroupId: scope.businessGroupId, nonce: randomUUID(),
  })))).toString("base64url");
}

export async function withAvitoPublicProfile<T>(token: string, operation: (profile: StoredAvitoProfile, scope: AvitoScope) => Promise<T>): Promise<T | null> {
  if (!/^[A-Za-z0-9_-]{100,2000}$/.test(token)) return null;
  let scope: AvitoScope;
  try {
    const payload = decodeAvitoValue<Record<string, unknown>>(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
    if (!payload || ![payload.branchId, payload.organizationId, payload.businessGroupId, payload.nonce].every((value) => typeof value === "string" && value.length > 0 && value.length <= 200)) return null;
    scope = { branchId: payload.branchId as string, organizationId: payload.organizationId as string, businessGroupId: payload.businessGroupId as string, userId: null };
  } catch { return null; }
  return runWithRequestTenant({ ...scope, mode: "branch", allowedBranchIds: [scope.branchId] }, async () => {
    const [profile, branch] = await Promise.all([
      readAvitoValue<StoredAvitoProfile>(scope, "profile"),
      prisma.branch.findFirst({ where: { id: scope.branchId, businessGroupId: scope.businessGroupId, status: "active" }, select: { id: true, legacyOrganizationId: true, address: true, name: true, shortName: true } }),
    ]);
    if (!profile || profile.feedToken !== token || !branch || (branch.legacyOrganizationId ?? branch.id) !== scope.organizationId) return null;
    return operation(resolveAvitoProfile(profile, branch), scope);
  });
}
