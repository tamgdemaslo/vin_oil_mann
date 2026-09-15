import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './mann-offline-scope.mjs';
// Apply only the previously audited ambiguous-table power correction.
// Original requirements remain unchanged for denylist/fingerprint purposes.
export async function applyAuditedTablePower(root,requirements,rawText){
 const proofRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/table-power-reparse-transition-v1.json'),'utf8');
 assert.equal(sha(proofRaw),'7957aec888217d8601633967e037a102ac14b9bd8e3207724ac8cdc9d462e2df');
 const proof=JSON.parse(proofRaw);assert.equal(sha(rawText),proof.snapshotHash);assert.equal(proof.productionApplyAllowed,false);
 const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{prepareFluidCatalog}=await j.import('../../src/lib/fluid-catalog.ts');
 const fresh=new Map(prepareFluidCatalog({rowsNdjson:rawText,mannFiltersCsv:''}).requirements.map(r=>[r.id,r]));
 const byId=new Map(requirements.map(r=>[r.id,r]));assert.equal(fresh.size,13296);assert.equal(byId.size,13296);
 const changes=new Map();
 for(const change of proof.changes){
  const source=byId.get(change.id),parsed=fresh.get(change.id);assert.ok(source&&parsed);assert.ok(!changes.has(change.id));
  assert.deepEqual(Object.keys(change.before).sort(),Object.keys(change.after).sort());
  for(const key of Object.keys(change.before)){
   assert.ok(['powerHp','powerKw'].includes(key));assert.equal(source[key],change.before[key]);assert.equal(parsed[key],change.after[key]);assert.equal(change.after[key],null);
  }
  for(const key of ['powerHp','powerKw'])if(!(key in change.before))assert.equal(source[key],parsed[key]);
  changes.set(change.id,change);
 }
 assert.equal(changes.size,274);
 return {requirements:requirements.map(r=>changes.has(r.id)?{...r,...changes.get(r.id).after}:r),changes,proofHash:sha(proofRaw),parserHash:sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8'))};
}
