import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {reviewStagedInterval} from './lib/mann-staged-interval-review.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const sources=parseCopy(sql,'vehicle_fluid_requirements');assert.equal(sources.length,13296);
const discoveryBytes=await readFile(resolve(dir,'staged-service-interval-discovery-v1.json'),'utf8');
const oldIds=new Set(JSON.parse(discoveryBytes).findings.map(f=>f.sourceRequirementId));
const groups=new Map();let leads=0,newLeads=0;
for(const s of sources){
 const text=s.replacementIntervalText??'';
 // Expanded inflections include "для первой заливки", omitted from earlier first-marker flag.
 if(!/перв(?:ая|ый|ое|ые|ую|ого|ой|оначаль)|далее|затем|последующ|после\s+(?:этого|чего)|повторн|\d[\s\u00a0]\d{3}\s*км/iu.test(text))continue;
 leads++;if(!oldIds.has(s.id))newLeads++;
 const g=groups.get(text)??{text,extraction:reviewStagedInterval(text),sources:[]};
 g.sources.push({sourceRequirementId:s.id,sourceHash:sha(s),systemCode:s.systemCode,sourceUrl:s.sourceUrl});groups.set(text,g);
}
const items=[...groups.values()].sort((a,b)=>b.sources.length-a.sources.length);
const counts={checked:sources.length,leads,newLeads,distinctTexts:items.length,exactTwoStageSources:items.filter(g=>g.extraction.status==='EXACT_TWO_STAGE_TEXT').reduce((n,g)=>n+g.sources.length,0),exactTwoStageTexts:items.filter(g=>g.extraction.status==='EXACT_TWO_STAGE_TEXT').length,reviewSources:items.filter(g=>g.extraction.status==='REVIEW_REQUIRED').reduce((n,g)=>n+g.sources.length,0)};
assert.equal(counts.exactTwoStageSources+counts.reviewSources,leads);
assert.equal(new Set(items.flatMap(g=>g.sources.map(s=>s.sourceRequirementId))).size,leads);
const report={kind:'OFFLINE_STAGED_INTERVAL_GRAMMAR_PARTITION',sourceHash:sha(sql),discoveryHash:sha(discoveryBytes),extractorHash:sha(await readFile(resolve(root,'scripts/lib/mann-staged-interval-review.mjs'),'utf8')),counts,groups:items,limitations:['Exact text extraction is not OEM validation or vehicle applicability.','Source OR and parenthetical syntax remain distinct; no missing relationship inferred.','No first stage inferred from an unlabelled leading threshold.','Whole input scan with lexical lead selection, not a claim of exhaustive semantic detection.','Original DB, runtime and canonical unchanged.'],productionApplyAllowed:false};
await writeFile(resolve(dir,'staged-service-interval-partition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(counts));
