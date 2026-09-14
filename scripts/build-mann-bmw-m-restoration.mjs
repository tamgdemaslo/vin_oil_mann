import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-passat-cbab-inclusive-preview-2026-09-14');
const [planRaw,auditRaw,sourceRaw,mannRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'bmw-m-source-body-recheck-v1.json'),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
const plan=JSON.parse(planRaw),audit=JSON.parse(auditRaw);assert.equal(audit.planHash,sha(planRaw));
assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));
assert.equal(audit.resolverHash,sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const revisions=[],review=[];let monthCases=0;
for(const finding of audit.results){
  if(finding.status!=='SOURCE_BODY_SCOPED_MATCH'){review.push(finding);continue;}
  const old=plan.sourceBodyHeld.find(h=>h.revision.id===finding.revisionId)?.revision;assert.ok(old);assert.equal(sha(old),finding.revisionHash);
  const source=sources.get(old.sourceRequirementId);assert.equal(sha(source),finding.sourceHash);
  const archiveRaw=await readFile(finding.evidence.archivePath,'utf8');assert.equal(sha(archiveRaw),finding.evidence.archiveHash);
  const rows=variants.get(old.vehicleVariantKey);assert.ok(rows?.length);
  const engines=new Set(rows.flatMap(r=>String(r.engineCode??'').split(/[,;/]+/).map(norm).filter(Boolean)));
  const matchedEngineScope=old.applicabilityJson.matchedEngineScope.filter(e=>engines.has(norm(e)));assert.ok(matchedEngineScope.length);
  const capacity=parse(source.fillVolumeText,source.systemCode);assert.equal(capacity.needsReview,false);
  assert.deepEqual(capacity.capacities,old.technicalDataJson.capacities);
  const fingerprint=originalAssociationFingerprint(old.vehicleVariantKey,source,capacity);
  assert.equal(fingerprint,old.provenanceJson.sourceAssociationFingerprint);assert.ok(!denied.has(fingerprint));
  assert.equal(old.technicalDataJson.fillVolumeText,source.fillVolumeText);
  assert.equal(old.technicalDataJson.specificationText,source.specificationText);
  assert.deepEqual(old.technicalDataJson.specifications,source.specificationsJson);
  const applicability={...old.applicabilityJson,matchedEngineScope};
  const semantic=sha({policy:old.provenanceJson.catalogPreviewPolicy,sourceRequirementId:source.id,vehicleVariantKey:old.vehicleVariantKey,
    applicability,technicalData:old.technicalDataJson});
  const validation=finding.decision.targets.find(t=>t.vehicleVariantKey===old.vehicleVariantKey);assert.ok(validation?.independentlyValidated);
  const revision={...old,id:`mtar_${semantic.slice(0,24)}`,semanticFingerprint:semantic,applicabilityJson:applicability,
    provenanceJson:{...old.provenanceJson,sourceSectionBodyEvidence:finding.evidence,independentValidation:validation,
      bodyRestorationAuditHash:sha(auditRaw),bodyRestorationOriginalRevisionId:old.id,sourceTechnicalReviewRequired:true}};
  assert.equal(revision.applyEligible,false);assert.equal(revision.verificationStatus,'UNVERIFIED');
  const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',
    independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:revision.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}};
  const window=applicability.window.intersection,index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
  const selected=new Set(matchedEngineScope);
  for(const engineCode of new Set([...old.applicabilityJson.matchedEngineScope,'WRONG']))for(let m=index(window.from)-1;m<=index(window.to)+1;m++){
    const productionMonth=`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
    const context={...applicability.sourceVehicleScope,engineCode,productionMonth};
    const out=profile([runtime],undefined,context),expected=selected.has(engineCode)&&m>=index(window.from)&&m<=index(window.to)?1:0;
    assert.equal(out.items.length,expected,`${old.id}:${engineCode}:${productionMonth}`);
    if(expected)assert.equal(out.items[0].automaticSelectionEligible,false);monthCases++;
  }
  for(const wrong of [{make:'toyota'},{model:'WRONG'},{generation:'WRONG'}])assert.equal(profile([runtime],undefined,
    {...applicability.sourceVehicleScope,engineCode:matchedEngineScope[0],productionMonth:window.from,...wrong}).items.length,0);
  revisions.push({originalRevisionId:old.id,originalRevisionHash:sha(old),revision,
    excludedEngineCodes:old.applicabilityJson.matchedEngineScope.filter(c=>!selected.has(c)),publicationAllowed:false});
}
const report={planHash:sha(planRaw),auditHash:sha(auditRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),revisions,review,
  summary:{candidates:revisions.length,stillHeld:review.length,engineNarrowed:revisions.filter(r=>r.excludedEngineCodes.length).length,monthCases},
  productionApplyAllowed:false,limitation:'Restoration supplement only; technical payload unchanged and still secondary/unverified. Excluded engines are unsupported on this target, not removed from source. Requires predecessor/held-queue reconciliation and joint audit.'};
await writeFile(resolve(dir,'bmw-m-restoration-supplement-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
