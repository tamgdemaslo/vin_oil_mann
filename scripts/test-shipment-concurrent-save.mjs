import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.PRECHECK_TEST_DATABASE_URL;
assert.ok(databaseUrl, "Set PRECHECK_TEST_DATABASE_URL to an isolated local database with the Prisma schema");
const url = new URL(databaseUrl);
assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "Only local PostgreSQL is allowed");
assert.equal(url.pathname, "/precheck_concurrency_test", "Use the dedicated disposable test database");
process.env.DATABASE_URL = databaseUrl;
const jiti = createJiti(import.meta.url, { alias: {
  "@": fileURLToPath(new URL("../src", import.meta.url)),
  "@prisma/client": fileURLToPath(new URL("../node_modules/@prisma/client", import.meta.url)),
} });
const { updateLocalDemand } = await jiti.import(process.env.PRECHECK_TEST_WRITE_MODULE || "../src/lib/local-demand-write.ts");
const { runWithRequestTenant } = await jiti.import("../src/lib/request-tenant-store.ts");
const { prisma } = await jiti.import("../src/lib/db.ts");
const db = new PrismaClient();
const prefix = `precheck-concurrency-${randomUUID()}`;
const branchId = `${prefix}-branch`;
const organizationId = `${prefix}-org`;
const tenant = { mode: "branch", branchId, organizationId, allowedBranchIds: [branchId] };
const actor = { login: "test", name: "Test", role: "owner" };
const demandIds = [];
const products = Array.from({ length: 6 }, (_, i) => ({ id: `${prefix}-product-${i}`, branchId, name: `Test ${i}`, entityType: i === 5 ? "service" : "product" }));
const input = products.slice(0, 5).map((product, i) => ({
  quantity: 0.1, price: [99_000, 99_000, 59_000, 213_000, 199_000][i], discount: 0,
  assortment: { meta: { href: `local://product/${product.id}`, type: "product", mediaType: "application/json" } },
}));
const save = (id, body) => runWithRequestTenant(tenant, () => updateLocalDemand(id, body, actor, branchId, organizationId));
const fixture = async (label, positions = []) => {
  const id = `${prefix}-${label}`;
  demandIds.push(id);
  await db.localDemand.create({ data: { id, branchId, organizationId, name: label, documentDate: "2026-10-01", momentAt: new Date("2026-10-01T12:00:00Z") } });
  if (positions.length) await db.localDemandPosition.createMany({ data: positions.map(p => ({ ...p, demandId: id })) });
  return id;
};
const verify = async (id, count, total, revisions) => {
  const demand = await db.localDemand.findUniqueOrThrow({ where: { id }, include: { positions: true, revisions: { orderBy: { revisionNumber: "asc" } } } });
  assert.equal(demand.positions.length, count, "Concurrent saves must replace positions without appending copies");
  const positionTotal = demand.positions.reduce((sum, p) => sum + Math.round(Number(p.quantity) * p.priceCentsPerUnit * (1 - Number(p.discount) / 100)), 0);
  assert.equal(demand.sumCents, positionTotal, "Header and precheck totals must agree");
  if (total != null) assert.equal(positionTotal, total);
  assert.deepEqual(demand.revisions.map(r => r.revisionNumber), Array.from({ length: revisions }, (_, i) => i + 1), "Concurrent saves must have distinct, sequential revisions");
  return demand;
};
const overlapSaves = async (id) => {
  let ready, release;
  const locked = new Promise(resolve => { ready = resolve; });
  const unlock = new Promise(resolve => { release = resolve; });
  const barrier = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM local_demand_positions WHERE demand_id = ${id} AND branch_id = ${branchId} FOR UPDATE`;
    ready();
    await unlock;
  }, { timeout: 10_000 });
  await locked;
  const pending = Promise.all([save(id, { positions: input }), save(id, { positions: input })]);
  try {
    // Both requests must be waiting on a real PostgreSQL lock before releasing
    // the original positions. Old DELETE statements then see the same rows.
    const deadline = Date.now() + 5_000;
    for (;;) {
      const [state] = await db.$queryRaw`SELECT count(*)::int AS blocked FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (state.blocked >= 2) break;
      assert.ok(Date.now() < deadline, "Both saves must reach the concurrency barrier");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally {
    release();
    await barrier;
  }
  return pending;
};

try {
  await db.businessGroup.create({ data: { id: prefix, name: "Test", slug: prefix } });
  await db.localOrganization.create({ data: { id: organizationId, name: "Test" } });
  await db.branch.create({ data: { id: branchId, businessGroupId: prefix, name: "Test", shortName: "Test", slug: "test", legacyOrganizationId: organizationId } });
  await db.localProduct.createMany({ data: products });
  const id = await fixture("overlap", [{ branchId, name: "Original", assortmentType: "product", productId: products[0].id, quantity: 1, priceCentsPerUnit: 99_000 }]);
  const results = await overlapSaves(id);
  assert.ok(results.every(r => r.ok), JSON.stringify(results));
  await verify(id, 5, 66_900, 2);

  const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => save(id, { positions: input.map(p => ({ ...p, quantity: (i + 1) / 10 })) })));
  assert.ok(burst.every(r => r.ok), JSON.stringify(burst));
  await verify(id, 5, null, 10);

  const emptyId = await fixture("empty");
  assert.ok((await Promise.all([save(emptyId, { positions: input }), save(emptyId, { positions: input })])).every(r => r.ok));
  await verify(emptyId, 5, 66_900, 2);

  const separateLinesId = await fixture("intentional-separate-lines");
  const separateLines = [input[0], { ...input[0], price: 100_000, discount: 10 }];
  assert.ok((await save(separateLinesId, { positions: separateLines })).ok);
  await verify(separateLinesId, 2, 18_900, 1);

  const rollbackId = await fixture("rollback");
  assert.ok((await save(rollbackId, { positions: input })).ok);
  const failed = await save(rollbackId, { positions: [{ ...input[0], quantity: 1e14 }] });
  assert.equal(failed.ok, false, "Invalid replacement must fail");
  await verify(rollbackId, 5, 66_900, 1);

  const postId = await fixture("double-post");
  const service = { quantity: 1, price: 12_345, assortment: { meta: { href: `local://service/${products[5].id}`, type: "service", mediaType: "application/json" } } };
  const posted = await Promise.all([save(postId, { positions: [service], applicable: true }), save(postId, { positions: [service], applicable: true })]);
  assert.equal(posted.filter(r => r.ok).length, 1, "Only one concurrent request may post a draft");
  assert.match(posted.find(r => !r.ok).error, /Проведённую отгрузку/);
  await verify(postId, 1, 12_345, 1);

  const missing = await save(`${prefix}-missing`, { positions: input });
  assert.deepEqual(missing, { ok: false, error: "Локальная отгрузка не найдена", notFound: true });
  console.log("Concurrent shipment save: PASS (overlapping saves, eight-request burst, empty draft, separate lines, rollback, double posting, missing shipment)");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.shipmentRevision.deleteMany({ where: { shipmentId: { in: demandIds } } });
  await db.localDemand.deleteMany({ where: { id: { in: demandIds } } });
  await db.localProduct.deleteMany({ where: { branchId } });
  await db.branch.deleteMany({ where: { id: branchId } });
  await db.localOrganization.deleteMany({ where: { id: organizationId } });
  await db.businessGroup.deleteMany({ where: { id: prefix } });
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
}
