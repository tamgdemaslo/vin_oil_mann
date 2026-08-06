#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { createJiti } from "jiti";
import { resolve } from "node:path";

const TARGET_BRANCH_NAME = "Дачная 6В";
const db = new PrismaClient();
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });

function source(name) {
  return process.env[name]?.trim() ?? "";
}

async function mark(branch, provider, status, lastErrorCode = null, metadata = {}) {
  await db.branchIntegrationMigration.upsert({
    where: { branchId_provider: { branchId: branch.id, provider } },
    create: {
      branchId: branch.id,
      organizationId: branch.legacyOrganizationId ?? branch.id,
      provider,
      source: "server_env",
      status,
      lastErrorCode,
      metadataJson: metadata,
      migratedAt: status === "ACTIVE_FROM_DATABASE" ? new Date() : null,
    },
    update: {
      status,
      lastErrorCode,
      metadataJson: metadata,
      migratedAt: status === "ACTIVE_FROM_DATABASE" ? new Date() : null,
    },
  });
}

async function runProvider(branch, provider, hasSource, operation) {
  if (!hasSource) {
    await mark(branch, provider, "NOT_STARTED", "SOURCE_NOT_PRESENT", { reason: "source_not_present" });
    return "NOT_STARTED";
  }
  try {
    const transition = (status, metadata = {}) => mark(branch, provider, status, null, metadata);
    const status = await operation(transition);
    await mark(branch, provider, "ACTIVE_FROM_DATABASE", null, { authorization: status, envFallback: false });
    return status;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : `${provider.toUpperCase()}_MIGRATION_FAILED`;
    await mark(branch, provider, "FAILED", code, { authorization: "FAIL", envFallback: false });
    return "FAIL";
  }
}

async function main() {
  const candidates = await db.branch.findMany({
    where: { status: "active", OR: [{ name: TARGET_BRANCH_NAME }, { shortName: TARGET_BRANCH_NAME }] },
    select: { id: true, name: true, shortName: true, businessGroupId: true, legacyOrganizationId: true },
  });
  if (candidates.length !== 1) throw new Error(`Ожидался ровно один активный филиал «${TARGET_BRANCH_NAME}»`);
  const branch = candidates[0];
  const tenant = {
    mode: "branch",
    branchId: branch.id,
    organizationId: branch.legacyOrganizationId ?? branch.id,
    allowedBranchIds: [branch.id],
    businessGroupId: branch.businessGroupId,
    userId: "system:integration-env-cutover",
    permissions: ["system_migration"],
  };

  const [tenantStore, aqsiIntegration, aqsiClient, telegramIntegration, rosskoIntegration, rosskoClient] = await Promise.all([
    jiti.import("../src/lib/request-tenant-store.ts"),
    jiti.import("../src/lib/aqsi-integration.ts"),
    jiti.import("../src/lib/aqsi.ts"),
    jiti.import("../src/lib/telegram-user-integration.ts"),
    jiti.import("../src/lib/rossko-integration.ts"),
    jiti.import("../src/lib/rossko.ts"),
  ]);

  const aqsiApiKey = source("AQSI_API_KEY");
  const telegramApiId = source("TELEGRAM_API_ID");
  const telegramApiHash = source("TELEGRAM_API_HASH");
  const rosskoKey1 = source("ROSSKO_KEY1");
  const rosskoKey2 = source("ROSSKO_KEY2");

  const aqsi = await runProvider(branch, "aqsi", Boolean(aqsiApiKey), (transition) => tenantStore.runWithRequestTenant(tenant, async () => {
    const saved = await aqsiIntegration.saveAqsiCashRegister({
      name: "Основная касса",
      apiKey: aqsiApiKey,
      markingBypassPassword: source("AQSI_MARKING_BYPASS_PASSWORD"),
      baseUrl: source("AQSI_BASE_URL") || undefined,
      ordersPath: source("AQSI_ORDERS_PATH") || undefined,
      pendingOrderPath: source("AQSI_PENDING_ORDER_PATH") || undefined,
      devicesPath: source("AQSI_DEVICES_PATH") || undefined,
      deviceId: source("AQSI_DEVICE_ID") || undefined,
      shopId: source("AQSI_SHOP_ID") || undefined,
      cashierId: source("AQSI_CASHIER_ID") || undefined,
      isDefault: true,
    }, tenant.userId);
    await transition("IMPORTED", { recordCreated: true });
    const register = saved.registers.find((row) => row.isDefault) ?? saved.registers[0];
    const config = await aqsiIntegration.resolveAqsiCashRegister(register?.id);
    await transition("VALIDATING", { registerId: config.registerId });
    const checked = await aqsiClient.validateAqsiConfig(config);
    if (!checked.binding) throw new Error("AQSI_DEVICE_REQUIRED");
    await aqsiIntegration.recordAqsiCheck(config.registerId, null);
    return "PASS";
  }));

  const telegram = await runProvider(branch, "telegram_user", Boolean(telegramApiId && telegramApiHash), (transition) => tenantStore.runWithRequestTenant(tenant, async () => {
    await telegramIntegration.saveTelegramUserIntegration({ apiId: telegramApiId, apiHash: telegramApiHash }, tenant.userId);
    await transition("IMPORTED", { recordCreated: true });
    await transition("VALIDATING", { mode: "user_session" });
    const status = await telegramIntegration.getTelegramUserIntegrationStatus();
    if (!status.configured) throw new Error("Telegram credentials were not persisted");
    return status.account?.status === "connected" ? "PASS" : "REAUTH_REQUIRED";
  }));

  const rossko = await runProvider(branch, "rossko", Boolean(rosskoKey1 && rosskoKey2), (transition) => tenantStore.runWithRequestTenant(tenant, async () => {
    await rosskoIntegration.saveRosskoIntegration({ key1: rosskoKey1, key2: rosskoKey2 }, tenant.userId);
    await transition("IMPORTED", { recordCreated: true });
    const config = await rosskoClient.rosskoConfig();
    await transition("VALIDATING", { contract: "GetCheckoutDetails" });
    await rosskoClient.rosskoCheckoutDetails(config);
    await rosskoIntegration.recordRosskoCheck(null);
    return "PASS";
  }));

  console.log(`branch=${TARGET_BRANCH_NAME}; aqsi=${aqsi}; telegram=${telegram}; rossko=${rossko}; env_fallback=OFF`);
  if ([aqsi, telegram, rossko].includes("FAIL")) process.exitCode = 1;
}

main()
  .catch(() => {
    console.log(`branch=${TARGET_BRANCH_NAME}; aqsi=NOT_RUN; telegram=NOT_RUN; rossko=NOT_RUN; env_fallback=OFF`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
