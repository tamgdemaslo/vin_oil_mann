import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';

const folder = await mkdtemp(join(tmpdir(), 'vehicle-confirmation-revision-'));
const slot = Symbol.for('test.clientVehicle.confirmationRevision');
const calls = { updates: [], revisions: [] };
const oldSource = { source: 'tronk_vindecode', confidence: 'HIGH', verificationStatus: 'AUTO_FILLED', updatedAt: '2026-09-01T10:00:00.000Z' };
const existing = {
  id: 'vehicle-a', branchId: 'branch-a', counterpartyId: 'client-a', status: 'ACTIVE',
  make: 'KIA', model: 'Rio', transmissionType: 'АКПП', driveType: 'Передний',
  mannVariantIdsJson: ['variant-a'], fieldSourcesJson: { transmissionType: oldSource, driveType: oldSource },
  confidence: 'HIGH', verificationStatus: 'AUTO_FILLED',
  createdAt: new Date('2026-09-01T10:00:00.000Z'), updatedAt: new Date('2026-09-01T10:00:00.000Z'),
};
const tx = {
  clientVehicle: { update: async args => { calls.updates.push(args); return { ...existing, ...args.data, updatedAt: new Date() }; } },
  clientVehicleRevision: { create: async args => { calls.revisions.push(args); return args.data; } },
  localCounterparty: { update: async () => ({}) },
};
globalThis[slot] = {
  localCounterparty: { findFirst: async () => ({ id: 'client-a', raw: {}, searchText: '' }) },
  clientVehicle: { findFirst: async () => existing },
  mannFilterApplication: { findMany: async () => [{ vehicleVariantKey: 'variant-a', make: 'KIA' }] },
  $transaction: async callback => callback(tx),
};
try {
  const mock = join(folder, 'db.cjs');
  await writeFile(mock, "exports.prisma = globalThis[Symbol.for('test.clientVehicle.confirmationRevision')];\n");
  const jiti = createJiti(import.meta.url, { alias: { '@/lib/db': mock, '@': resolve('src') } });
  const { upsertClientVehicleProfile } = await jiti.import('../src/lib/client-vehicle-profile-server.ts');
  const { normalizeManualVehicleProfile } = await jiti.import('../src/lib/client-vehicle-profile.ts');
  const before = Date.now();
  const result = await upsertClientVehicleProfile({
    branchId: 'branch-a', counterpartyId: 'client-a', vehicleId: 'vehicle-a',
    mode: 'confirmed', write: normalizeManualVehicleProfile({ transmissionType: 'АКПП' }),
    actor: { login: 'reviewer', name: 'Reviewer' },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedFields, [], 'source-only confirmation does not change identity values');
  assert.equal(calls.updates.length, 1);
  const saved = calls.updates[0].data;
  assert.deepEqual(saved.mannVariantIdsJson, ['variant-a'], 'omitted selection preserves existing MANN');
  const proof = saved.fieldSourcesJson.transmissionType;
  assert.equal(proof.verificationStatus, 'CONFIRMED');
  assert.equal(proof.updatedBy, 'reviewer');
  assert.equal(proof.source, 'vehicle_card');
  assert.ok(Date.parse(proof.updatedAt) >= before && Date.parse(proof.updatedAt) <= Date.now());
  assert.deepEqual(saved.fieldSourcesJson.driveType, oldSource, 'unsubmitted drive stays unconfirmed');
  assert.equal(calls.revisions.length, 1, 'confirmation-only must create an actual revision');
  const revision = calls.revisions[0].data;
  assert.deepEqual(revision.changedFieldsJson, []);
  assert.deepEqual(revision.snapshotJson.confirmedFields, ['transmissionType']);
  assert.deepEqual(revision.snapshotJson.fieldSources.transmissionType, proof);
  assert.equal(revision.actorLogin, 'reviewer');
  assert.equal(revision.verificationStatus, 'CONFIRMED');
  assert.deepEqual(revision.snapshotJson.mannVariantIds, ['variant-a']);
  console.log('PASS source-only passport confirmation persists provenance and audited revision without MANN reset');
  const reviewedKey='mann-online:mercedes:w203:c200kompressor:m111955:200005-200205';
  existing.make='MERCEDES-BENZ';existing.model='C-Klasse';existing.mannVariantIdsJson=[];
  globalThis[slot].mannFilterApplication.findMany=async()=>[];
  const selected=await upsertClientVehicleProfile({branchId:'branch-a',counterpartyId:'client-a',vehicleId:'vehicle-a',mode:'confirmed',write:normalizeManualVehicleProfile({}),mannVariantIds:[reviewedKey],actor:{login:'reviewer',name:'Reviewer'}});
  assert.equal(selected.ok,true,'reviewed code-backed MANN variant must be saveable');
  assert.deepEqual(calls.updates.at(-1).data.mannVariantIdsJson,[reviewedKey]);
  existing.make='KIA';existing.model='Rio';
  const wrongMake=await upsertClientVehicleProfile({branchId:'branch-a',counterpartyId:'client-a',vehicleId:'vehicle-a',mode:'confirmed',write:normalizeManualVehicleProfile({}),mannVariantIds:[reviewedKey],actor:{login:'reviewer',name:'Reviewer'}});
  assert.equal(wrongMake.ok,false,'reviewed supplement still requires matching make');
  console.log('PASS reviewed MANN supplement saves to passport and rejects cross-make selection');

} finally {
  delete globalThis[slot];
  await rm(folder, { recursive: true, force: true });
}
