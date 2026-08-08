import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

function requireText(file, patterns) {
  const source = read(file);
  for (const pattern of patterns) {
    if (!pattern.test(source)) failures.push(`${file}: отсутствует ${pattern}`);
  }
}

const schema = read("prisma/schema.prisma");
const requiredScopedModels = [
  "Shift",
  "PayrollPayment",
  "LocalCounterparty",
  "LocalProduct",
  "LocalStore",
  "LocalStockBalance",
  "LocalDemand",
  "ShipmentRevision",
  "Diagnostic",
  "DiagnosticMapSession",
  "CrmDeal",
  "CashShift",
  "CashExpenseOrder",
  "AIAssistantThread",
  "AIAssistantMessage",
  "AIServiceQuote",
  "VehicleLookupCache",
  "MessengerConversation",
  "MessengerMessage",
  "MessengerAttachment",
  "MessengerOutbox",
  "MessengerMediaJob",
  "TelegramUserSession",
  "BranchIntegrationMigration",
  "AqsiCashRegister",
  "AqsiFiscalizationRecord",
  "InventorySession",
  "InventoryLedgerEntry",
  "LocalInventoryDocument",
  "LocalSupplierInvoice",
];

for (const model of requiredScopedModels) {
  const body = schema.match(new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"))?.[1] ?? "";
  if (!body) failures.push(`Prisma: модель ${model} не найдена`);
  else if (!/\bbranchId\s+String\b/.test(body)) failures.push(`Prisma: ${model} не содержит обязательный branchId`);
}

const dbSource = read("src/lib/db.ts");
for (const model of requiredScopedModels) {
  if (!dbSource.includes(`"${model}"`)) failures.push(`Prisma guard: модель ${model} не включена в BRANCH_SCOPED_MODELS`);
}

const controlPlaneModels = new Set([
  "BranchMembership",
  "BranchLegalEntity",
  "BranchCommunicationSettings",
  "BranchTelegramIntegration",
  "BranchAuditLog",
]);
for (const match of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
  const [, model, body] = match;
  if (/\bbranchId\s+String\?/.test(body) && !controlPlaneModels.has(model)) {
    failures.push(`Prisma: операционная модель ${model} допускает NULL branchId`);
  }
  if (/\bbranchId\s+String\b/.test(body) && !controlPlaneModels.has(model) && !dbSource.includes(`"${model}"`)) {
    failures.push(`Prisma guard: филиальная модель ${model} не защищена query policy`);
  }
}

requireText("src/lib/branch-context.ts", [
  /eco_active_branch/,
  /timingSafeEqual/,
  /branchMembership/,
  /branch_access_denied/,
  /concrete_branch_required/,
]);
requireText("src/lib/branches.ts", [/BRANCH_CREATION_ENABLED/, /Создание второго филиала заблокировано/]);
requireText("src/app/api/ai-assistant/threads/route.ts", [/branch:\s*\{\s*id:\s*access\.branchId,\s*name:\s*access\.branchName/]);
requireText("src/lib/db.ts", [
  /branch-isolation/,
  /BRANCH_SCOPED_MODELS/,
  /Попытка доступа к данным другого филиала/,
  /В режиме «Все филиалы» операции изменения запрещены/,
]);
requireText("src/lib/request-tenant.ts", [/timingSafeEqual/, /businessGroupMembership/, /branchMembership/]);
requireText("src/lib/request-tenant-store.ts", [/Branch context is required/, /runWithRequestTenant/]);
requireText("src/lib/external-side-effects.ts", [/branch-migration-rehearsal/, /EXTERNAL_SIDE_EFFECTS_ENABLED/]);
requireText("src/lib/branch-integration-credentials.ts", [/branch_credential_missing/, /IntegrationNotConfiguredForBranch/, /getScopedBranchId/]);
if (/LEGACY_INTEGRATION_BRANCH_ID|legacyIntegrationEnvAllowed/.test(read("src/lib/branch-integration-credentials.ts"))) {
  failures.push("src/lib/branch-integration-credentials.ts: legacy credential fallback запрещён");
}
requireText("src/proxy.ts", [/branchId === "all"/, /concrete_branch_required/, /matcher: \["\/api\/:path\*"\]/]);
requireText("src/app/api/session/active-branch/route.ts", [/selectActiveBranch/]);
requireText("src/lib/local-inventory-admin.ts", [/branchId/]);
requireText("src/lib/local-demand-write.ts", [/resolveDemandBranchScope/, /where:\s*\{\s*branchId/]);
requireText("src/lib/cashbox.ts", [/activeCashBranchId/, /where:\s*\{\s*branchId,\s*serviceDate\s*\}/]);
requireText("src/lib/shifts.ts", [/activeBranchId/, /where:\s*\{\s*branchId/]);
requireText("src/lib/owner-dashboard.ts", [/branchId:\s*branch\.id/]);
requireText("src/lib/branch-workers.ts", [/runWithRequestTenant/, /status:\s*"active"/, /organizationId/]);
requireText("src/lib/messenger/messenger-storage.ts", [/\["branches", getScopedBranchId\(\), \.\.\.parts\]/]);
requireText("src/lib/vin-lookup-cache.ts", [
  /WHERE\s+branch_id\s*=\s*\$\{branchId\}[\s\S]*AND\s+vin\s*=\s*\$\{vin\}/,
  /ON CONFLICT \(branch_id, vin\)/,
]);
requireText("src/app/api/messenger/webhook/telegram/\[branchId\]/route.ts", [/runForBranch/]);
requireText("src/app/api/integrations/tbank/webhook/payment-status/\[branchId\]/route.ts", [/runForBranch/]);
requireText("prisma/migrations/20260728120000_branch_architecture_foundation/migration.sql", [
  /'branch-main'/,
  /branch_memberships/,
  /FOREIGN KEY \(branch_id\)/,
  /cash_shifts_branch_id_service_date_key/,
  /set_branch_from_organization_id/,
]);
requireText("prisma/migrations/20260808130000_owner_repeat_cash_shifts/migration.sql", [
  /approved-with-verified-timeweb-backup/,
  /DROP INDEX IF EXISTS "cash_shifts_branch_id_service_date_key"/,
  /CREATE INDEX "cash_shifts_branch_id_service_date_idx"/,
  /CREATE UNIQUE INDEX "cash_shifts_non_owner_service_date_key"/,
  /COALESCE\("opened_by_role", ''\) <> 'owner'/,
]);

const migration = read("prisma/migrations/20260728120000_branch_architecture_foundation/migration.sql");
const allMigrations = fs.readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join("prisma/migrations", entry.name, "migration.sql"))
  .filter((file) => fs.existsSync(path.join(root, file)))
  .map(read)
  .join("\n");
if (/railway/i.test(migration)) failures.push("Миграция не должна содержать Railway-ссылки или fallback");
for (const file of ["src/lib/request-tenant-store.ts", "src/lib/crm.ts", "src/lib/piecework-rules.ts"]) {
  if (/branch-main/.test(read(file))) failures.push(`${file}: runtime branch-main fallback запрещён`);
}
for (const match of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
  const [, model, body] = match;
  if (!/\bbranchId\s+String\b/.test(body) || controlPlaneModels.has(model)) continue;
  const table = body.match(/@@map\("([^"]+)"\)/)?.[1];
  if (table && !migration.includes(`'${table}'`) && !allMigrations.includes(`"${table}"`)) {
    failures.push(`Migration: таблица ${table} не включена в branch foundation или более позднюю миграцию`);
  }
}

if (failures.length) {
  console.error("Branch isolation checks failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log(`Branch isolation foundation checks passed (${requiredScopedModels.length} critical models).`);
