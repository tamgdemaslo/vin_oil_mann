import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {mercedesSourceEngineEvidence} from './lib/mann-mercedes-source-engine.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const replayRaw=await readFile(resolve(dir,'mercedes-import-matcher-replay-v1.json'),'utf8'),replay=JSON.parse(replayRaw),planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);assert.equal(sha(planRaw),replay.planHash);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),replay.sourceHash);const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),replay.mannHash);const mann=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');const rows=raw.trim().split('\n').map(JSON.parse),byRow=new Map(rows.map(r=>[r.row_id,r])),tables=Map.groupBy(rows,r=>JSON.stringify([r.source_url,r.table_index]));
const denyRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8'),denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts'),{splitMannEngineCodeList:split}=await j.import('../src/lib/mann-engine-code-list.ts'),{normalizeEngineCode:normalize}=await j.import('../src/lib/vehicle-normalization.ts');
const findings=[];
for(const f of replay.findings.filter(f=>f.addedValidatedTargets.length))for(const key of f.addedValidatedTargets){
 const source=sources.get(f.sourceRequirementId),row=byRow.get(source.sourceRowId),targets=mann.get(key);assert.ok(row&&targets?.length);
 const existing=plan.newRevisions.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===key);
 const targetCodes=[...new Set(targets.flatMap(t=>split(t.engineCode).map(normalize)).filter(Boolean))];
 const anchors=tables.get(JSON.stringify([row.source_url,row.table_index])).filter(r=>r.system_name==='МАСЛО в ДВИГАТЕЛЬ').map(r=>({row:r,exactCodes:mercedesSourceEngineEvidence(r.model).map(e=>e.code)}));
 const matching=anchors.filter(a=>a.exactCodes.some(c=>targetCodes.includes(normalize(c)))),reasons=[];
 if(matching.length!==1)reasons.push('REQUIRES_UNIQUE_MATCHING_ENGINE_ANCHOR');
 const windows=targets.map(t=>applicabilityWindow(source,t));
 if(windows.some(w=>!w)||new Set(windows.map(sha)).size!==1)reasons.push('MANN_DATE_WINDOW_REVIEW');
 const window=windows[0]??null,capacity=parse(source.fillVolumeText,source.systemCode);
 if(capacity.needsReview)reasons.push('CAPACITY_REVIEW');
 const fingerprint=originalAssociationFingerprint(key,source,capacity);if(denied.has(fingerprint))reasons.push('ORIGINAL_ASSOCIATION_DENIED');
 if(targets.some(t=>t.condition))reasons.push('MANN_CONDITION_REVIEW');
 if(['MANUAL_TRANSMISSION','AUTOMATIC_TRANSMISSION'].includes(source.systemCode))reasons.push('INSTALLED_TRANSMISSION_SCOPE_REVIEW');
 if(matching.length===1){
  const anchor=matching[0].row,year=anchor.production_years?.match(/^\s*(\d{4})\s*[-–]\s*(\d{4})\s*$/);
  if(!year||!window?.intersection.from||!window?.intersection.to||window.intersection.from<`${year[1]}-01`||window.intersection.to>`${year[2]}-12`)reasons.push('ENGINE_ANCHOR_DATE_SCOPE_REVIEW');
  const power=anchor.power?.match(/^\s*(\d+(?:[.,]\d+)?)\s*л\.с\.\s*$/);
  if(source.powerHp!=null&&(!power||Number(power[1].replace(',','.'))!==source.powerHp))reasons.push('ENGINE_ANCHOR_POWER_REVIEW');
 }
 findings.push({sourceRequirementId:source.id,vehicleVariantKey:key,systemCode:source.systemCode,existingRevisionIds:existing.map(r=>r.id),status:existing.length?'EXISTING_PAIR_RECONCILE_SCOPE':reasons.length?'NEW_PAIR_REQUIRES_REVIEW':'NEW_PAIR_PASSES_INITIAL_STRUCTURAL_CHECKS',reasons,sourceHash:sha(source),sourceRow:row,matchingAnchors:matching,otherAnchors:anchors.filter(a=>!matching.includes(a)),targetCodes,window,capacity,originalAssociationFingerprint:fingerprint,independentOemVerified:false,publicationAllowed:false});
}
assert.equal(new Set(findings.map(f=>`${f.sourceRequirementId}:${f.vehicleVariantKey}`)).size,findings.length);
const newPairs=findings.filter(f=>!f.existingRevisionIds.length);
const summary={sources:new Set(findings.map(f=>f.sourceRequirementId)).size,pairs:findings.length,existingPairs:findings.length-newPairs.length,newPairs:newPairs.length,statuses:Object.fromEntries([...Map.groupBy(findings,f=>f.status)].map(([k,v])=>[k,v.length])),newPairReasons:Object.fromEntries([...Map.groupBy(newPairs.flatMap(f=>f.reasons),x=>x)].map(([k,v])=>[k,v.length]))};
const report={kind:'MERCEDES_GAINED_TARGET_SOURCE_GATE_TRIAGE',planHash:sha(planRaw),replayHash:sha(replayRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),rawHash:sha(raw),denylistHash:sha(denyRaw),summary,findings,productionApplyAllowed:false,limitations:['Initial structural screening only; not materialized revisions or publication approval.','Existing source/variant pairs are not counted as new fluid coverage; exact scope comparison remains necessary.','Matched raw engine anchor, original-source denylist fingerprint and month intersection preserved. Other source market/body/technical/manual-review gates remain.','No source facts or OEM approval inferred from absence of an initial blocker.']};
await writeFile(resolve(dir,'mercedes-gained-target-triage-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
