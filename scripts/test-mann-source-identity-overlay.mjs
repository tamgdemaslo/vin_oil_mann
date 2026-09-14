import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {applyIdentityCorrections,loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..');
const fluidRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
const originals=parseCopy(fluidRaw,'vehicle_fluid_requirements'),before=JSON.stringify(originals);
const file=resolve(root,'outputs/mann-combined-preview-plan-2026-09-13/source-reparse-identity-v4.json');
const report=JSON.parse(await readFile(file,'utf8'));
const overlay=await loadIdentityOverlay(root,fluidRaw,file);
assert.equal(overlay.requirements.length,13296);assert.equal(overlay.changes.size,2081);
assert.equal(JSON.stringify(originals),before);
for(const r of overlay.requirements){
  const original=overlay.originalById.get(r.id);
  for(const key of Object.keys(original).filter(k=>!['generation','bodyCodesJson','rawRequirementJson'].includes(k)))assert.deepEqual(r[key],original[key],key);
  const {sourceIdentity,...raw}=r.rawRequirementJson;
  const {sourceIdentity:oldIdentity,...oldRaw}=original.rawRequirementJson;
  assert.deepEqual(raw,oldRaw);
  if(!overlay.changes.has(r.id))assert.equal(r,original);
  const originalFromSql=originals.find(source=>source.id===r.id);
  assert.equal(originalAssociationFingerprint('test',originalFromSql,{capacities:[]}),originalAssociationFingerprint('test',original,{capacities:[]}));
}
for(const tamper of [
  r=>r.hashes.source='bad',
  r=>r.changes[0].after.fillVolumeText='999 L',
  r=>r.changes[0].before.generation='wrong',
  r=>r.changes.push(r.changes[0]),
  r=>r.changes[0].sourceUrl='https://wrong.example',
]){const bad=structuredClone(report);tamper(bad);assert.throws(()=>applyIdentityCorrections(originals,bad,sha(fluidRaw)));}
await assert.rejects(()=>loadIdentityOverlay(root,fluidRaw,file,'bad'));
const legacy=await loadIdentityOverlay(root,fluidRaw,null);
assert.equal(legacy.metadata,null);assert.deepEqual(legacy.requirements,originals);
console.log('Source identity overlay: full coverage, source immutability, technical fields and tamper guards passed');
