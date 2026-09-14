import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy,applicabilityWindow} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const priorRaw=await readFile(resolve(dir,'numeric-engine-loss-v1.json'),'utf8'),prior=JSON.parse(priorRaw);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),prior.planHash);const plan=JSON.parse(planRaw);
const sql=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sql),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const rows=parseCopy(sql,'mann_filter_applications');assert.equal(rows.length,37600);
const sourceSql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceSql),prior.sourceHash);
const sources=new Map(parseCopy(sourceSql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const glk=rows.filter(r=>r.make==='MERCEDES-BENZ'&&r.model==='GLK(X204)');
const held=plan.newRevisions.find(r=>r.id==='mtar_d4b6c6f3e580d7548d8610b3');assert.ok(held.provenanceJson.sourcePowerReviewHold);assert.equal(held.provenanceJson.catalogPreviewEligible,false);
const targetRows=glk.filter(r=>r.vehicleVariantKey===held.vehicleVariantKey);assert.ok(targetRows.length);assert.ok(targetRows.every(r=>r.engineCode==='M272.961'&&Number(r.hp)===272));
const first=prior.anchors.find(a=>a.rawModel==='272.971'),second=prior.anchors.find(a=>a.rawModel==='276.957');assert.ok(first&&second);
assert.equal(first.rawPower,'272 л.с.');assert.equal(second.rawPower,'249 л.с. / 306 л.с.');
const numericPart=code=>/^M\d{3}\.\d{3}$/.test(code??'')?code.slice(1):null;
const candidates=prior.anchors.map(a=>{
 const source=sources.get(a.sourceRequirementId);assert.equal(sha(source),a.sourceHash);
 const sameNumeric=glk.filter(r=>a.rawCodes.includes(numericPart(r.engineCode)));
 return {sourceRequirementId:a.sourceRequirementId,rawModel:a.rawModel,rawPower:a.rawPower,rawYears:a.rawYears,
  candidateVariants:[...Map.groupBy(sameNumeric,r=>r.vehicleVariantKey)].map(([key,records])=>({vehicleVariantKey:key,engineCode:records[0].engineCode,powerHp:Number(records[0].hp),window:applicabilityWindow(source,records[0]),originalMannRows:records,manufacturerEquivalenceVerified:false})),publicationAllowed:false};
});
assert.equal(candidates[0].sourceRequirementId,first.sourceRequirementId);assert.equal(candidates[0].candidateVariants.length,0);
const powers=candidates[1].candidateVariants.map(c=>c.powerHp).sort((a,b)=>a-b);assert.deepEqual(powers,[252,306]);
const lead306=candidates[1].candidateVariants.find(c=>c.powerHp===306);assert.deepEqual(lead306.window.intersection,{from:'2012-01',to:'2015-08'});
const report={kind:'GLK_NUMERIC_SOURCE_BRANCH_REVIEW',planHash:sha(planRaw),discoveryHash:sha(priorRaw),mannHash:sha(sql),sourceHash:sha(sourceSql),checkedMannRows:rows.length,affectedSourceIds:prior.affected.map(s=>s.sourceRequirementId),heldRevisionId:held.id,
 heldTargetEvidence:{rawSourceEngine:first.rawModel,targetEngine:'M272.961',targetRows,status:'NUMERIC_ENGINE_ID_DIFFERS_NOT_JUST_PREFIX',requiresIndependentFluidApplicability:true},candidates,
 remainingBranches:[{rawEngine:'272.971',powerHp:272,reason:'NO_SAME_NUMERIC_GLK_ENGINE_IN_SAVED_MANN'},{rawEngine:'276.957',powerHp:249,reason:'SAVED_MANN_252_IS_NOT_249'},{rawEngine:'276.957',powerHp:306,reason:'NUMERIC_SUFFIX_AND_POWER_LEAD_ONLY_REQUIRES_SOURCE_IDENTITY_AND_FLUID_REVIEW',candidateWindow:lead306.window.intersection}],
 productionApplyAllowed:false,limitations:['Saved catalogs can contain errors. This review establishes differences between records, not which physical engine is correct.','M prefix removal is used solely to discover candidates; no runtime alias or compatibility rule is created.','2012-01 is a year-derived source envelope, not a verified factory transition month. Shared fluid rows are not automatically assigned to the 306-hp branch.']};
await writeFile(resolve(dir,'glk-numeric-branch-review-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,candidates:undefined,heldTargetEvidence:undefined,affectedSourceIds:undefined}));
