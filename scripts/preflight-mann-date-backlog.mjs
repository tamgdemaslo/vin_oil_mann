import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow,originalAssociationFingerprint,YEAR_BLOCKER} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
import {parseLiteralEngineApplication} from './lib/mann-literal-engine-application.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const backlogRaw=await readFile(resolve(dir,'action-groups-current-plan-v2.json'),'utf8'),backlog=JSON.parse(backlogRaw);
const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
assert.equal(sha(await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8')),backlog.planHash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(sql),manifest.sourceHash);assert.equal(sha(mannRaw),manifest.mannHash);assert.equal(sha(raw),manifest.rawHash);
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw),fuel=await applyAuditedSourceFuel(root,power.requirements,raw);
const corrected=fuel.requirements.map(s=>({...s,engineCodeNormalized:fuel.fresh.get(s.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(s.id).engineCodesJson}));assert.equal(sha(corrected),manifest.correctedSourcesHash);
const sources=new Map(corrected.map(s=>[s.id,s])),variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const rawRows=raw.trim().split('\n').map(JSON.parse),byRaw=new Map(rawRows.map(r=>[r.row_id,r])),tables=Map.groupBy(rawRows,r=>`${r.source_url}|${r.table_index}`);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const live=JSON.parse(await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8'));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts'),{parseFluidCapacities:capacity}=await j.import('../src/lib/fluid-capacity-parser.ts');
const batches=new Map(),findings=[];
for(const entry of backlog.findings.filter(f=>f.route==='DATE_SCOPE_CANDIDATE'&&!f.canonicalRevisionIds.length)){
 if(!batches.has(entry.batchFile))batches.set(entry.batchFile,JSON.parse(await readFile(resolve(dir,entry.batchFile),'utf8')));
 const batch=batches.get(entry.batchFile);assert.equal(batch.manifestHash,sha(manifest));
 const saved=batch.findings.find(f=>f.sourceRequirementId===entry.sourceRequirementId),s=sources.get(entry.sourceRequirementId),original=identity.originalById.get(s.id),row=byRaw.get(s.sourceRowId);
 assert.equal(sha(s),saved.sourceHash);const top=saved.decision.topCandidates[0];assert.deepEqual(top.reviewBlockers,[YEAR_BLOCKER]);assert.deepEqual(top.hardConflicts,[]);
 const anchors=tables.get(`${row.source_url}|${row.table_index}`).filter(r=>r.system_name?.startsWith('МАСЛО в ДВИГАТЕЛЬ')&&(s.systemCode!=='ENGINE_OIL'||r.row_id===row.row_id));
 const applications=anchors.map(a=>({rowId:a.row_id,rowHash:sha(a),parsed:parseLiteralEngineApplication(a.application)}));
 const pairs=[];
 for(const key of top.variantIds){
  const rows=variants.get(key);assert.ok(rows?.length);
  const windows=rows.map(r=>applicabilityWindow(s,r)),window=windows[0],reasons=[];
  if(!window?.intersection.from||!window?.intersection.to||windows.some(w=>sha(w)!==sha(window)))reasons.push('NO_CONSISTENT_FINITE_MONTH_INTERSECTION');
  const codes=[...new Set(rows.map(r=>norm(r.engineCode)))];
  if(codes.length!==1||!codes[0]||!(s.engineCodesJson??[]).map(norm).includes(codes[0]))reasons.push('EXACT_ENGINE_NOT_PROVEN');
  const parsedCapacity=capacity(original.fillVolumeText,original.systemCode),fingerprint=originalAssociationFingerprint(key,original,parsedCapacity);
  if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
  if(live.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===key&&(r.reviewConfirmed||r.applyEligible||r.verificationStatus!=='UNVERIFIED')))reasons.push('PROTECTED_PREDECESSOR');
  pairs.push({vehicleVariantKey:key,window,matchedEngineScope:codes,originalAssociationFingerprint:fingerprint,reasons,status:reasons.length?'HOLD':'DATE_SCOPED_REMATCH_REQUIRED'});
 }
 findings.push({sourceRequirementId:s.id,sourceHash:sha(s),originalSourceHash:sha(original),make:entry.make,systemCode:s.systemCode,sourceUrl:s.sourceUrl,rawRowHash:sha(row),application:row.application,model:row.model,engineApplications:applications,fillVolumeText:original.fillVolumeText,specificationText:original.specificationText,pairs,technicalReviewRequired:true,productionApplyAllowed:false});
}
assert.equal(findings.length,386);
const pairs=findings.flatMap(f=>f.pairs),summary={sources:findings.length,pairs:pairs.length,rematchReady:pairs.filter(p=>p.status==='DATE_SCOPED_REMATCH_REQUIRED').length,reasons:Object.fromEntries([...Map.groupBy(pairs.flatMap(p=>p.reasons),r=>r)].map(([r,rows])=>[r,rows.length])),fullyParsedEngineSources:findings.filter(f=>f.engineApplications.length&&f.engineApplications.every(a=>a.parsed)).length};
await writeFile(resolve(dir,'date-backlog-preflight-v1.json'),JSON.stringify({kind:'ALL386_DATE_BACKLOG_PREFLIGHT',planHash:backlog.planHash,backlogHash:sha(backlogRaw),manifestHash:sha(manifest),correctedSourcesHash:sha(corrected),summary,findings,productionApplyAllowed:false,limitations:['Date candidate inventory only; full-make independent rematch is still required.','Engine application parser coverage and fluid-specific market/drive/equipment/specification conditions remain separate obligations.','Original source fingerprint guards are retained before narrowing dates.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
