import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createJiti } from "jiti";

const databaseUrl = process.env.BRANCH_SECURITY_DATABASE_URL?.trim() ?? "";
if (!databaseUrl) {
  console.error("Branch security DB NO-GO: BRANCH_SECURITY_DATABASE_URL is not configured.");
  process.exit(2);
}
if (/railway/i.test(databaseUrl)) {
  console.error("Branch security DB refused: Railway databases are forbidden.");
  process.exit(2);
}
let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  console.error("Branch security DB refused: invalid BRANCH_SECURITY_DATABASE_URL.");
  process.exit(2);
}
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);
if (!localHosts.has(parsedUrl.hostname)) {
  console.error(`Branch security DB refused: ${parsedUrl.hostname} is not a local test PostgreSQL host.`);
  process.exit(2);
}
if (!/branch.*security|security.*branch/i.test(parsedUrl.pathname)) {
  console.error("Branch security DB refused: database name must contain both 'branch' and 'security'.");
  process.exit(2);
}

process.env.DATABASE_URL = databaseUrl;
const schemaMode = process.env.BRANCH_SECURITY_SKIP_MIGRATIONS === "true"
  ? "skip"
  : (process.env.BRANCH_SECURITY_SCHEMA_MODE?.trim().toLowerCase() || "push");
if (!new Set(["push", "migrate", "skip"]).has(schemaMode)) {
  console.error("Branch security DB refused: BRANCH_SECURITY_SCHEMA_MODE must be push, migrate, or skip.");
  process.exit(2);
}
if (schemaMode !== "skip") {
  // The repository's historical migrations start from a pre-existing production
  // schema. A synthetic empty security database therefore uses the current Prisma
  // schema directly. Production-copy rehearsal remains responsible for proving
  // the real migration chain against the canonical Selectel baseline.
  const schemaCommand = schemaMode === "migrate"
    ? ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]
    : ["prisma", "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"];
  const prepared = spawnSync("npx", schemaCommand, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (prepared.status !== 0) {
    console.error(`Branch security DB NO-GO: schema ${schemaMode} failed.`);
    process.stderr.write(prepared.stderr || prepared.stdout || "");
    process.exit(1);
  }
}
console.log(`Branch security DB schema mode: ${schemaMode}.`);

const [{ PrismaClient }, policyModule] = await Promise.all([
  import("@prisma/client"),
  createJiti(import.meta.url, { interopDefault: true }).import("../src/lib/db.ts"),
]);
const { applyBranchQueryPolicy } = policyModule;
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const suffix = crypto.randomBytes(6).toString("hex");
const ids = {
  group: `security-group-${suffix}`,
  a1: `security-a1-${suffix}`,
  a2: `security-a2-${suffix}`,
  productA1: `security-product-a1-${suffix}`,
  productA2: `security-product-a2-${suffix}`,
  storeA1: `security-store-a1-${suffix}`,
  storeA2: `security-store-a2-${suffix}`,
  clientA1: `security-client-a1-${suffix}`,
  clientA2: `security-client-a2-${suffix}`,
  demandA1: `security-demand-a1-${suffix}`,
  demandA2: `security-demand-a2-${suffix}`,
  periodA1: `security-period-a1-${suffix}`,
  periodA2: `security-period-a2-${suffix}`,
  conversationA1: `security-conversation-a1-${suffix}`,
  conversationA2: `security-conversation-a2-${suffix}`,
  messageA2: `security-message-a2-${suffix}`,
  attachmentA2: `security-attachment-a2-${suffix}`,
  diagnosticA2: crypto.randomUUID(),
  diagnosticPositionA2: crypto.randomUUID(),
};

const tenantA1 = { mode: "branch", branchId: ids.a1, organizationId: ids.a1, allowedBranchIds: [ids.a1] };
const tenantAll = { mode: "all", branchId: null, organizationId: null, allowedBranchIds: [ids.a1, ids.a2] };
const tenantDenied = { mode: "denied", branchId: null, organizationId: null, allowedBranchIds: [] };

// Application policy matrix: list/get/search/export/files/AI/webhook/queue all
// receive the same fail-closed branch predicate before Prisma executes SQL.
for (const model of [
  "LocalCounterparty", "LocalDemand", "LocalProduct", "LocalStore", "Diagnostic",
  "MessengerMessage", "MessengerAttachment", "AIAgentSetting", "MessengerWebhookEvent", "MessengerMediaJob",
]) {
  const read = applyBranchQueryPolicy(model, "findMany", { where: {} }, tenantA1);
  assert.equal(read.where.branchId, ids.a1, `${model} LIST/SEARCH must be branch scoped`);
}
assert.equal(applyBranchQueryPolicy("LocalDemand", "findUnique", { where: { id: ids.demandA2 } }, tenantA1).where.branchId, ids.a1);
assert.equal(applyBranchQueryPolicy("LocalDemand", "update", { where: { id: ids.demandA2 }, data: { name: "x" } }, tenantA1).where.branchId, ids.a1);
assert.equal(applyBranchQueryPolicy("LocalDemand", "delete", { where: { id: ids.demandA2 } }, tenantA1).where.branchId, ids.a1);
assert.equal(applyBranchQueryPolicy("LocalDemand", "create", { data: { name: "x" } }, tenantA1).data.branchId, ids.a1);
assert.throws(() => applyBranchQueryPolicy("LocalDemand", "create", { data: { branchId: ids.a2 } }, tenantA1), /другого филиала/);
assert.throws(() => applyBranchQueryPolicy("LocalDemand", "update", { where: { id: ids.demandA1 }, data: {} }, tenantAll), /операции изменения запрещены/);
assert.throws(() => applyBranchQueryPolicy("LocalDemand", "findMany", { where: {} }, tenantAll), /явный разрешённый branchId/);
assert.throws(() => applyBranchQueryPolicy("LocalDemand", "findMany", { where: {} }, tenantDenied), /Нет доступа/);
assert.deepEqual(
  applyBranchQueryPolicy("LocalDemand", "findMany", { where: { branchId: { in: [ids.a1, ids.a2] } } }, tenantAll).where.branchId.in,
  [ids.a1, ids.a2]
);

const ROLLBACK_SENTINEL = new Error("branch-security-rollback");
let dbAssertions = 0;
try {
  await db.$transaction(async (tx) => {
    await tx.businessGroup.create({ data: { id: ids.group, name: `Security ${suffix}`, slug: `security-${suffix}` } });
    await tx.branch.createMany({ data: [
      { id: ids.a1, businessGroupId: ids.group, name: "A1", shortName: "A1", slug: `a1-${suffix}` },
      { id: ids.a2, businessGroupId: ids.group, name: "A2", shortName: "A2", slug: `a2-${suffix}` },
    ] });
    await tx.localProduct.createMany({ data: [
      { id: ids.productA1, branchId: ids.a1, name: "A1 product" },
      { id: ids.productA2, branchId: ids.a2, name: "A2 product" },
    ] });
    await tx.localStore.createMany({ data: [
      { id: ids.storeA1, branchId: ids.a1, name: "A1 store" },
      { id: ids.storeA2, branchId: ids.a2, name: "A2 store" },
    ] });
    await tx.localCounterparty.createMany({ data: [
      { id: ids.clientA1, branchId: ids.a1, name: "A1 client" },
      { id: ids.clientA2, branchId: ids.a2, name: "A2 client" },
    ] });
    await tx.localDemand.createMany({ data: [
      { id: ids.demandA1, branchId: ids.a1, name: `A1-${suffix}`, momentAt: new Date(), documentDate: "2026-07-28", counterpartyId: ids.clientA1, storeId: ids.storeA1 },
      { id: ids.demandA2, branchId: ids.a2, name: `A2-${suffix}`, momentAt: new Date(), documentDate: "2026-07-28", counterpartyId: ids.clientA2, storeId: ids.storeA2 },
    ] });
    await tx.payrollPeriod.createMany({ data: [
      { id: ids.periodA1, branchId: ids.a1, dateFrom: "2026-07-01", dateTo: "2026-07-31", closedByLogin: "a1", totalAccruedCents: 0, totalPaidCents: 0, totalRemainingCents: 0, employeesCount: 0, snapshotJson: {} },
      { id: ids.periodA2, branchId: ids.a2, dateFrom: "2026-08-01", dateTo: "2026-08-31", closedByLogin: "a2", totalAccruedCents: 0, totalPaidCents: 0, totalRemainingCents: 0, employeesCount: 0, snapshotJson: {} },
    ] });
    await tx.messengerConversation.createMany({ data: [
      { id: ids.conversationA1, branchId: ids.a1, channel: "telegram", externalConversationId: `a1-${suffix}`, title: "A1", participantName: "A1" },
      { id: ids.conversationA2, branchId: ids.a2, channel: "telegram", externalConversationId: `a2-${suffix}`, title: "A2", participantName: "A2" },
    ] });
    await tx.messengerMessage.create({ data: { id: ids.messageA2, branchId: ids.a2, conversationId: ids.conversationA2, channel: "telegram", direction: "inbound", authorType: "client" } });
    await tx.messengerAttachment.create({ data: { id: ids.attachmentA2, branchId: ids.a2, messageId: ids.messageA2, channel: "telegram", type: "photo" } });
    await tx.diagnostic.create({ data: { id: ids.diagnosticA2, branchId: ids.a2 } });
    await tx.diagnosticPosition.create({ data: { id: ids.diagnosticPositionA2, branchId: ids.a2, diagnosticId: ids.diagnosticA2, block: "VISUAL", node: `node-${suffix}`, tags: [] } });
    await tx.integrationCredential.createMany({ data: [
      { id: `credential-a1-${suffix}`, branchId: ids.a1, businessGroupId: ids.group, channel: "rossko", key: "key1", encryptedValue: {} },
      { id: `credential-a2-${suffix}`, branchId: ids.a2, businessGroupId: ids.group, channel: "rossko", key: "key1", encryptedValue: {} },
    ] });
    await tx.aIAgentSetting.createMany({ data: [
      { id: `ai-a1-${suffix}`, branchId: ids.a1, organizationId: ids.a1 },
      { id: `ai-a2-${suffix}`, branchId: ids.a2, organizationId: ids.a2 },
    ] });
    await tx.messengerWebhookEvent.createMany({ data: [
      { id: `webhook-a1-${suffix}`, branchId: ids.a1, channel: "telegram", externalUpdateId: `a1-${suffix}`, rawJson: {} },
      { id: `webhook-a2-${suffix}`, branchId: ids.a2, channel: "telegram", externalUpdateId: `a2-${suffix}`, rawJson: {} },
    ] });

    const a1Products = await tx.localProduct.findMany({ where: { branchId: ids.a1 } });
    assert.deepEqual(a1Products.map((row) => row.id), [ids.productA1]);
    assert.equal(await tx.localDemand.findFirst({ where: { id: ids.demandA2, branchId: ids.a1 } }), null);
    assert.equal((await tx.integrationCredential.findMany({ where: { branchId: ids.a1 } })).length, 1);
    assert.equal((await tx.aIAgentSetting.findMany({ where: { branchId: ids.a1 } })).length, 1);
    assert.equal((await tx.messengerWebhookEvent.findMany({ where: { branchId: ids.a1 } })).length, 1);
    dbAssertions += 5;

    let savepoint = 0;
    async function expectForeignKey(label, operation) {
      const name = `branch_security_${savepoint++}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      let failure = null;
      try {
        await operation();
      } catch (error) {
        failure = error;
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
      if (!failure || !/foreign key|P2003|violates.*constraint/i.test(String(failure?.message ?? failure))) {
        throw new Error(`${label}: expected FK violation`);
      }
      dbAssertions += 1;
    }

    await expectForeignKey("Shipment A1 -> Client A2", () => tx.localDemand.create({ data: { id: `bad-demand-${suffix}`, branchId: ids.a1, name: `bad-${suffix}`, momentAt: new Date(), documentDate: "2026-07-28", counterpartyId: ids.clientA2, storeId: ids.storeA1 } }));
    await expectForeignKey("ShipmentItem A1 -> Product A2", () => tx.localDemandPosition.create({ data: { id: `bad-position-${suffix}`, branchId: ids.a1, demandId: ids.demandA1, productId: ids.productA2, assortmentType: "product", name: "bad" } }));
    await expectForeignKey("Payroll A1 -> Period A2", () => tx.payrollPeriodEmployee.create({ data: { id: `bad-payroll-${suffix}`, branchId: ids.a1, periodId: ids.periodA2, employeeLogin: "a1", employeeName: "A1", employeeRole: "master", shiftTotalCents: 0, pieceworkCents: 0, adjustmentsCents: 0, paidOutCents: 0, remainingCents: 0, totalCents: 0, shiftsCount: 0, snapshotJson: {} } }));
    await expectForeignKey("Message A1 -> Conversation A2", () => tx.messengerMessage.create({ data: { id: `bad-message-${suffix}`, branchId: ids.a1, conversationId: ids.conversationA2, channel: "telegram", direction: "inbound", authorType: "client" } }));
    await expectForeignKey("StockMovement A1 -> Store/Product A2", () => tx.inventoryLedgerEntry.create({ data: { id: `bad-stock-${suffix}`, branchId: ids.a1, sourceType: "security", sourceId: suffix, productId: ids.productA2, storeId: ids.storeA2, movementType: "adjustment", quantityDelta: 1 } }));
    await expectForeignKey("DiagnosticPhoto A1 -> Position A2", () => tx.diagnosticPhoto.create({ data: { id: crypto.randomUUID(), branchId: ids.a1, positionId: ids.diagnosticPositionA2, filePath: "/tmp/blocked" } }));
    await expectForeignKey("ProductPhoto A1 -> Product A2", () => tx.localProductPhoto.create({ data: { id: `bad-photo-${suffix}`, branchId: ids.a1, productId: ids.productA2, contentType: "image/png", sizeBytes: 1, data: Buffer.from([0]) } }));
    await expectForeignKey("Queue A1 -> Attachment A2", () => tx.messengerMediaJob.create({ data: { id: `bad-job-${suffix}`, branchId: ids.a1, attachmentId: ids.attachmentA2, operation: "download" } }));
    throw ROLLBACK_SENTINEL;
  }, { timeout: 60_000, maxWait: 10_000 });
} catch (error) {
  if (error !== ROLLBACK_SENTINEL && error?.message !== ROLLBACK_SENTINEL.message) throw error;
} finally {
  await db.$disconnect();
}

assert.equal(dbAssertions, 13);
console.log(`PostgreSQL two-branch security matrix passed (${dbAssertions} DB assertions plus application policy matrix). Test data rolled back.`);
