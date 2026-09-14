import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {sourceMarketBranches} from './lib/mann-source-market-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5');const plan=JSON.parse(planRaw);
const batchRaw=await readFile(resolve(root,'outputs/mann-held-power-current-recheck-2026-09-14/repair-batches-v1.json'),'utf8');
const entries=JSON.parse(batchRaw).batches.filter(b=>b.stage==='STRONG_IDENTITY_EXACT_ENGINE_RECHECK_CONDITIONS'&&b.make==='hyundai'&&b.model==='solaris'&&['BRAKE_FLUID','ENGINE_COOLANT'].includes(b.systemCode)).flatMap(b=>b.entries);assert.equal(entries.length,4);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mann=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');assert.equal(sha(mann),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s])),targets=parseCopy(mann,'mann_filter_applications');
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const rows=raw.trim().split('\n').map(JSON.parse),rawById=new Map(rows.map(r=>[r.row_id,r]));
const findings=entries.map(e=>{
 const s=sources.get(e.sourceRequirementId);assert.equal(sha(s),e.sourceHash);assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===s.id));
 const sourceRow=rawById.get(s.sourceRowId);assert.equal(sourceRow.source_url,s.sourceUrl);
 const anchors=rows.filter(r=>r.source_url===sourceRow.source_url&&r.table_index===sourceRow.table_index&&r.system_name==='МАСЛО в ДВИГАТЕЛЬ');assert.equal(anchors.length,1);
 const anchor=anchors[0],branches=sourceMarketBranches(anchor.model,anchor.production_years);assert.equal(branches.length,1);const branch=branches[0];
 assert.equal(branch.market,'RU');assert.equal(branch.powerHp.length,1);assert.deepEqual(s.engineCodesJson,[branch.engineCode]);assert.equal(s.powerHp,branch.powerHp[0]);
 const candidates=targets.filter(r=>e.topVariantIds.includes(r.vehicleVariantKey));assert.ok(candidates.length);assert.ok(candidates.every(r=>r.model==='Solaris'&&r.engineCode===branch.engineCode));
 const windows=candidates.map(r=>applicabilityWindow(s,r));assert.ok(windows.every(w=>w));assert.ok(windows.every(w=>sha(w)===sha(windows[0])));
 assert.deepEqual(windows[0].intersection,{from:'2011-02',to:'2017-12'});
 const exactPower=candidates.every(r=>Number(r.hp)===branch.powerHp[0]);
 if(branch.engineCode==='G4FA')assert.ok(exactPower);else{assert.equal(branch.engineCode,'G4FC');assert.equal(branch.powerHp[0],123);assert.ok(candidates.every(r=>Number(r.hp)===122));}
 return {sourceRequirementId:s.id,originalSource:s,sourceHash:sha(s),sourceRow,anchor,anchorHash:sha(anchor),branch,candidateRows:candidates,candidateWindow:windows[0].intersection,pendingPrefix:{from:'2010-01',to:'2011-01'},requiredMarket:'RU',powerStatus:exactPower?'EXACT_SOURCE_AND_TARGET_POWER':'SOURCE_TARGET_POWER_DISAGREEMENT',remainingGates:[...(!exactPower?['RESOLVE_123_VS_122_HP_WITHOUT_AUTOMATIC_EQUIVALENCE']:[]),'CONFIRM_TARGET_MARKET_OR_REQUIRE_EXPLICIT_RU_SELECTION','VERIFY_FLUID_SPECIFICATION_AND_CAPACITY_SOURCE','RETAIN_UNCOVERED_2010_TO_JANUARY_2011'],publicationAllowed:false};
});
const report={kind:'SOLARIS_FOUR_FLUID_SOURCE_BRANCH_REVIEW',planHash:sha(planRaw),batchesHash:sha(batchRaw),sourceHash:sha(sql),mannHash:sha(mann),rawHash:sha(raw),checked:4,exactPower:findings.filter(f=>f.powerStatus==='EXACT_SOURCE_AND_TARGET_POWER').length,powerDisagreement:findings.filter(f=>f.powerStatus==='SOURCE_TARGET_POWER_DISAGREEMENT').length,findings,productionApplyAllowed:false,limitations:['Prior high matcher score did not prove exact raw power, market or month coverage.','Source years are year envelopes; December 2017 is not manufacturer production-end proof.','No draft or runtime alias added. Requirements and capacities remain secondary-source evidence.']};
await writeFile(resolve(dir,'solaris-four-fluid-scope-review-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined}));
