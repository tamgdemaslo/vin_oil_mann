import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),mode=process.argv[2];assert.ok(['baseline','verify'].includes(mode));
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{prepareFluidCatalog}=await j.import('../src/lib/fluid-catalog.ts');
const prepared=prepareFluidCatalog({rowsNdjson:raw,mannFiltersCsv:''}),parserHash=sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8'));
if(mode==='baseline'){
 assert.equal(parserHash,'27204ec4b2b92106085793c38fcf5d2e7c24622289ca924bebbc06a855f72615');
 await writeFile(resolve(dir,'volvo-fuel-import-baseline-v1.json'),JSON.stringify({rawHash:sha(raw),parserHash,requirements:prepared.requirements},null,2)+'\n',{flag:'wx'});console.log('baseline '+prepared.requirements.length);
}else{
 const baselineRaw=await readFile(resolve(dir,'volvo-fuel-import-baseline-v1.json'),'utf8'),baseline=JSON.parse(baselineRaw);
 const evidenceRaw=await readFile(resolve(dir,'volvo-fuel-exact-evidence-v1.json'),'utf8');assert.equal(sha(evidenceRaw),'6778a1b462a7fdadddb6b50cfbb0f7899f7405a091a2fbf42de295c6c0cd21cd');
 const candidates=new Map(JSON.parse(evidenceRaw).proposals.filter(p=>p.after).map(p=>[p.requirementId,p]));
 assert.equal(baseline.rawHash,sha(raw));assert.equal(prepared.requirements.length,baseline.requirements.length);const differences=[];
 for(let i=0;i<prepared.requirements.length;i++){
  const before=baseline.requirements[i],after=prepared.requirements[i],proposal=candidates.get(before.id);
  if(!proposal){assert.deepEqual(after,before);continue;}
  assert.equal(after.fuelType,'diesel');assert.equal(before.fuelType,'gasoline');
  const {sourceFuelCorrection,...rest}=after.rawRequirementJson;assert.ok(sourceFuelCorrection);
  assert.equal(sourceFuelCorrection.evidenceHash,sha(evidenceRaw));assert.equal(sourceFuelCorrection.originalFuel,'gasoline');
  assert.equal(sourceFuelCorrection.marketReviewRequired,proposal.marketReviewRequired);
  assert.deepEqual({...after,fuelType:before.fuelType,rawRequirementJson:rest},before);
  differences.push({id:after.id,beforeFuel:before.fuelType,afterFuel:after.fuelType,provenance:sourceFuelCorrection});
 }
 assert.equal(differences.length,19);
 const report={kind:'VOLVO_FUEL_IMPORT_TRANSITION',rawHash:sha(raw),beforeParserHash:baseline.parserHash,afterParserHash:parserHash,baselineHash:sha(baselineRaw),helperHash:sha(await readFile(resolve(root,'src/lib/fluid-volvo-source-fuel.ts'),'utf8')),dataHash:sha(await readFile(resolve(root,'src/lib/fluid-volvo-source-fuel-data.json'),'utf8')),summary:{requirements:prepared.requirements.length,changed:19,unchanged:prepared.requirements.length-19},differences,productionApplyAllowed:false};
 await writeFile(resolve(dir,'volvo-fuel-import-transition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
}
