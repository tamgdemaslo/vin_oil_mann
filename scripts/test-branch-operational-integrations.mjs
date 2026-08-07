#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

function expect(file, patterns) {
  const source = read(file);
  for (const pattern of patterns) if (!pattern.test(source)) failures.push(`${file}: отсутствует ${pattern}`);
}

function reject(file, patterns) {
  const source = read(file);
  for (const pattern of patterns) if (pattern.test(source)) failures.push(`${file}: запрещено ${pattern}`);
}

for (const file of [
  "src/lib/aqsi.ts",
  "src/lib/aqsi-integration.ts",
  "src/lib/telegram-user-integration.ts",
  "src/lib/messenger/channels/telegram-user-session.ts",
  "src/lib/rossko.ts",
  "src/lib/rossko-integration.ts",
]) {
  reject(file, [/process\.env\.AQSI_/, /process\.env\.TELEGRAM_API_ID/, /process\.env\.TELEGRAM_API_HASH/, /process\.env\.TELEGRAM_USER_SESSION_ENABLED/, /process\.env\.ROSSKO_KEY/]);
}

for (const file of [".env.example", ".env.local.template"]) {
  reject(file, [/^\s*(?:#\s*)?(?:AQSI_|TELEGRAM_API_ID|TELEGRAM_API_HASH|TELEGRAM_USER_SESSION_ENABLED|ROSSKO_KEY)[A-Z0-9_]*\s*=/m]);
}

for (const entry of fs.readdirSync(path.join(root, "scripts"), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".mjs") || entry.name === "migrate-branch-integrations-from-env.mjs") continue;
  reject(`scripts/${entry.name}`, [
    /process\.env\.AQSI_[A-Z0-9_]+/,
    /process\.env\.(?:TELEGRAM_API_ID|TELEGRAM_API_HASH|TELEGRAM_USER_SESSION_ENABLED)/,
    /process\.env\.ROSSKO_KEY[12]/,
  ]);
}

expect("src/lib/branch-integration-credentials.ts", [
  /resolveBranchIntegration/,
  /businessGroupId:\s*scope\.businessGroupId/,
  /branch_context_mismatch/,
  /status:\s*"active"/,
]);
expect("src/lib/aqsi-fiscalization.ts", [
  /branchId_idempotencyKey/,
  /status:\s*"processing"/,
  /status:\s*"retry"/,
  /nextAttemptAt/,
  /aqsi_fiscalization_pending/,
  /safeResponseJson/,
  /notifyIntegrationOwner/,
]);
expect("src/app/api/cron/aqsi-fiscalization-retry/route.ts", [/runForActiveBranches/, /retryDueAqsiFiscalizations/, /CRON_SECRET/]);
expect("src/lib/aqsi-integration.ts", [/assertRegisterCanChange/, /status:\s*"open"/, /credentialsEncrypted/, /isDefault/]);
expect("src/lib/messenger/messenger-crypto.ts", [
  /INTEGRATION_STORAGE_NOT_CONFIGURED_CODE/,
  /IntegrationEncryptionConfigurationError/,
  /assertIntegrationEncryptionConfigured/,
  /MESSENGER_CREDENTIAL_ENCRYPTION_KEY/,
]);
expect("src/lib/aqsi.ts", [/validateAqsiConfig/, /resolveAqsiBinding/, /publicAqsiDevices/, /needsDevice/]);
expect("src/app/cabinet/integrations/OperationalIntegrationsPanel.tsx", [/alerts\.map/, /retryFiscalization/, /disconnectAqsi/, /Связь с сервером прервалась/, /Мастер настройки нового филиала/, /Уведомления и журнал изменений/]);
expect("src/lib/integration-access.ts", [/group_owner/, /group_admin/, /branch_owner/, /integrations\.manage/]);
expect("src/lib/integration-owner-notifications.ts", [/dedupeKey/, /throttleMinutes/, /recipientUserIds/, /listIntegrationActivity/]);
expect("src/app/api/integrations/activity/route.ts", [/canManageBranchIntegrationSecrets/, /listIntegrationActivity/]);
expect("src/lib/messenger/channels/telegram-user-session.ts", [
  /currentQrScope/,
  /QR session принадлежит другому филиалу или пользователю/,
  /deactivateOtherTelegramAccounts/,
  /resolveTelegramUserCredentials/,
  /process\.env\.MESSENGER_CREDENTIAL_ENCRYPTION_KEY/,
  /assertIntegrationEncryptionConfigured\(\)/,
]);

for (const route of [
  "src/app/api/integrations/aqsi/route.ts",
  "src/app/api/integrations/telegram-user/route.ts",
  "src/app/api/integrations/rossko/route.ts",
  "src/app/api/messenger/telegram-user/start-qr/route.ts",
]) {
  expect(route, [/INTEGRATION_STORAGE_NOT_CONFIGURED_CODE/, /status:\s*503/]);
}

for (const route of ["start-auth", "start-qr", "check-qr", "resend-code", "confirm-code", "confirm-password", "disconnect"]) {
  expect(`src/app/api/messenger/telegram-user/${route}/route.ts`, [/requireTelegramOwnerBranchApi/, /runWithBranchApiContext/]);
}

expect("prisma/schema.prisma", [
  /model AqsiCashRegister[\s\S]*@@unique\(\[branchId, id\]\)/,
  /model AqsiFiscalizationRecord[\s\S]*@@unique\(\[branchId, idempotencyKey\]\)/,
  /model BranchIntegrationMigration[\s\S]*@@unique\(\[branchId, provider\]\)/,
  /aqsiRegister\s+AqsiCashRegister\?\s+@relation\(fields: \[branchId, aqsiRegisterId\]/,
  /externalReceiptNumber/,
  /safeResponseJson/,
  /status\s+String\s+@default\("NOT_STARTED"\)/,
]);
expect("prisma/migrations/20260806150000_branch_operational_integrations/migration.sql", [
  /migration_approval_required/,
  /approved-with-verified-timeweb-backup/,
  /one_default_per_branch/,
  /one_working_telegram_per_branch/,
  /telegram_user_branch_invariant_violation/,
]);
expect("scripts/migrate-branch-integrations-from-env.mjs", [
  /TARGET_BRANCH_NAME = "Дачная 6В"/,
  /runProvider\(branch, "aqsi"/,
  /runProvider\(branch, "telegram_user"/,
  /runProvider\(branch, "rossko"/,
  /env_fallback=OFF/,
  /ACTIVE_FROM_DATABASE/,
  /IMPORTED/,
  /VALIDATING/,
  /FAILED/,
]);
expect("src/lib/ai-assistant/tools.ts", [/rosskoConfig\(\)/, /rosskoSearch\(/]);
expect("src/app/api/rossko/order/route.ts", [/requireBranchApi/, /rosskoConfig\(\)/]);
expect("src/lib/ai-assistant/config.ts", [/OPENAI_API_KEY/]);
reject("src/lib/branches.ts", [/integrationCredential\.create/, /aqsiCashRegister\.create/, /telegramUserSession\.create/]);

// The integrations page also loads T-Bank. Its resolver uses getScopedBranchId,
// so every entry route must establish the same trusted branch context first.
for (const route of [
  "src/app/api/integrations/tbank/status/route.ts",
  "src/app/api/integrations/tbank/test/route.ts",
  "src/app/api/supplier-invoices/[id]/tbank/create-draft/route.ts",
  "src/app/api/supplier-invoices/[id]/tbank/payments/route.ts",
  "src/app/api/supplier-invoices/[id]/tbank/payments/[paymentId]/refresh-status/route.ts",
  "src/app/api/supplier-invoices/[id]/tbank/precheck/route.ts",
]) {
  expect(route, [/requireBranchApi/, /runWithBranchApiContext/]);
}

if (failures.length) {
  console.error(`Branch operational integration checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Branch operational integration checks passed (AQSI, Telegram user session, ROSSKO).");
