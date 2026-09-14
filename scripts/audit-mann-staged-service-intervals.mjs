import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const sources=parseCopy(sql,'vehicle_fluid_requirements');assert.equal(sources.length,13296);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5');
const plan=JSON.parse(planRaw);
const findings=[];
for(const s of sources){
 const text=s.replacementIntervalText??'';
 // Broad lexical discovery only, not an automatic interpretation of schedule semantics.
 const first=/перв(?:ая|ый|ое|ые|ую|ого|оначаль)/iu.test(text);
 const repeat=/далее|затем|последующ|после\s+(?:этого|чего)|повторн/iu.test(text);
 const groupedKm=/\d[\s\u00a0]\d{3}\s*км/iu.test(text);
 if(!first&&!repeat&&!groupedKm)continue;
 const revisions=plan.newRevisions.filter(r=>r.sourceRequirementId===s.id).map(r=>{
   const data=r.technicalDataJson;
   const stored=data.replacementInterval??data.replacementIntervalText??null;
   return {revisionId:r.id,storedInterval:stored,exactRawTextPreserved:stored===text};
 });
 findings.push({sourceRequirementId:s.id,sourceHash:sha(s),systemCode:s.systemCode,sourceUrl:s.sourceUrl,text,firstMarker:first,repeatMarker:repeat,groupedKm,
   legacyScalars:{kmMin:s.replacementKmMin,kmMax:s.replacementKmMax,months:s.replacementMonths},revisions});
}
const files=['src/lib/fluid-catalog.ts','src/lib/mann-unified-technical-profile.ts','src/components/shipment/VehicleLookupPanel.tsx'];
const runtimeHashes=Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))])));
const counts={checked:sources.length,withInterval:sources.filter(s=>s.replacementIntervalText).length,lexicalLeads:findings.length,bothFirstAndRepeat:findings.filter(f=>f.firstMarker&&f.repeatMarker).length,groupedKilometres:findings.filter(f=>f.groupedKm).length,associatedRevisions:findings.reduce((n,f)=>n+f.revisions.length,0),revisionTextDifferences:findings.flatMap(f=>f.revisions).filter(r=>!r.exactRawTextPreserved).length};
const report={kind:'WHOLE_SOURCE_STAGED_INTERVAL_DISCOVERY',sourceHash:sha(sql),planHash:sha(planRaw),runtimeHashes,counts,
 runtimeInspection:{profile:'toProfileItem obtains replacementInterval/replacementIntervalText via safeTextField, not numeric scalar fields.',ui:'VehicleLookupPanel renders item.replacementInterval text.',parser:'parseInterval selects first matching km/month/year; no first/subsequent structure. Grouped kilometre numbers are not handled by its singleKm expression.'},
 limitations:['Lexical discovery is not complete semantic classification or manufacturer verification.','Static consumer inspection does not prove deployed VIN behavior.','No inferred replacement schedule or automatic promotion.','Historical numeric fields may be incomplete, but that does not itself prove displayed full text is lost.'],findings,productionApplyAllowed:false};
await writeFile(resolve(dir,'staged-service-interval-discovery-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(counts));
