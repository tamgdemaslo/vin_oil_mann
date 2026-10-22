import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';
import { NextRequest } from 'next/server.js';

// Test the real route with isolated persistence; never connect to a database.
const folder = mkdtempSync(join(tmpdir(), 'transmission-quote-'));
writeFileSync(join(folder, 'db.cjs'), `exports.rows = []; exports.prisma = {crmDeal: {create: async ({data}) => { if (data.customerName === 'FAIL') throw new Error('test storage failure'); exports.rows.push(data); return {...data, id: 'test-lead', status: 'open'}; }}};`);
writeFileSync(join(folder, 'crm.cjs'), `exports.getFirstCrmStage = async (branchId) => { if (branchId !== 'public-branch') throw new Error('Public branch required'); return {id: 'first-stage'}; };`);
writeFileSync(join(folder, 'storefront.cjs'), `exports.resolvePublicStorefront = async () => ({branches: [{branchId: 'public-branch'}]});`);
const jiti = createJiti(import.meta.url, { alias: { '@/lib/db': join(folder, 'db.cjs'), '@/lib/public-storefront': join(folder, 'storefront.cjs'), '@/lib/crm': join(folder, 'crm.cjs'), '@': resolve('src') } });
const priorLimit = process.env.PUBLIC_API_LEAD_LIMIT_PER_HOUR;
process.env.PUBLIC_API_LEAD_LIMIT_PER_HOUR = '100';
try {
  const {POST} = await jiti.import('../src/app/api/public/leads/route.ts');
  const db = await jiti.import(join(folder, 'db.cjs'));
  const {caseDayDeadline} = await jiti.import('../src/lib/client-case-simple.ts');
  const payload = {intent: 'transmission_oil_quote', name: 'Иван', phone: '+7 (999) 123-45-67', vehicle: 'Toyota Camry, 2019', sourcePage: '/case/toyota-camry-70-u760', comment: '95000 км', vin: ''};
  const send = (body, origin = 'https://test.example') => POST(new NextRequest('https://test.example/api/public/leads', {method: 'POST', headers: {'content-type': 'application/json', origin, 'x-forwarded-for': 'quote-contract-test'}, body: JSON.stringify(body)}));
  const response = await send(payload);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).lead.id, 'test-lead');
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].title, 'Расчёт замены масла в АКПП');
  assert.equal(db.rows[0].phoneNormalized, '79991234567');
  assert.equal(db.rows[0].stageId, 'first-stage');
  assert.equal(db.rows[0].branchId, 'public-branch');
  assert.equal(db.rows[0].caseType, 'calculation');
  assert.equal(db.rows[0].caseStatus, 'calculation_needed');
  assert.equal(db.rows[0].createdByLogin, 'client-site');
  assert.equal(db.rows[0].nextActionAt.toISOString(), caseDayDeadline().toISOString());
  assert.equal(db.rows[0].nextContactAt.toISOString(), db.rows[0].nextActionAt.toISOString());
  assert.match(db.rows[0].notes, /Toyota Camry, 2019/);
  assert.match(db.rows[0].notes, /case\/toyota-camry-70-u760/);
  assert.match(db.rows[0].nextAction, /Рассчитать/);
  for (const extra of [{phone: '12'}, {name: ''}, {vehicle: ''}, {vin: 'INVALIDVIN'}]) {
    assert.equal((await send({...payload, ...extra})).status, 400);
  }
  assert.equal((await send({...payload, vin: 'JTDBE32K503123456'})).status, 201);
  assert.equal((await send({...payload, website: 'spam.example'})).status, 202);
  assert.equal(db.rows.length, 2, 'Honeypot does not persist a lead');
  assert.equal((await send(payload, 'https://unrelated.example')).status, 403);
  const generic = await send({name: 'Анна', phone: '+79991234567', service: 'Двигатель'});
  assert.equal(generic.status, 201);
  assert.equal(db.rows[2].title, 'Двигатель', 'Show the requested service directly in the simplified queue');
  const previousError = console.error;
  console.error = () => {};
  try { assert.equal((await send({...payload, name: 'FAIL'})).status, 500); }
  finally { console.error = previousError; }
  console.log('Transmission quote: CRM persistence, validation, optional VIN, spam/origin guards, storage failure and existing leads passed');
} finally {
  if (priorLimit === undefined) delete process.env.PUBLIC_API_LEAD_LIMIT_PER_HOUR;
  else process.env.PUBLIC_API_LEAD_LIMIT_PER_HOUR = priorLimit;
  rmSync(folder, {recursive: true, force: true});
}
