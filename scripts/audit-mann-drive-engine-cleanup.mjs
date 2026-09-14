#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
assert.equal(process.argv.length,2,'Read-only audit accepts no mutation flags');
const root=resolve(import.meta.dirname,'..');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann,normalizeFluidRequirementVehicle}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const [mannRaw,fluidRaw,baselineRaw]=await Promise.all([
  readFile('/tmp/mann_filter_applications.sql','utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(root,'outputs/mann-scoped-engine-alternatives-2026-09-13/decisions.ndjson'),'utf8')]);
const rows=parseCopy(mannRaw,'mann_filter_applications');
const source=parseCopy(fluidRaw,'vehicle_fluid_requirements');
const baseline=new Map(baselineRaw.trim().split('\n').map(line=>{const d=JSON.parse(line);return[d.requirementId,d];}));
const bad=code=>/^(?:2WD|4WD|AWD|FWD|RWD|4X4|4X2)$/.test(normalizeEngineCode(code)??'');
const affected=source.filter(r=>[r.engineCodeNormalized,...(r.engineCodesJson??[])].some(bad));
const results=[],cache=new Map();
for(const r of affected){
  const vehicle=normalizeFluidRequirementVehicle(r),make=vehicle?.canonicalMake??'';
  if(!cache.has(make)){const forms=new Set(mannMakeFormsForTest(make));cache.set(make,rows.filter(row=>forms.has(normalizeMannText(row.makeNormalized||row.make))));}
  const match=matchFluidRequirementToMann(r,cache.get(make));
  assert.ok(!(match.normalizedVehicle?.sourceExactEngineCodes??[]).some(bad));
  assert.ok(!bad(match.normalizedVehicle?.exactEngineCode));
  const old=baseline.get(r.id);assert.ok(old);
  results.push({requirementId:r.id,sourceUrl:r.sourceUrl,systemCode:r.systemCode,
    rawEngineCodes:[r.engineCodeNormalized,...(r.engineCodesJson??[])],
    cleanedEngineCodes:match.normalizedVehicle?.sourceExactEngineCodes??[],
    previousStatus:old.match.status,status:match.status,
    previousTargetKeys:old.match.targets.map(t=>t.vehicleVariantKey),targetKeys:match.targets.map(t=>t.vehicleVariantKey),
    reviewReasons:match.reviewReasons,topCandidate:match.topCandidates[0]});
  if(results.length%50===0)console.log(JSON.stringify({processed:results.length,total:affected.length}));
}
const transitions={};for(const r of results){const key=`${r.previousStatus} -> ${r.status}`;transitions[key]=(transitions[key]??0)+1;}
const report={kind:'DRIVE_TOKEN_ENGINE_CLEANUP_AUDIT',publicationAllowed:false,
  limitation:'Affected requirements only. Original year ranges, no month-scope retry; not a replacement for full queue.',
  sourceRequirements:source.length,affectedRequirements:results.length,
  sourceHashes:{mann:sha(mannRaw),fluids:sha(fluidRaw),baseline:sha(baselineRaw)},
  transitions,results};
await writeFile(resolve(root,'outputs/mann-scoped-engine-alternatives-2026-09-13/drive-engine-cleanup-audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,results:undefined},null,2));
