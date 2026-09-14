import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-engine-inclusive-preview-2026-09-14');
const [planRaw,auditRaw,sourceRaw,snapshotRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),
  readFile(resolve(dir,'raw-production-condition-audit-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const parent=JSON.parse(planRaw),audit=JSON.parse(auditRaw);
assert.equal(audit.planHash,sha(planRaw));assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.snapshotHash,sha(snapshotRaw));
for(const [field,file] of [['helperHash','fluid-raw-production-condition.ts'],['dateHelperHash','fluid-source-date-condition.ts']])assert.equal(audit[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r])),rawRows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {extractRawProductionCondition:extract}=await jiti.import('../src/lib/fluid-raw-production-condition.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const changes=new Map(),withheld=[],newRevisions=[];let monthCases=0;
const findings=new Map(audit.findings.flatMap(f=>f.affected.map(a=>[a.revisionId,{f,a}])));
for(const old of parent.newRevisions){
  const entry=findings.get(old.id);if(!entry){newRevisions.push(old);continue;}
  const {f,a}=entry,source=sources.get(old.sourceRequirementId),row=rawRows.get(f.sourceRowId);
  assert.ok(source&&row);assert.equal(sha(source),f.sourceHash);assert.equal(sha(row),f.rawRowHash);
  const condition=extract(row.production_years??'');assert.deepEqual(condition,f.condition);assert.equal(condition.status,'SCOPED');
  const before=old.applicabilityJson.window.intersection;assert.deepEqual(before,a.previous);
  const from=[before.from,condition.from].filter(Boolean).sort().at(-1)??null,to=[before.to,condition.to].filter(Boolean).sort()[0]??null;
  const intersection=from&&to&&from>to?null:{from,to};assert.deepEqual(intersection,a.intersection);
  if(a.status==='ALREADY_WITHIN_CONDITION'){newRevisions.push(old);continue;}
  assert.equal(old.provenanceJson.catalogPreviewPolicy,'MANN_ENGINE_DATE_SCOPED_PREVIEW_V1');
  assert.equal(old.applyEligible,false);assert.equal(old.verificationStatus,'UNVERIFIED');
  if(!intersection){withheld.push({revision:old,sourceEvidence:f,reason:'SOURCE_DATE_EXCLUDES_PREVIOUS_MATCH',publicationAllowed:false});changes.set(old.id,null);continue;}
  const applicability={...old.applicabilityJson,window:{...old.applicabilityJson.window,intersection}};
  const fingerprint=sha({policy:old.provenanceJson.catalogPreviewPolicy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,
    applicability,technicalData:old.technicalDataJson,...(old.provenanceJson.sourceEngineScope?{sourceEngineScope:old.provenanceJson.sourceEngineScope}:{})});
  const revision={...old,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,applicabilityJson:applicability,
    provenanceJson:{...old.provenanceJson,rawProductionCondition:{condition,sourceRowId:f.sourceRowId,rawRowHash:f.rawRowHash,parentRevisionId:old.id,parentRevisionHash:sha(old)}}};
  assert.deepEqual(revision.technicalDataJson,old.technicalDataJson);
  const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,
    gatesJson:{catalogPreviewPolicy:revision.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}};
  // Exhaust the old finite month interval, including removed months, for each engine.
  assert.ok(before.from&&before.to);
  const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
  for(let m=index(before.from);m<=index(before.to);m++)for(const engineCode of applicability.matchedEngineScope){
    const productionMonth=`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
    const expected=(!from||productionMonth>=from)&&(!to||productionMonth<=to);
    const actual=profile([runtime],undefined,{...applicability.sourceVehicleScope,engineCode,productionMonth});
    assert.equal(actual.items.length,expected?1:0);monthCases++;
  }
  changes.set(old.id,revision.id);newRevisions.push(revision);
}
const existingActions=parent.existingActions.map(action=>{
  if(action.action==='PRESERVE_PROTECTED')return action;
  const oldIds=action.successorIds??(action.successorId?[action.successorId]:[]);
  if(!oldIds.some(id=>changes.has(id)))return action;
  const ids=oldIds.map(id=>changes.has(id)?changes.get(id):id).filter(Boolean);
  const {successorId,successorIds,...rest}=action;
  return {...rest,...(ids.length===1?{successorId:ids[0]}:ids.length?{successorIds:ids}:{action:'REVIEW_RAW_DATE_CONFLICT'})};
});
assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const plan={...parent,kind:'RAW_DATE_CORRECTED_OFFLINE_PREVIEW',newRevisions,existingActions,
  rawDateParent:{path:resolve(dir,'plan.json'),sha256:sha(planRaw),auditHash:sha(auditRaw)},rawDateWithheld:withheld,
  rawDateChanges:[...changes].map(([previousRevisionId,nextRevisionId])=>({previousRevisionId,nextRevisionId})),
  summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,
    engineLineRevisions:newRevisions.filter(r=>r.provenanceJson.engineAnchorRowIds).length,
    dateNarrowed:changes.size-withheld.length,dateWithheld:withheld.length,rawDateMonthReplayCases:monthCases,
    actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false,
  limitation:'Source-backed date restriction only; prior matching evidence retained. Joint approval/spec audit and production integration still required. Withheld source records remain in review.'};
const out=resolve(root,'outputs/mann-raw-date-preview-2026-09-14');await mkdir(out);
await writeFile(resolve(out,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,...plan.summary},null,2));
