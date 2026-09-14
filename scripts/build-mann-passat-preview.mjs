import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-disputed-year-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&['--b7','--dates','--specific-dates'].includes(process.argv[2])));
const specific=process.argv[2]==='--specific-dates',dates=process.argv[2]==='--dates'||specific,b7=process.argv[2]==='--b7'||dates;
const raw=await readFile(resolve(dir,specific?'passat-date-final-scopes-v2.json':dates?'passat-date-final-scopes-v1.json':b7?'passat-final-scope-recheck-v2.json':'passat-final-scope-recheck-v1.json'),'utf8'),run=JSON.parse(raw);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(run.sourceHash,sha(sourceRaw));
assert.equal(run.resolverHash,sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')));
const labelsRaw=await readFile(resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-system-context-v3.json'),'utf8');
const labels=JSON.parse(labelsRaw);assert.equal(labels.sourceHash,sha(sourceRaw));
const byLabel=new Map(labels.findings.map(r=>[r.requirementId,r]));
const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789334190861/revisions.json'),'utf8'),live=JSON.parse(liveRaw);
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(run.mannHash,sha(mannRaw));
const targets=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const priorRaw=await readFile(resolve(dir,specific?'passat-source-body-recheck-v4.json':b7?'passat-source-body-recheck-v3.json':'passat-source-body-recheck-v2.json'),'utf8');
const prior=new Map(JSON.parse(priorRaw).results.map(r=>[r.requirementId,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1',revisions=[],review=[];let monthCases=0;
for(const c of run.results){
  const s=sources.get(c.requirementId),label=byLabel.get(c.requirementId);assert.ok(s&&label);
  assert.equal(sha(s),c.sourceHash);assert.equal(label.sourceHash,c.sourceHash);
  const reasons=[...c.reasons];
  const targetRows=targets.get(c.vehicleVariantKey);assert.ok(targetRows?.length);
  for(const [field,column] of [['powerHp','hp'],['powerKw','kw']]){
    if(s[field]!=null&&targetRows.some(r=>String(r[column]??'').trim()!==String(s[field])))reasons.push(`TARGET_${column.toUpperCase()}_NOT_EXACT_SINGLE_VALUE`);
  }
  if(label.extracted.issues.length||label.extracted.hasAdditionalLabelConditions)reasons.push('SOURCE_LABEL_REVIEW');
  const old=live.filter(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===c.vehicleVariantKey);
  if(old.some(r=>r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'))reasons.push('PROTECTED_PREDECESSOR');
  const capacity=parse(s.fillVolumeText,s.systemCode);assert.deepEqual(capacity,c.capacity);
  assert.equal(originalAssociationFingerprint(c.vehicleVariantKey,s,capacity),c.originalAssociationFingerprint);
  if(reasons.length){review.push({...c,reasons});continue;}
  const generation=s.sourceUrl.match(/\/gen([5-8])\/$/)?.[1];assert.ok(generation);
  const applicability={sourceVehicleScope:{make:s.make,model:s.model,generation:{5:'V',6:'VI',7:'VII',8:'VIII'}[generation]},
    matchedEngineScope:c.matchedEngineScope,window:{intersection:c.window,precision:'MONTH',boundaryPolicy:'INCLUSIVE_MONTHS_EXACT_BUILD_MONTH_REQUIRED_AT_BOUNDARIES'}};
  const technical={fillVolumeText:s.fillVolumeText,capacities:capacity.capacities};
  for(const k of ['specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technical[k]=s[k];
  technical.specifications=s.specificationsJson;technical.viscosityGrades=s.viscosityGradesJson;
  const fingerprint=sha({policy,sourceRequirementId:s.id,vehicleVariantKey:c.vehicleVariantKey,applicability,technicalData:technical});
  const validation=c.decision.targets.find(t=>t.vehicleVariantKey===c.vehicleVariantKey);assert.ok(validation?.independentlyValidated);
  const revision={id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:s.id,vehicleVariantKey:c.vehicleVariantKey,systemCode:s.systemCode,
    componentModel:s.componentModel,applicabilityJson:applicability,technicalDataJson:technical,verifiedFieldsJson:[],
    fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),
    evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],
    provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,
      sourceAssociationFingerprint:c.originalAssociationFingerprint,independentValidation:validation,
      sourceBodyEvidence:prior.get(s.id)?.evidence,sourceCandidateHash:sha(c)},
    matchClass:c.decision.status,matchScore:validation.score,semanticFingerprint:fingerprint,state:'STAGED',verificationStatus:'UNVERIFIED',applyEligible:false,
    replacesRevisionIds:old.map(r=>r.id)};
  const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,
    run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,
      gatesJson:{catalogPreviewPolicy:policy,automaticProductSelection:false}}};
  const index=x=>Number(x.slice(0,4))*12+Number(x.slice(5))-1;
  for(let m=index(c.window.from)-1;m<=index(c.window.to)+1;m++)for(const engineCode of c.matchedEngineScope){
    const productionMonth=`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
    const ctx={...applicability.sourceVehicleScope,productionMonth,engineCode};
    assert.equal(profile([runtime],undefined,ctx).items.length,m>=index(c.window.from)&&m<=index(c.window.to)?1:0);monthCases++;
  }
  assert.equal(profile([runtime],undefined,{...applicability.sourceVehicleScope,productionMonth:c.window.from,engineCode:'WRONG'}).items.length,0);
  for(const context of [{model:'golf'},{generation:'I'},{make:'toyota'}])assert.equal(profile([runtime],undefined,
    {...applicability.sourceVehicleScope,engineCode:c.matchedEngineScope[0],productionMonth:c.window.from,...context}).items.length,0);
  revisions.push(revision);
}
assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
const pendingSourceScopes=[];
if(dates)for(const id of new Set(run.results.map(r=>r.requirementId))){
  const source=sources.get(id);assert.ok(Number.isInteger(source.yearFrom)&&Number.isInteger(source.yearTo));
  const engines=[...new Set([source.engineCodeNormalized,...(source.engineCodesJson??[])].map(normalizeEngineCode).filter(Boolean))];
  assert.ok(engines.length);
  const month=m=>`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
  for(const engine of engines){
    let start=null;
    const selected=revisions.filter(r=>r.sourceRequirementId===id&&r.applicabilityJson.matchedEngineScope.includes(engine));
    const end=source.yearTo*12+11;
    for(let m=source.yearFrom*12;m<=end+1;m++){
      const covered=m>end||selected.some(r=>{const w=r.applicabilityJson.window.intersection;return month(m)>=w.from&&month(m)<=w.to;});
      if(!covered&&start===null)start=m;
      if(covered&&start!==null){
        pendingSourceScopes.push({requirementId:id,sourceHash:sha(source),originalSource:source,matchedEngineScope:[engine],
          window:{from:month(start),to:month(m-1)},reason:'SOURCE_ENGINE_MONTHS_NOT_COVERED_BY_DATE_SCOPED_SUPPLEMENT',publicationAllowed:false});
        start=null;
      }
    }
  }
}
const report={kind:'PASSAT_INDIVIDUAL_PREVIEW_SUPPLEMENT',productionApplyAllowed:false,inputs:{run:sha(raw),source:sha(sourceRaw),labels:sha(labelsRaw),live:sha(liveRaw),bodyEvidence:sha(priorRaw)},
  summary:{revisions:revisions.length,requirements:new Set(revisions.map(r=>r.sourceRequirementId)).size,review:review.length,monthCases},
  limitation:'Individual offline profile tests only; not joint composition, final technical/OEM approval or production integration. Body/date provenance must remain attached when merging.',revisions,review,...(dates?{pendingSourceScopes}: {})};
await writeFile(resolve(dir,specific?'passat-date-preview-supplement-v2.json':dates?'passat-date-preview-supplement-v1.json':b7?'passat-preview-supplement-v3.json':'passat-preview-supplement-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
