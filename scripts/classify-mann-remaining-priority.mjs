import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const hashes={};
async function read(name){const raw=await readFile(resolve(dir,name),'utf8');hashes[name]=sha(raw);return JSON.parse(raw);}
const pre=await read('vin-priority-fluid-preflight-v3.json'),qualifiers=await read('mann-country-qualifier-audit-v1.json'),trace=await read('mann-missing-engine-source-audit-v1.json');
const plan=await read('plan.json');assert.equal(hashes['plan.json'],pre.planHash);
assert.equal(qualifiers.inputHashes.preflight,hashes['vin-priority-fluid-preflight-v3.json']);
const keys=new Set(qualifiers.findings.map(f=>f.vehicleVariantKey));
assert.ok(plan.newRevisions.every(r=>!keys.has(r.vehicleVariantKey)));
const excluded=pre.findings.filter(f=>keys.has(f.vehicleVariantKey));
const remaining=pre.findings.filter(f=>!keys.has(f.vehicleVariantKey));
assert.equal(excluded.length,277);assert.equal(remaining.length,618);
assert.equal(remaining.length+excluded.length+pre.alreadyDrafted.length,900);
const parents=trace.findings.flatMap(f=>f.applicationMatches);
assert.equal(parents.filter(p=>p.engineCode?.trim()||p.rawCells?.engine?.trim()).length,0);
const absent=remaining.filter(f=>f.reasons.includes('MANN_ENGINE_CODE_ABSENT'));
const tracedKeys=new Set(trace.findings.map(f=>f.variantKey));
assert.ok(absent.every(f=>tracedKeys.has(f.vehicleVariantKey)));
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
hashes.rawSource=sha(raw);
const rows=new Map(raw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const anchors=new Map();
for(const f of remaining)for(const a of f.applications.filter(a=>!a.parsed)){
 const row=rows.get(a.rowId);assert.ok(row);assert.equal(sha(row),a.rowHash);
 if(!anchors.has(a.rowId))anchors.set(a.rowId,{rowId:a.rowId,sourceUrl:row.source_url,application:row.application,affectedPairs:[]});
 anchors.get(a.rowId).affectedPairs.push({sourceRequirementId:f.sourceRequirementId,vehicleVariantKey:f.vehicleVariantKey});
}
const missingIdentity=[...Map.groupBy(absent,f=>f.vehicleVariantKey)].map(([key,pairs])=>{
 const evidence=trace.findings.filter(f=>f.variantKey===key);
 return {vehicleVariantKey:key,make:evidence[0].make,model:evidence[0].model,vehicleText:evidence[0].vehicleText,affectedPairs:pairs.length,originalFilterRows:evidence.length,action:'INDEPENDENT_ENGINE_IDENTITY_EVIDENCE_REQUIRED'};
});
const summary={originalPriorityPairs:900,alreadyDrafted:pre.alreadyDrafted.length,excludedQualifierPairs:excluded.length,remainingPairs:remaining.length,remainingSources:new Set(remaining.map(f=>f.sourceRequirementId)).size,missingEnginePairs:absent.length,missingEngineVariants:missingIdentity.length,unparsedAnchorRows:anchors.size,previouslyPreflightReady:remaining.filter(f=>!f.reasons.length).length};
await writeFile(resolve(dir,'remaining-priority-action-queue-v1.json'),JSON.stringify({kind:'REMAINING_PRIORITY_ACTION_QUEUE',inputHashes:hashes,summary,missingIdentity,unparsedAnchors:[...anchors.values()].sort((a,b)=>b.affectedPairs.length-a.affectedPairs.length),excludedPairs:excluded.map(f=>({sourceRequirementId:f.sourceRequirementId,vehicleVariantKey:f.vehicleVariantKey})),remainingPairs:remaining.map(f=>({sourceRequirementId:f.sourceRequirementId,vehicleVariantKey:f.vehicleVariantKey,reasons:f.reasons})),productionApplyAllowed:false,limitations:['This is the recorded-VIN priority cohort, not the whole database.','Actions and reason counts overlap; links are not unique vehicles or manual tasks.','Absent engine verified through saved exact CSV trace, not visual inspection of PDF.','Preflight-ready pairs retain earlier rematch holds; no new approvals or drafts.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
