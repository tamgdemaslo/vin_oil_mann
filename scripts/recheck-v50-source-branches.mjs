import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
import {volvoApplicationBranches} from './lib/mann-volvo-application-branches.mjs';
import {splitSpecificationSections,specificationCautionSignals} from './lib/mann-specification-sections-v2.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const previousRaw=await readFile(resolve(dir,'v50-generation-runtime-v1.json'),'utf8');assert.equal(sha(previousRaw),'b232fb50fde20b624cdaae45a87862dc2982a84a22635f718ff66a6350daf99a');const previous=JSON.parse(previousRaw);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),previous.planHash);const plan=JSON.parse(planRaw);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const rows=raw.trim().split('\n').map(JSON.parse),byRaw=new Map(rows.map(r=>[r.row_id,r]));
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sql),plan.inputHashes.source);assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw),fuel=await applyAuditedSourceFuel(root,power.requirements,raw);
const sources=new Map(fuel.requirements.map(r=>[r.id,{...r,engineCodesJson:fuel.fresh.get(r.id).engineCodesJson,engineCodeNormalized:fuel.fresh.get(r.id).engineCodeNormalized}]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts'),{parseFluidCapacities:capacity}=await j.import('../src/lib/fluid-capacity-parser.ts'),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts');
const catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>r.make==='VOLVO CARS'),variants=Map.groupBy(catalog,r=>r.vehicleVariantKey);
const denyRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8'),denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const findings=[];
for(const gained of previous.findings.filter(f=>f.added.length)){
 const s=sources.get(gained.sourceRequirementId),original=identity.originalById.get(s.id),row=byRaw.get(s.sourceRowId);
 const anchorRows=rows.filter(r=>r.source_url===row.source_url&&r.table_index===row.table_index&&r.system_name?.startsWith('МАСЛО в ДВИГАТЕЛЬ')&&(s.systemCode!=='ENGINE_OIL'||r.row_id===row.row_id));
 const anchors=anchorRows.map(r=>({rowId:r.row_id,rowHash:sha(r),parsed:volvoApplicationBranches(r.application)}));
 const parsedCapacity=capacity(original.fillVolumeText,original.systemCode),sections=splitSpecificationSections(original.specificationText,original.analogText),cautions=specificationCautionSignals(original.specificationText),pairs=[];
 for(const target of gained.added){
  const targetRows=variants.get(target);assert.ok(targetRows?.length);
  for(const anchor of anchors)for(const branch of anchor.parsed?.branches??[]){
   const codes=r=>String(r.engineCode??'').split('/').map(norm);
   if(!targetRows.some(r=>codes(r).includes(norm(branch.engineCode))))continue;
   const effective={...s,engineCodesJson:[branch.engineCode],engineCodeNormalized:branch.engineCode,powerHp:branch.powerHp,yearFrom:Math.max(s.yearFrom??branch.yearFrom,branch.yearFrom),yearTo:Math.min(s.yearTo??branch.yearTo,branch.yearTo)};
   const windows=targetRows.map(r=>applicabilityWindow(effective,r)),window=windows[0],reasons=[];
   if(!window?.intersection.from||!window?.intersection.to||windows.some(w=>sha(w)!==sha(window)))reasons.push('MISSING_OR_INCONSISTENT_WINDOW');
   if(!targetRows.every(r=>Number(r.hp)===branch.powerHp))reasons.push('POWER_CONFLICT');
   if(targetRows.some(r=>codes(r).length!==1))reasons.push('COMPOUND_MANN_ENGINE_TARGET_REQUIRES_BRANCH_SCOPE');
   const decision=window?.intersection.from?match({...effective,...window.narrowedYears},catalog):null;
   if(!decision?.targets.some(t=>t.vehicleVariantKey===target&&t.independentlyValidated))reasons.push('SCOPED_MATCH_NOT_VALIDATED');
   // 2WD means neither FWD nor RWD specifically. Retain the source restriction.
   if(branch.driveCondition==='2WD'&&!targetRows.every(r=>/\b(?:2WD|FWD|RWD)\b/i.test(`${r.vehicleText??''} ${r.condition??''}`)))reasons.push('SOURCE_2WD_REQUIRES_INDEPENDENT_DRIVE_EVIDENCE');
   if(branch.driveCondition!=='2WD')reasons.push('SOURCE_DRIVE_BRANCH_REVIEW');
   if(parsedCapacity.needsReview||!parsedCapacity.capacities.length)reasons.push('CAPACITY_REVIEW');
   if(!String(original.specificationText??'').trim()&&s.systemCode!=='FUEL_TANK')reasons.push('MISSING_SPECIFICATION');
   if(!['NO_EXPLICIT_MARKER','EXPLICIT_ANALOG_SEPARATED'].includes(sections.status)||cautions.length)reasons.push('SPECIFICATION_REVIEW');
   if(s.rawRequirementJson.sourceFuelCorrection?.marketReviewRequired)reasons.push('FUEL_EVIDENCE_MARKET_REVIEW');
   const fingerprint=originalAssociationFingerprint(target,original,parsedCapacity);if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
   if(live.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===target&&(r.reviewConfirmed||r.applyEligible||r.state==='ACTIVE'||r.verificationStatus!=='UNVERIFIED')))reasons.push('PROTECTED_PREDECESSOR');
   pairs.push({targetId:target,anchorRowId:anchor.rowId,anchorHash:anchor.rowHash,branch,window,decision,reasons:[...new Set(reasons)],originalAssociationFingerprint:fingerprint,publicationAllowed:false});
  }
 }
 findings.push({sourceRequirementId:s.id,systemCode:s.systemCode,sourceHash:sha(original),effectiveHash:sha(s),anchors,pairs,parsedCapacity,sections,cautions,fuelCorrection:s.rawRequirementJson.sourceFuelCorrection??null,publicationAllowed:false});
}
assert.equal(findings.length,14);const pairs=findings.flatMap(f=>f.pairs);
const summary={gainedSources:findings.length,parsedAnchors:findings.reduce((n,f)=>n+f.anchors.filter(a=>a.parsed).length,0),unparsedAnchors:findings.reduce((n,f)=>n+f.anchors.filter(a=>!a.parsed).length,0),branchPairs:pairs.length,clearPairs:pairs.filter(p=>!p.reasons.length).length,reasons:Object.fromEntries([...Map.groupBy(pairs.flatMap(p=>p.reasons),r=>r)].map(([k,v])=>[k,v.length]))};
await writeFile(resolve(dir,'v50-source-branch-preflight-v1.json'),JSON.stringify({kind:'V50_GAINED_SOURCE_BRANCH_PREFLIGHT',planHash:sha(planRaw),generationReplayHash:sha(previousRaw),rawHash:sha(raw),denylistHash:sha(denyRaw),liveHash:sha(liveRaw),fuelProofHash:fuel.proofHash,summary,findings,productionApplyAllowed:false,limitations:['No canonical revisions created. Source drive, date, fuel and capacity branches are retained independently.','Exact generation and whole-source matcher status do not establish all technical applicability conditions.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
