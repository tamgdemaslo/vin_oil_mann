import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--compressed'));
const compressed=process.argv[2]==='--compressed';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,compressed?'outputs/mann-mercedes-engine-preview-2026-09-14':'outputs/mann-rf-market-preview-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),auditRaw=await readFile(resolve(dir,compressed?'mercedes-source-engine-recheck-v2.json':'mercedes-source-engine-recheck-v1.json'),'utf8');
const plan=JSON.parse(raw),audit=JSON.parse(auditRaw);assert.equal(audit.planHash,sha(raw));
if(compressed)assert.equal(audit.targetParserHash,sha(await readFile(resolve(root,'src/lib/mann-engine-code-list.ts'),'utf8')));
for(const [field,file] of [['matcherHash','src/lib/mann-fluid-matcher-v2.ts'],['resolverHash','src/lib/mann-vehicle-resolver.ts'],['helperHash','scripts/lib/mann-mercedes-source-engine.mjs']])assert.equal(audit[field],sha(await readFile(resolve(root,file),'utf8')));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const runtime=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
let checks=0,visible=0;const replacements=[];
for(const result of audit.results.filter(r=>r.status==='SOURCE_ENGINE_RECOVERY_CONFIRMED')){
  const old=plan.newRevisions.find(r=>r.id===result.revisionId);assert.equal(sha(old),result.revisionHash);
  assert.deepEqual(result.reasons,[]);assert.equal(result.target.independentlyValidated,true);
  assert.deepEqual(result.proposedScope,{...old.applicabilityJson,matchedEngineScope:result.exactCodes});
  assert.ok(result.exactCodes.every(c=>result.sourceCodes.includes(c)&&result.targetCodes.includes(c)));
  const fingerprint=sha({policy:old.provenanceJson.catalogPreviewPolicy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicability:result.proposedScope,technicalData:old.technicalDataJson});
  const revision={...old,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,applicabilityJson:result.proposedScope,
    provenanceJson:{...old.provenanceJson,independentValidation:result.target,sourceTechnicalReviewRequired:true,
      sourceEngineRecovery:{originalRevisionId:old.id,originalRevisionHash:sha(old),auditHash:sha(auditRaw),sourceAnchors:result.anchors}}};
  assert.equal(revision.applyEligible,false);assert.equal(revision.verificationStatus,'UNVERIFIED');
  const w=revision.applicabilityJson.window.intersection;assert.ok(w.from&&w.to);
  const lo=index(w.from),hi=index(w.to);
  for(let m=lo-1;m<=hi+1;m++)for(const engineCode of new Set([...result.sourceCodes,...result.targetCodes,'WRONG',undefined])){
    const ctx={...revision.applicabilityJson.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
    const items=profile([runtime(revision)],undefined,ctx).items;
    const expected=result.exactCodes.includes(engineCode)&&m>=lo&&m<=hi;
    assert.equal(items.length,expected?1:0);
    if(expected){
      const prior=profile([runtime(old)],undefined,ctx).items;assert.equal(prior.length,1);
      for(const field of ['capacities','specifications','viscosityGrades','recommendation','replacementInterval'])assert.deepEqual(items[0][field],prior[0][field]);
      assert.equal(items[0].automaticSelectionEligible,false);visible++;
    }
    checks++;
  }
  replacements.push({originalRevisionId:old.id,originalRevisionHash:sha(old),revision,
    residual:{originalRevision:old,pendingWindow:w,requiredCondition:{kind:'REVIEW_PREVIOUSLY_UNRESTRICTED_ENGINE_SCOPE',acceptedEngineScope:result.exactCodes},
      excludedSourceCodes:result.sourceCodes.filter(c=>!result.exactCodes.includes(c)),excludedTargetCodes:result.targetCodes.filter(c=>!result.exactCodes.includes(c)),publicationAllowed:false}});
}
assert.equal(replacements.length,compressed?2:14);
const report={planHash:sha(raw),auditHash:sha(auditRaw),matcherHash:audit.matcherHash,resolverHash:audit.resolverHash,
  applicabilityHash:sha(await readFile(resolve(root,'src/lib/mann-technical-applicability.ts'),'utf8')),
  profileHash:sha(await readFile(resolve(root,'src/lib/mann-unified-technical-profile.ts'),'utf8')),
  summary:{replacements:replacements.length,checks,visible},replacements,productionApplyAllowed:false,
  limitation:'Unapplied replacements. Every bounded month and neighboring months tested; wrong/missing/excluded engines suppressed. Technical content preserved, not OEM verified. Predecessor and residual reconciliation still required.'};
await writeFile(resolve(dir,compressed?'mercedes-recovered-engine-supplement-v2.json':'mercedes-recovered-engine-supplement-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary));
