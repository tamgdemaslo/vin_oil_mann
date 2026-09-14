import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-source-quality-preview-2026-09-14');
const pagePath=resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/page-results/ff2bea29cbd388dca098d3b4.json');
const [planRaw,impactRaw,pageRaw,sourceRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),
  readFile(resolve(dir,'page-year-preview-impact-v1.json'),'utf8'),readFile(pagePath,'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8')]);
const parent=JSON.parse(planRaw),impact=JSON.parse(impactRaw),page=JSON.parse(pageRaw);
assert.equal(impact.planHash,sha(planRaw));assert.equal(parent.inputHashes.source,sha(sourceRaw));
const url='https://podbormasla.ru/volkswagen/tiguan/gen2/';
assert.equal(page.page.source_url,url);assert.equal(page.page.canonical_url,url);
assert.equal(page.page.title,'Масло для Фольксваген Тигуан | 2 поколение | 2016-2023 г.');
const webpages=page.json_ld.flatMap(d=>d['@graph']??[]).filter(n=>n['@type']==='WebPage'&&n.url===url);
assert.equal(webpages.length,1);
const products=webpages[0].mainEntity.itemListElement;assert.equal(products.length,2);
for(const product of products){assert.equal(product.vehicleConfiguration.vehicleModelDate,'2016-2023');assert.equal(product.vehicleConfiguration.market,'Россия');}
const affected=impact.results.filter(r=>r.sourceUrl===url&&r.status==='PREVIEW_EXTENDS_BEYOND_PAGE_TITLE');
assert.equal(affected.length,5);const byId=new Map(affected.map(r=>[r.revisionId,r]));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const rawRows=new Map(page.rows.map(r=>[r.row_id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const pending=[],changes=new Map(),checks=[];
let monthCases=0;
const newRevisions=parent.newRevisions.map(old=>{
  const finding=byId.get(old.id);if(!finding)return old;
  assert.equal(sha(old),finding.revisionHash);assert.equal(old.applyEligible,false);assert.equal(old.verificationStatus,'UNVERIFIED');
  assert.equal(old.provenanceJson.catalogPreviewPolicy,'MANN_ENGINE_DATE_SCOPED_PREVIEW_V1');
  const source=sources.get(old.sourceRequirementId),row=rawRows.get(source?.sourceRowId);
  assert.ok(source&&row);assert.equal(source.sourceUrl,url);assert.equal(row.page_sha256,page.page.page_sha256);
  const previous=old.applicabilityJson;assert.equal(previous.window.intersection.to,'2024-12');
  assert.equal(previous.sourceVehicleScope.model,'tiguan');assert.equal(previous.sourceVehicleScope.generation,'II');
  for(const engine of previous.matchedEngineScope)assert.ok(['DFGA','DBGC'].includes(engine));
  const application={...previous,...('yearTo' in previous?{yearTo:2023}:{}),window:{...previous.window,
    intersection:{...previous.window.intersection,to:'2023-12'},
    narrowedYears:{...previous.window.narrowedYears,yearTo:2023},restricted:true}};
  const fingerprint=sha({policy:old.provenanceJson.catalogPreviewPolicy,sourceRequirementId:old.sourceRequirementId,
    vehicleVariantKey:old.vehicleVariantKey,applicability:application,technicalData:old.technicalDataJson,
    ...(old.provenanceJson.sourceEngineScope?{sourceEngineScope:old.provenanceJson.sourceEngineScope}:{})});
  const revision={...old,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,applicabilityJson:application,
    provenanceJson:{...old.provenanceJson,disputedSourceDate:{parentRevisionId:old.id,parentRevisionHash:sha(old),
      pageArchiveHash:sha(pageRaw),rawRowHash:sha(row),sourceHash:sha(source),
      reason:'SECONDARY_SOURCE_ROW_VS_PAGE_YEAR_CONTRADICTION',pendingWindow:{from:'2024-01',to:'2024-12'},
      resolutionStatus:'UNRESOLVED_NOT_A_VEHICLE_PRODUCTION_CUTOFF',independentOemVerified:false}}};
  assert.deepEqual(revision.technicalDataJson,old.technicalDataJson);
  assert.equal(revision.provenanceJson.sourceAssociationFingerprint,old.provenanceJson.sourceAssociationFingerprint);
  pending.push({originalRevision:old,sourceHash:sha(source),rawRowHash:sha(row),
    retainedRevisionId:revision.id,pendingWindow:{from:'2024-01',to:'2024-12'},
    reason:'SOURCE_DATE_DISPUTE',resolutionStatus:'NEEDS_ENGINE_MARKET_SPECIFIC_DATE_EVIDENCE',publicationAllowed:false});
  const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',
    independentHumanSignoff:false,productionApplyAuthorized:false,
    gatesJson:{catalogPreviewPolicy:revision.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}};
  const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
  const before=previous.window.intersection;
  for(let m=index(before.from)-1;m<=index(before.to)+1;m++)for(const engineCode of previous.matchedEngineScope){
    const productionMonth=`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
    const expected=productionMonth>=before.from&&productionMonth<='2023-12';
    const actual=profile([runtime],undefined,{...previous.sourceVehicleScope,engineCode,productionMonth});
    assert.equal(actual.items.length,expected?1:0);monthCases++;
  }
  assert.equal(profile([runtime],undefined,{...previous.sourceVehicleScope,engineCode:'NOT_AN_ENGINE',productionMonth:'2020-01'}).items.length,0);
  checks.push({oldId:old.id,newId:revision.id,allOriginalMonthsAndNeighborsChecked:true,technicalPayloadUnchanged:true});
  changes.set(old.id,revision.id);return revision;
});
assert.equal(pending.length,5);assert.equal(newRevisions.length,parent.newRevisions.length);
assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const existingActions=parent.existingActions.map(action=>{
  const ids=action.successorIds??(action.successorId?[action.successorId]:[]);
  if(!ids.some(id=>changes.has(id)))return action;
  assert.notEqual(action.action,'PRESERVE_PROTECTED');
  const next=ids.map(id=>changes.get(id)??id);const {successorId,successorIds,...rest}=action;
  return {...rest,...(next.length===1?{successorId:next[0]}:{successorIds:next})};
});
assert.deepEqual(existingActions.filter(a=>a.action==='PRESERVE_PROTECTED'),parent.existingActions.filter(a=>a.action==='PRESERVE_PROTECTED'));
const plan={...parent,kind:'DISPUTED_YEAR_PARTITIONED_OFFLINE_PREVIEW',newRevisions,existingActions,
  disputedYearParent:{path:resolve(dir,'plan.json'),sha256:sha(planRaw),impactHash:sha(impactRaw),pageArchivePath:pagePath,pageArchiveHash:sha(pageRaw)},
  disputedYearPending:pending,summary:{...parent.summary,disputedYearRestricted:5,disputedYearPendingSlices:5,disputedYearMonthReplayCases:monthCases},
  productionApplyAllowed:false,
  limitation:'Conservative unpublished source-consensus subset, NOT an asserted production cutoff or approval of remaining months. Entire original revisions and disputed 2024 slices retained for resolution. All prior held/review data preserved; whole-goal and OEM/runtime/integration checks remain incomplete.'};
const out=resolve(root,'outputs/mann-disputed-year-preview-2026-09-14');await mkdir(out);
const output=JSON.stringify(plan,null,2)+'\n';
await writeFile(resolve(out,'plan.json'),output,{flag:'wx'});
await writeFile(resolve(out,'date-partition-verification.json'),JSON.stringify({planHash:sha(output),parentHash:sha(planRaw),
  monthCases,checks,unchangedRevisions:parent.newRevisions.length-changes.size,pendingSlices:pending.length,
  protectedActionsUnchanged:true,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,monthCases,revisions:newRevisions.length,pending:pending.length}));
