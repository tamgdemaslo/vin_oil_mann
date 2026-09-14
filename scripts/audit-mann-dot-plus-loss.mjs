import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const sources=parseCopy(sql,'vehicle_fluid_requirements');assert.equal(sources.length,13296);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);
assert.equal(sha(planRaw),'f22d1056d9af7913ee5b2521254b12763bb4e2e3d488267fbb7e28aa333be90a');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseSpecifications}=await j.import('../src/lib/fluid-catalog.ts');
const parserHash=sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8'));
assert.deepEqual(parseSpecifications('DOT-4+').filter(s=>s.type==='DOT').map(s=>s.value),['DOT-4']);
// Proposed token-preservation expression only. Not a standard approval or equivalence rule.
const proposed=text=>[...text.matchAll(/\bDOT\s*-?\s*[345](?:\+|\.1)?(?:\s+CLASS\s*\d+)?(?![\p{L}\p{N}_.+])/giu)].map(m=>m[0]);
for(const [text,expected] of [['DOT-4+',['DOT-4+']],['DOT 5.1',['DOT 5.1']],['DOT 4 CLASS 6',['DOT 4 CLASS 6']],['DOT 4+ / DOT 4',['DOT 4+','DOT 4']],['DOT 4+X',[]],['DOT 4.12',[]],['DOT 40',[]],['DOT 4+ж',[]]])assert.deepEqual(proposed(text),expected);
const findings=[];
for(const s of sources){
 const text=s.specificationText??'';
 const plus=proposed(text).filter(t=>t.includes('+'));if(!plus.length)continue;
 const current=parseSpecifications(text).filter(x=>x.type==='DOT').map(x=>x.value);
 if(plus.every(p=>current.includes(p)))continue;
 findings.push({sourceRequirementId:s.id,sourceHash:sha(s),systemCode:s.systemCode,sourceUrl:s.sourceUrl,originalText:text,expectedPreservedTokens:plus,currentDotTokens:current,storedDotTokens:s.specificationsJson.filter(x=>x.type==='DOT'),revisions:plan.newRevisions.filter(r=>r.sourceRequirementId===s.id).map(r=>({revisionId:r.id,specifications:r.technicalDataJson.specifications,previewHeld:!!r.provenanceJson.sourcePowerReviewHold})),publicationAllowed:false});
}
assert.equal(sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8')),parserHash);
const report={kind:'DOT_PLUS_TOKEN_LOSS_AUDIT',sourceHash:sha(sql),planHash:sha(planRaw),parserHash,checked:sources.length,affectedSources:findings.length,affectedRevisions:findings.reduce((n,f)=>n+f.revisions.length,0),proposedTokenTests:8,findings,productionApplyAllowed:false,limitations:['Original raw specification text remains intact; extracted token drops the plus suffix.','Proposed expression has only focused lexical tests and is not integrated into runtime. A complete parser transition and revision review are still needed.','Preserving a source token does not establish its technical suitability or interchangeability.']};
await writeFile(resolve(dir,'dot-plus-loss-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined}));
