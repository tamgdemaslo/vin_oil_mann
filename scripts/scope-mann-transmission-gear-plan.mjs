import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const [planRaw,contextRaw,sourceRaw]=await Promise.all([readFile(resolve(dir,'conditional-transmission-plan.json'),'utf8'),
  readFile(resolve(dir,'source-system-context-v3.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8')]);
const plan=JSON.parse(planRaw),context=JSON.parse(contextRaw);
assert.equal(plan.inputHashes.source,sha(sourceRaw));assert.equal(context.sourceHash,sha(sourceRaw));
assert.equal(context.extractorHash,sha(await readFile(resolve(root,'src/lib/fluid-source-system-context.ts'),'utf8')));
const source=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r])),findings=new Map(context.findings.map(f=>[f.requirementId,f]));
const jiti=createJiti(import.meta.url);
const {extractFluidSourceSystemContext:extract}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const revisions=[],withheld=[],successors=new Map();
for(const row of plan.revisions){
  const r=source.get(row.sourceRequirementId),f=findings.get(row.sourceRequirementId);assert.ok(r&&f);
  assert.equal(f.sourceHash,sha(r));assert.deepEqual(f.extracted,extract(r.systemNameRaw,r.componentModel));
  const metadata=f.extracted,reasons=[...metadata.issues];
  if(!metadata.destinationSystemCode)reasons.push('UNCONFIRMED_SYSTEM_DESTINATION');
  if(metadata.destinationSystemCode&&metadata.destinationSystemCode!==row.systemCode)reasons.push('REQUIRES_CORRECT_SYSTEM_REMATCH');
  if(metadata.hasAdditionalLabelConditions)reasons.push('ADDITIONAL_LABEL_CONDITION_REVIEW');
  if(reasons.length){withheld.push({draftId:row.id,sourceRequirementId:r.id,replacesRevisionIds:row.replacesRevisionIds,reasons:[...new Set(reasons)],metadata});continue;}
  const applicabilityJson={...row.applicabilityJson,...(metadata.transmissionGearCount!=null?{transmissionGearCount:metadata.transmissionGearCount}:{})};
  const fingerprint=sha({policy:plan.policy,sourceRequirementId:r.id,vehicleVariantKey:row.vehicleVariantKey,applicabilityJson,technicalDataJson:row.technicalDataJson});
  const next={...row,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,applicabilityJson,
    provenanceJson:{...row.provenanceJson,sourceSystemContextHash:sha(contextRaw),sourceSystemContext:metadata}};
  revisions.push(next);successors.set(row.id,next.id);
}
const updated={...plan,kind:'GEAR_SCOPED_CONDITIONAL_TRANSMISSION_PLAN',parentPlanHash:sha(planRaw),systemContextHash:sha(contextRaw),
  summary:{...plan.summary,candidates:revisions.length,review:plan.summary.checked-revisions.length,
    requiredChoices:Object.fromEntries([...Map.groupBy(revisions,r=>plan.decisions.find(d=>d.revisionId===r.replacesRevisionIds[0]).requiredChoice.kind)].map(([k,v])=>[k,v.length])),
    withGearCount:revisions.filter(r=>r.applicabilityJson.transmissionGearCount!=null).length,withheldForSourceConditions:withheld.length},
  decisions:plan.decisions.map(d=>d.successorId?(successors.has(d.successorId)?{...d,successorId:successors.get(d.successorId)}:{revisionId:d.revisionId,disposition:'REVIEW',reasons:withheld.find(w=>w.draftId===d.successorId).reasons}):d),
  revisions,withheld,productionApplyAllowed:false};
assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
await writeFile(resolve(dir,'conditional-transmission-plan-v4.json'),JSON.stringify(updated,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(updated.summary,null,2));
