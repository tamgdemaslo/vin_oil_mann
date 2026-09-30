#!/usr/bin/env node
// Owner-approved update of all Bardahl retail cards: 600 RUB profit per litre,
// with four fixed bulk-oil exceptions. Purchase prices remain unchanged.
// --prepare snapshots all cards; --apply checks the snapshot; --verify checks all prices.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [mode, evidenceDir] = process.argv.slice(2);
assert.ok(['--prepare', '--apply', '--verify'].includes(mode));
assert.ok(evidenceDir && path.isAbsolute(evidenceDir), 'Provide an absolute evidence directory');
assert.equal(process.argv.length, 4);
const config = JSON.parse(await fs.readFile(path.join(root, 'data/pricing/bardahl-bulk-retail-20260930.json'), 'utf8'));
assert.equal(config.targets.length, 4);
assert.equal(new Set(config.targets.map(r => r.id)).size, 4);
let databaseUrl = process.env.TIMEWEB_MIGRATION_DATABASE_URL;
if (!databaseUrl) {
  const env = await fs.readFile(path.resolve(root, '../vin_oil_mann/.env.local'), 'utf8');
  databaseUrl = env.match(/^TIMEWEB_MIGRATION_DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2');
}
assert.ok(databaseUrl, 'Timeweb database configuration missing');
const connection = new URL(databaseUrl);
assert.ok(connection.hostname.endsWith('.twc1.net') || connection.hostname.includes('timeweb'), 'Only Timeweb is supported');
const pgEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
  PGHOST: connection.hostname, PGPORT: connection.port || '5432',
  PGUSER: decodeURIComponent(connection.username), PGPASSWORD: decodeURIComponent(connection.password),
  PGDATABASE: decodeURIComponent(connection.pathname.slice(1)), PGSSLMODE: 'require',
  PGCONNECT_TIMEOUT: '10', PGSERVICEFILE: '/dev/null', PGPASSFILE: '/dev/null',
};
function query(sql, write = false) {
  const result = spawnSync(process.env.PSQL_PATH || '/opt/homebrew/bin/psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: sql, env: { ...pgEnv, PGOPTIONS: `-c statement_timeout=30000${write ? '' : ' -c default_transaction_read_only=on'}` },
    encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    let message = result.stderr || 'Database operation failed';
    for (const secret of [databaseUrl, connection.username, connection.password, pgEnv.PGUSER, pgEnv.PGPASSWORD]) {
      if (secret) message = message.split(secret).join('[redacted]');
    }
    throw new Error(message);
  }
  return JSON.parse(result.stdout.trim());
}
const quote = v => v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`;
const select = `SELECT coalesce(json_agg(row_to_json(q) ORDER BY q.branch_id,q.id),'[]'::json) FROM (
  SELECT id,branch_id,name,article,package_volume,uom_name,buy_price_cents,sale_price_cents FROM local_products
  WHERE lower(coalesce(brand,''))='bardahl' AND NOT archived AND entity_type='product'
  AND branch_id IN ('branch-main','cmsd9o02w006qmu01u4ij1lhz')
) q;`;
const planPath = path.join(evidenceDir, 'approved-bulk-plan.json');
await fs.mkdir(evidenceDir, { recursive: true });
if (mode === '--prepare') {
  const before = query(select);
  for (const target of config.targets) {
    const row = before.find(r => r.id === target.id && r.branch_id === target.branchId);
    assert.ok(row, `Missing target ${target.id}`);
    assert.equal(row.article, target.article);
    assert.match(row.name, /розлив/i);
    assert.equal(row.package_volume, '1 л');
    assert.equal(row.uom_name, 'л');
  }
  const fixed = new Map(config.targets.map(r => [r.id, r]));
  const changes = before.map(row => {
    const text = String(row.package_volume || row.name).replaceAll(',', '.');
    const match = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(мл|л|l)(?:\.|\s|$)/i);
    const litres = config.litresOverrides[row.id] ?? (match ? Number(match[1]) * (match[2].toLowerCase() === 'мл' ? 0.001 : 1) : null);
    assert.ok(litres > 0, `Unknown unit volume ${row.id}`);
    assert.ok(Number.isInteger(row.buy_price_cents) && row.buy_price_cents > 0, `Missing purchase price ${row.id}`);
    const sale = fixed.get(row.id)?.salePriceCents ?? Math.round(row.buy_price_cents + litres * config.defaultProfitPerLitreCents);
    return { ...row, litres_per_unit: litres, new_sale_price_cents: sale, profit_cents: sale - row.buy_price_cents, profit_per_litre_cents: (sale-row.buy_price_cents)/litres };
  });
  await fs.writeFile(planPath, JSON.stringify({ createdAt: new Date().toISOString(), targets: config.targets, before, changes }, null, 2));
  console.log(JSON.stringify({ cards: before.length, bulkExceptions: config.targets.length, standardCards: changes.length-config.targets.length, pricesChanging: changes.filter(r=>r.sale_price_cents!==r.new_sale_price_cents).length }, null, 2));
} else {
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  assert.deepEqual(plan.targets, config.targets);
  if (mode === '--apply') {
    const values = plan.changes.map(r => `(${quote(r.id)},${quote(r.branch_id)},${quote(r.article)},${r.buy_price_cents},${r.sale_price_cents},${r.new_sale_price_cents})`).join(',');
    const result = query(`BEGIN;
      SET LOCAL lock_timeout='5s';
      CREATE TEMP TABLE price_plan(id text PRIMARY KEY,branch_id text,article text,buy int,old_sale int,new_sale int) ON COMMIT DROP;
      INSERT INTO price_plan VALUES ${values};
      SELECT id FROM local_products WHERE false;
      DO $$ BEGIN
        PERFORM 1 FROM local_products WHERE id IN (SELECT id FROM price_plan) ORDER BY id FOR UPDATE;
        IF (SELECT count(*) FROM price_plan v JOIN local_products p ON p.id=v.id AND p.branch_id=v.branch_id
          WHERE p.buy_price_cents IS NOT DISTINCT FROM v.buy AND p.sale_price_cents=v.old_sale AND p.article IS NOT DISTINCT FROM v.article
          AND NOT p.archived AND lower(p.brand)='bardahl' AND p.entity_type='product')<>${plan.changes.length}
        THEN RAISE EXCEPTION 'Card or price changed since snapshot'; END IF;
      END $$;
      UPDATE local_products p SET sale_price_cents=v.new_sale,synced_at=now(),updated_at=now()
        FROM price_plan v WHERE p.id=v.id AND p.branch_id=v.branch_id;
      SELECT json_build_object('updated',count(*)) FROM price_plan v JOIN local_products p ON p.id=v.id AND p.branch_id=v.branch_id WHERE p.sale_price_cents=v.new_sale;
      COMMIT;`, true);
    assert.equal(result.updated, plan.changes.length);
    await fs.writeFile(path.join(evidenceDir, 'approved-bulk-apply-result.json'), JSON.stringify(result));
    console.log(JSON.stringify(result));
  } else {
    const after = query(select);
    assert.equal(after.length, plan.before.length);
    const changed = new Map(plan.changes.map(r => [r.id, r]));
    for (const before of plan.before) {
      const current = after.find(r => r.id === before.id);
      assert.ok(current);
      assert.equal(current.buy_price_cents, before.buy_price_cents, `Purchase changed ${before.id}`);
      assert.equal(current.sale_price_cents, changed.get(before.id)?.new_sale_price_cents ?? before.sale_price_cents, `Retail mismatch ${before.id}`);
    }
    const result = { verifiedAt: new Date().toISOString(), matched: after.length, updated: plan.changes.length, bulkExceptions: config.targets.length, standardCards: after.length - config.targets.length, mismatches: 0, after };
    await fs.writeFile(path.join(evidenceDir, 'approved-bulk-verification.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ matched: result.matched, updated: result.updated, bulkExceptions: result.bulkExceptions, standardCards: result.standardCards, mismatches: 0 }));
  }
}
