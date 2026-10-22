import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';

const folder = mkdtempSync(join(tmpdir(), 'case-attention-'));
const now = new Date('2026-10-22T10:00:00Z');
const base = {branchId: 'branch-a', status: 'open', caseStatus: 'calculation_needed', stage: {name: 'Нужно рассчитать'}, createdAt: new Date('2026-10-22T08:00:00Z'), nextAction: null, nextActionAt: null, nextContactAt: null, snoozeUntil: null};
const rows = [
  {...base},
  {...base, createdAt: new Date('2026-10-21T10:00:00Z')},
  {...base, caseStatus: 'check_response', nextContactAt: new Date(now - 1000)},
  {...base, caseStatus: 'calculation_sent', nextActionAt: new Date(now - 1000)},
  {...base, caseStatus: 'parts_arrived', nextActionAt: new Date(now - 1000)},
  {...base, status: 'won'},
  {...base, caseStatus: 'closed'},
  {...base, stage: {name: 'Дубль / архив'}},
  {...base, branchId: 'branch-b', createdAt: new Date('2026-10-21T10:00:00Z')},
  {...base, caseStatus: 'postponed', snoozeUntil: new Date(+now + 86400000)},
];
// Evaluate Prisma predicates over isolated fixtures; no database access.
writeFileSync(join(folder, 'db.cjs'), `
exports.rows = [];
function match(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(item => match(row, item));
    if (key === 'OR') return value.some(item => match(row, item));
    if (key === 'NOT') return value.every(item => !match(row, item));
    if (value === null) return row[key] === null;
    if (typeof value !== 'object') return row[key] === value;
    if ('notIn' in value) return !value.notIn.includes(row[key]);
    if ('lt' in value) return row[key] != null && new Date(row[key]) < value.lt;
    if ('lte' in value) return row[key] != null && new Date(row[key]) <= value.lte;
    if ('contains' in value) return row[key].toLowerCase().includes(value.contains.toLowerCase());
    return match(row[key], value);
  });
}
exports.prisma = {crmDeal: {findMany: async ({where}) => exports.rows.filter(row => match(row, where))}};
`);
try {
  const jiti = createJiti(import.meta.url, {alias: {'@/lib/db': join(folder, 'db.cjs'), '@': resolve('src')}});
  const db = await jiti.import(join(folder, 'db.cjs'));
  db.rows.push(...rows);
  const {getClientCaseAttention} = await jiti.import('../src/lib/client-case-attention.ts');
  assert.deepEqual(await getClientCaseAttention('branch-a', now), {overdue: 2, calculationNeeded: 3});
  assert.deepEqual(await getClientCaseAttention('branch-b', now), {overdue: 1, calculationNeeded: 1});
  assert.deepEqual(await getClientCaseAttention('empty-branch', now), {overdue: 0, calculationNeeded: 0});
  db.rows[0].caseStatus = 'calculation_sent';
  assert.deepEqual(await getClientCaseAttention('branch-a', now), {overdue: 2, calculationNeeded: 2}, 'Count falls after calculation is sent; legacy snoozed calculations remain visible');
  console.log('Client attention: same-day calculations, overdue legacy requests, idle estimates, arrived parts, closed exclusion and branch isolation passed');
} finally { rmSync(folder, {recursive: true, force: true}); }
