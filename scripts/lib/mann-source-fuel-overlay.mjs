import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './mann-offline-scope.mjs';

export function applyFuelCorrections(requirements,proof,fresh){
 assert.equal(proof.productionApplyAllowed,false);assert.equal(proof.kind,'VOLVO_FUEL_IMPORT_TRANSITION');
 assert.equal(requirements.length,proof.summary.requirements);assert.equal(fresh.size,requirements.length);
 const byId=new Map(requirements.map(r=>[r.id,r]));assert.equal(byId.size,requirements.length);
 const changes=new Map();
 for(const d of proof.differences){
  const source=byId.get(d.id),rebuilt=fresh.get(d.id);assert.ok(source&&rebuilt&&!changes.has(d.id));
  assert.equal(source.fuelType,d.beforeFuel);assert.equal(rebuilt.fuelType,d.afterFuel);
  assert.equal(d.beforeFuel,'gasoline');assert.equal(d.afterFuel,'diesel');
  assert.equal(source.rawRequirementJson?.sourceFuelCorrection,undefined);
  assert.deepEqual(rebuilt.rawRequirementJson.sourceFuelCorrection,d.provenance);
  changes.set(d.id,d);
 }
 assert.equal(changes.size,19);assert.equal(changes.size,proof.summary.changed);
 return {changes,requirements:requirements.map(r=>{
  const d=changes.get(r.id);return d?{...r,fuelType:d.afterFuel,rawRequirementJson:{...r.rawRequirementJson,sourceFuelCorrection:structuredClone(d.provenance)}}:r;
 })};
}

export async function applyAuditedSourceFuel(root,requirements,raw){
 const dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
 const proofRaw=await readFile(resolve(dir,'volvo-fuel-import-transition-v1.json'),'utf8');
 assert.equal(sha(proofRaw),'e08d9e5f718c9cd37fd280b1147971d0b4ece3e8be3870ee60f7925e5958accf');const proof=JSON.parse(proofRaw);
 assert.equal(sha(raw),proof.rawHash);
 assert.equal(sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8')),proof.afterParserHash);
 assert.equal(sha(await readFile(resolve(root,'src/lib/fluid-volvo-source-fuel.ts'),'utf8')),proof.helperHash);
 assert.equal(sha(await readFile(resolve(root,'src/lib/fluid-volvo-source-fuel-data.json'),'utf8')),proof.dataHash);
 const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{prepareFluidCatalog}=await j.import('../../src/lib/fluid-catalog.ts');
 const fresh=new Map(prepareFluidCatalog({rowsNdjson:raw,mannFiltersCsv:''}).requirements.map(r=>[r.id,r]));
 return {...applyFuelCorrections(requirements,proof,fresh),proofHash:sha(proofRaw),parserHash:proof.afterParserHash,fresh};
}
