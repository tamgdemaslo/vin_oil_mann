import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const dir=resolve('outputs/mann-live-audit-1789469257907'),raw=await readFile(resolve(dir,'fabia-scoped-drafts.json'),'utf8'),draft=JSON.parse(raw);
const mr=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mr),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const rows=parseCopy(mr,'mann_filter_applications'),lr=await readFile(resolve(dir,'canonicalVehicles.json'),'utf8'),live=new Map(JSON.parse(lr).map(r=>[r.variantKey,r]));
const j=createJiti(import.meta.url,{alias:{'@':resolve('src')}}),{splitMannEngineCodeList:split}=await j.import('../src/lib/mann-engine-code-list.ts');
const parents=[],existing=[];
const integer=v=>typeof v==='string'&&/^\d+$/.test(v)&&Number(v)>0?Number(v):null;
for(const key of new Set(draft.newRevisions.map(r=>r.vehicleVariantKey))){
 const matches=rows.filter(r=>r.vehicleVariantKey===key);assert.ok(matches.length);
 if(live.has(key)){existing.push({key,hash:sha(live.get(key))});continue;}
 const identities=matches.map(r=>({make:r.make,model:r.model,vehicleText:r.vehicleText,engineCode:r.engineCode,vehicleYears:r.vehicleYears,vehicleYearFrom:r.vehicleYearFrom,vehicleYearTo:r.vehicleYearTo,kw:r.kw,hp:r.hp,condition:r.condition}));
 assert.equal(new Set(identities.map(sha)).size,1,'Multiple literal identities for one key');const i=identities[0];
 const data={variantKey:key,make:i.make,makeNormalized:i.make.toLowerCase(),model:i.model,modelNormalized:i.model.toLowerCase(),generation:null,bodyCodesJson:[],modelYears:i.vehicleYears,yearFrom:i.vehicleYearFrom,yearTo:i.vehicleYearTo,vehicleText:i.vehicleText,engineCode:i.engineCode,engineCodeNormalized:i.engineCode?.toUpperCase()??null,engineCodesJson:split(i.engineCode??''),engineVolumeCc:null,powerKw:integer(i.kw),powerHp:integer(i.hp),fuelType:null,driveType:null,transmissionType:null,conditionText:i.condition??null,sourceHashesJson:[...new Set(matches.map(r=>r.sourceHash))]};
 parents.push({data,canonicalPayloadHash:sha({policy:'ARCHIVED_MANN_PARENT_DRAFT_V1',data}),sourceRowHashes:matches.map(r=>r.sourceRowHash),identity:i});
}
assert.equal(parents.length,2);assert.equal(existing.length,1);
await writeFile(resolve(dir,'fabia-canonical-parent-drafts.json'),JSON.stringify({kind:'FABIA_CANONICAL_PARENT_DRAFTS',draftHash:sha(raw),mannHash:sha(mr),liveParentsHash:sha(lr),parents,existing,productionApplyAllowed:false,limitations:['Only literal MANN identity, no inferred generation/body/volume/fuel/drive/transmission.','Timestamps supplied at actual insertion; existing parents never overwritten.','Fluid applicability scope remains separate; no production writes.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({newParents:parents.length,existingPreserved:existing.length}));
