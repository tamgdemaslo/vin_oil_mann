import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const auditRaw=await readFile(resolve(dir,'partial-table-power-audit-v1.json'),'utf8'),audit=JSON.parse(auditRaw);
const priorRaw=await readFile(resolve(dir,'table-power-draft-scopes-v1.json'),'utf8'),prior=JSON.parse(priorRaw);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),audit.planHash);const plan=JSON.parse(planRaw);
const findings=prior.findings.filter(f=>f.reasons.length).map(f=>{
 const source=audit.findings.find(s=>s.sourceRequirementId===f.sourceRequirementId);assert.ok(source);
 const r=plan.newRevisions.find(r=>r.id===f.revisionId);assert.ok(r);
 const anchors=source.engineAnchors.filter(a=>f.engineScope.length&&f.engineScope.every(c=>a.source.engineCodesJson.includes(c))&&a.source.powerHp!=null&&f.targetRows.every(t=>Number(t.hp)===a.source.powerHp));
 const status=anchors.length===1?'EXACT_ENGINE_POWER_ANCHOR_FOUND':'ENGINE_POWER_ATTRIBUTION_UNRESOLVED';
 const oldWindow=r.applicabilityJson.window.intersection;
 // Explicit reviewed raw date phrases below, not general inference from text.
 let proposedWindow=null;
 if(['mtar_ac16d209169cbf87258a46db','mtar_d56864b3b0ea0e4b98ed4af2'].includes(r.id)){
  assert.equal(anchors.length,1);assert.equal(anchors[0].raw.model,'- HR12DDR / 98 л.с. / 2015 - 2020');
  assert.deepEqual(oldWindow,{from:'2013-09',to:'2020-12'});proposedWindow={from:'2015-01',to:'2020-12'};
 }
 if(['mtar_ff7c153fc08e33ef1bc55f9b','mtar_fdd27f42e884b4a4979a4006'].includes(r.id)){
  assert.equal(anchors.length,1);assert.equal(anchors[0].raw.model,'- 2.0 D4 (D4204T5) / 181 л.с. / 2015-2018');
  assert.deepEqual(oldWindow,{from:'2013-11',to:'2015-12'});proposedWindow={from:'2015-01',to:'2015-12'};
 }
 return {revisionId:r.id,sourceRequirementId:f.sourceRequirementId,status,independentAnchors:anchors,allOriginalAnchors:source.engineAnchors,oldWindow,proposedWindow,requiresDateNarrowing:!!proposedWindow,publicationAllowed:false};
});
assert.equal(findings.length,9);assert.equal(findings.filter(f=>f.requiresDateNarrowing).length,4);assert.equal(findings.filter(f=>f.status==='EXACT_ENGINE_POWER_ANCHOR_FOUND').length,6);
const report={kind:'NINE_DRAFT_ENGINE_POWER_AND_DATE_REVIEW',auditHash:sha(auditRaw),priorHash:sha(priorRaw),planHash:sha(planRaw),checked:9,exactEnginePowerSupported:6,attributionUnresolved:3,dateNarrowingRequired:4,findings,productionApplyAllowed:false,limitations:['Proposed year-derived month envelopes are not independently verified production-month facts.','These findings do not approve fluid specifications or equipment. No canonical edits in this review; four earlier periods must not be published without resolution.']};
await writeFile(resolve(dir,'nine-draft-power-date-review-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined}));
