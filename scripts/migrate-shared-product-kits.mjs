// Explicit maintenance command. No startup hook, no automatic production migration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { PrismaClient } from '@prisma/client';
const jiti = createJiti(import.meta.url, { alias: { '@': resolve('src') } });
const { planSharedKitMigration } = await jiti.import('../src/lib/shared-product-kit-migration.ts');
const arg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const apply = process.argv.includes('--apply');
const destination = arg('report');
assert.ok(destination, 'Specify --report=<local-file.json>');
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'DATABASE_URL must be provided explicitly; .env.local is not loaded');
const database = new URL(databaseUrl);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && database.pathname.startsWith('/eco_kits_test_');
const reportFd = fs.openSync(destination, 'wx', 0o600);
const prisma = new PrismaClient();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function source(tx) {
  const branches = await tx.branch.findMany({ select: { id: true, businessGroupId: true }, orderBy: { id: 'asc' } });
  const rows = await tx.productKit.findMany({ include: { items: { orderBy: [{ position: 'asc' }, { id: 'asc' }], include: { product: true } }, targets: { orderBy: { storeId: 'asc' } } }, orderBy: { id: 'asc' } });
  return { rows, branches };
}
try {
  if (apply && !local) {
    assert.equal(process.env.SHARED_KIT_MIGRATION_APPROVED, 'yes', 'Separate operator approval required');
    const backupId = arg('backup-id');
    const token = process.env.TIMEWEB_CLOUD_TOKEN;
    assert.ok(backupId && /^\d+$/.test(backupId) && token, 'Verified Timeweb backup and provider token required');
    const headers = { Authorization: `Bearer ${token}` };
    const [dbResponse, backupResponse] = await Promise.all([
      fetch('https://api.timeweb.cloud/api/v1/dbs/4195453', { headers, signal: AbortSignal.timeout(20000) }),
      fetch(`https://api.timeweb.cloud/api/v1/dbs/4195453/backups/${backupId}`, { headers, signal: AbortSignal.timeout(20000) }),
    ]);
    assert.ok(dbResponse.ok && backupResponse.ok, 'Timeweb backup verification failed');
    const { db } = await dbResponse.json();
    const { backup } = await backupResponse.json();
    const { lookup } = await import('node:dns/promises');
    assert.ok((await lookup(database.hostname, { all: true })).some(row => row.address === db.ip), 'Database must be the verified Timeweb resource');
    assert.equal(database.pathname, '/vin_oil');
    assert.equal(backup.status, 'done'); assert.ok(backup.size > 0);
    const backupTime = backup.created_at || backup.createdAt;
    assert.ok(backupTime && Date.now() - Date.parse(backupTime) < 24 * 60 * 60 * 1000, 'Use a completed backup less than 24 hours old');
  }
  const result = await prisma.$transaction(async tx => {
    if (apply) {
      // Legacy inputs stay stable while being imported; shared writes serialize on the same lock.
      await tx.$executeRawUnsafe('LOCK TABLE product_kits, product_kit_items, product_kit_stock_targets IN SHARE MODE');
    } else await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const snapshot = await source(tx);
    const fingerprint = hash(snapshot);
    const plan = planSharedKitMigration(snapshot.rows, snapshot.branches);
    const planFingerprint = hash(plan);
    if (apply) {
      assert.equal(arg('expected-plan-sha256'), planFingerprint, 'Reviewed plan changed: create and review a fresh plan');
      assert.equal(arg('expected-sha256'), fingerprint, 'Legacy data changed: create and review a fresh plan');
      const groupIds = [...new Set(plan.kits.map(kit => kit.businessGroupId))].sort();
      for (const groupId of groupIds) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shared-kits:${groupId}`}))::text`;
      assert.equal(await tx.sharedProductKit.count(), 0, 'Shared catalog is not empty; refusing to overwrite live changes');
      if (plan.kits.length) await tx.sharedProductKit.createMany({ data: plan.kits });
      assert.equal(await tx.sharedProductKit.count(), plan.sharedCount);
      assert.equal(hash(await source(tx)), fingerprint, 'Legacy tables changed during import');
    }
    return { kind: 'SHARED_PRODUCT_KIT_MIGRATION', applied: apply, fingerprint, planFingerprint, ...plan };
  }, { isolationLevel: 'Serializable', timeout: 60000 });
  fs.writeFileSync(reportFd, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ kind: result.kind, applied: apply, fingerprint: result.fingerprint, planFingerprint: result.planFingerprint, sourceCount: result.sourceCount, sharedCount: result.sharedCount, mergedCount: result.mergedCount, warnings: result.warnings, report: destination }));
} finally { fs.closeSync(reportFd); await prisma.$disconnect(); }
