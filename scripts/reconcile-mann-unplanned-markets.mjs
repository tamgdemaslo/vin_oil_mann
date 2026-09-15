import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const expanded=process.argv[2]==='--remaining-v2';
assert.ok(process.argv.length===2||(process.argv.length===3&&expanded));
const read=async path=>{const raw=await readFile(path,'utf8');return {raw,data:JSON.parse(raw)}};
const rematch=await read(resolve(dir,'unplanned-literal-branch-rematch-v1.json'));
const pre=await read(resolve(dir,'unplanned-matches-preflight-v2.json'));
const manifest=await read(resolve(dir,'manifest.json'));
const plan=await read(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'));
assert.equal(expanded?plan.data.unplannedScopedHistory.parentPlanHash:sha(plan.raw),pre.data.planHash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),manifest.data.sourceHash);
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),manifest.data.rawHash);
const rows=new Map(raw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const live=await read(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'));
const reviews=await read(resolve(root,'outputs/mann-live-audit-1789415211923/reviewDecisions.json'));
const confirmed=new Set(reviews.data.filter(r=>r.decision==='CONFIRM').map(r=>r.revisionId));
const findings=[];
for(const f of rematch.data.findings){
 const source=sources.get(f.sourceRequirementId);assert.equal(sha(source),f.originalSourceHash);
 const row=rows.get(source.sourceRowId),anchor=rows.get(f.branch.anchorRowId);assert.equal(sha(anchor),f.branch.anchorHash);
 const audit=pre.data.findings.find(p=>p.sourceRequirementId===source.id);
 const remaining=[...f.reasons],evidence={rawRowHash:sha(row),anchorHash:sha(anchor)};
 if(remaining.includes('SOURCE_MARKET_SCOPE')){
  // Engine oil uses its completely parsed own anchor; shared fluids must have
  // a bare, unconditional application cell in the very same source table.
  const bare={ENGINE_COOLANT:expanded?['АНТИФРИЗ','АНТИФРИЗ В СИСТЕМУ ОХЛАЖДЕНИЯ']:['АНТИФРИЗ'],BRAKE_FLUID:expanded?['ТОРМОЗНАЯ ЖИДКОСТЬ','МАСЛО в ТОРМОЗНУЮ СИСТЕМУ']:['ТОРМОЗНАЯ ЖИДКОСТЬ']};
  const ownApplicationClear=source.systemCode==='ENGINE_OIL'?row.row_id===anchor.row_id:
   bare[source.systemCode]?.includes(row.application?.trim())&&!row.model?.trim();
  const sameTable=row.source_url===anchor.source_url&&row.table_index===anchor.table_index;
  const extraMarket=/Россия|Япония|Европа|США|ОАЭ|Китай|Корея|Азия/iu.test([row.fill_volume,row.specification,row.recommendation,row.replacement_interval,row.control_interval,row.analog].join('\n'));
  if(ownApplicationClear&&sameTable&&!extraMarket&&f.proposedScope.requiredMarket===f.branch.requiredMarket){
   remaining.splice(remaining.indexOf('SOURCE_MARKET_SCOPE'),1);
   evidence.marketResolution='EXACT_PARSED_ENGINE_BRANCH_WITH_UNCONDITIONAL_OWN_FLUID_APPLICATION';
  }
 }
 const predecessors=live.data.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===f.vehicleVariantKey);
 if(remaining.includes('EXISTING_PREDECESSOR_RECONCILIATION')){
  const unprotected=predecessors.length&&predecessors.every(r=>!r.reviewConfirmed&&!confirmed.has(r.id)&&!r.applyEligible&&r.verificationStatus==='UNVERIFIED'&&r.systemCode===source.systemCode&&(r.componentModel??null)===(source.componentModel??null));
  if(unprotected){remaining.splice(remaining.indexOf('EXISTING_PREDECESSOR_RECONCILIATION'),1);evidence.predecessorPolicy='SCOPED_DISPLAY_ONLY_NO_GLOBAL_SUPERSESSION';}
 }
 if(audit.sections.status!=='NO_EXPLICIT_MARKER'&&!(expanded&&audit.sections.status==='EXPLICIT_ANALOG_SEPARATED'))remaining.push('SPECIFICATION_ROLE_REPARSE_REQUIRED');
 if(expanded&&audit.sections.status==='EXPLICIT_ANALOG_SEPARATED')evidence.specificationPolicy='EXPLICIT_SOURCE_ROLES_V1';
 if(expanded&&source.systemCode==='BRAKE_FLUID'&&row.fill_volume?.trim()==='по необходимости'&&!audit.parsedCapacity.capacities.length){
  const index=remaining.indexOf('CAPACITY_OR_SERVICE_CONDITION');if(index>=0)remaining.splice(index,1);
  evidence.capacityPolicy='EXPLICIT_AS_NEEDED_NO_NUMERIC_VOLUME';
 }
 const alreadyPresent=plan.data.newRevisions.some(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===f.vehicleVariantKey);
 findings.push({sourceRequirementId:source.id,vehicleVariantKey:f.vehicleVariantKey,scopeHash:sha(f.proposedScope),originalReasons:f.reasons,remainingReasons:remaining,evidence,predecessors:predecessors.map(r=>({id:r.id,hash:sha(r)})),status:alreadyPresent?'ALREADY_IN_CANONICAL':remaining.length?'HOLD':'SCOPED_DRAFT_READY',productionApplyAllowed:false});
}
const summary={pairs:findings.length,ready:findings.filter(f=>f.status==='SCOPED_DRAFT_READY').length,marketResolved:findings.filter(f=>f.evidence.marketResolution).length,predecessorsReconciledForScopedDisplay:findings.filter(f=>f.evidence.predecessorPolicy).length};
await writeFile(resolve(dir,expanded?'unplanned-market-predecessor-reconciliation-v2.json':'unplanned-market-predecessor-reconciliation-v1.json'),JSON.stringify({kind:'SCOPED_MARKET_PREDECESSOR_RECONCILIATION',planHash:sha(plan.raw),rematchHash:sha(rematch.raw),preflightHash:sha(pre.raw),liveHash:sha(live.raw),reviewHash:sha(reviews.raw),summary,findings,productionApplyAllowed:false,limitations:['Archived source and database snapshot only.','Legacy records remain outside qualified new scope; no global replacement authorized.','Analog-role and capacity conditions retained.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
