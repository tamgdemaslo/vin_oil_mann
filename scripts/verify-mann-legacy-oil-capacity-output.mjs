import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(raw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const rows=parseCopy(raw,'vehicle_fluid_requirements'),j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {oilRequirementsFromCatalogMatch:convert}=await j.import('../src/lib/fluid-oil-requirements.ts');
const {parseCapacities}=await j.import('../src/lib/fluid-catalog.ts');let checked=0,qualifiedScalar=0,unresolved=0,ignoredLegacyScalar=0;
for(const row of rows.filter(r=>r.systemCode==='ENGINE_OIL')){
 const before=sha(row),out=convert({requirement:row,score:0,matchedBy:[]}),caps=parseCapacities(row.fillVolumeText);
 const service=caps.filter(c=>['service','partial','with_filter'].includes(c.kind));
 const values=new Set(service.map(c=>c.minLiters));
 const expected=service.length&&values.size===1&&service.every(c=>c.qualifier==='EXACT'&&c.minLiters!=null&&c.minLiters===c.maxLiters)?service[0].minLiters:undefined;
 assert.equal(out.oil_capacity_liters,expected);assert.equal(sha(row),before);
 const poisoned=convert({requirement:{...row,serviceVolumeLiters:999,fillVolumeMaxLiters:999},score:0,matchedBy:[]});assert.deepEqual(poisoned,out);
 if(expected===undefined){unresolved++;if(row.fillVolumeText?.trim())assert.ok(out.oil_capacity_note.includes(row.fillVolumeText.trim()));if(row.serviceVolumeLiters!=null)ignoredLegacyScalar++;}else qualifiedScalar++;
 checked++;
}
assert.ok(checked>1500);const codeFiles=['src/lib/fluid-catalog.ts','src/lib/fluid-oil-requirements.ts','src/lib/fluid-capacity-parser.ts'];
const report={kind:'FULL_LEGACY_ENGINE_OIL_CAPACITY_OUTPUT_CHECK',sourceHash:sha(raw),scanned:rows.length,checked,qualifiedScalar,unresolved,ignoredLegacyScalar,legacyNumericPoisonTests:checked,codeHashes:Object.fromEntries(await Promise.all(codeFiles.map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))]))),productionApplyAllowed:false,limitation:'Capacity output semantics only; does not approve source-to-VIN identity or lubricant specifications.'};
await writeFile(resolve(dir,'legacy-oil-capacity-output-verification-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
