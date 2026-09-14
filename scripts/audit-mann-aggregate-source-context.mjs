import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
const decisionsRaw=await readFile(resolve(dir,'decisions.ndjson'),'utf8');
const decisions=new Map(decisionsRaw.trim().split('\n').map(line=>{const r=JSON.parse(line);return[r.requirementId,r];}));
const source=parseCopy(sourceRaw,'vehicle_fluid_requirements');assert.equal(source.length,decisions.size);
const {extractFluidAggregateSourceContext:extract}=await createJiti(import.meta.url).import('../src/lib/fluid-aggregate-source-context.ts');
const systems=new Set(['TRANSFER_CASE','FRONT_DIFFERENTIAL','REAR_DIFFERENTIAL','DIFFERENTIAL_GENERIC','AWD_COUPLING','POWER_STEERING','SUSPENSION_HYDRAULIC','HYDRAULIC_SYSTEM']);
const findings=[];
for(const r of source){
  const metadata=extract(r.systemNameRaw,r.componentModel);
  if(!systems.has(r.systemCode)&&!metadata.systemCode)continue;
  const decision=decisions.get(r.id);assert.ok(decision);
  const top=decision.match.topCandidates[0];
  const rematchRequired=metadata.systemCode!=null&&metadata.systemCode!==r.systemCode;
  const reasons=[...metadata.issues];
  if(rematchRequired)reasons.push('DESTINATION_SYSTEM_REQUIRES_REMATCH');
  if(decision.capacity.needsReview)reasons.push('CAPACITY_REQUIRES_REVIEW');
  if(!r.specificationText?.trim()&&!r.specificationsJson?.length)reasons.push('MISSING_SPECIFICATION');
  const allowed=new Set(['MANN variant не подтверждает привод или модель агрегата','MANN variant не подтверждает наличие этой гидравлической системы',
    'диапазон MANN покрывает только часть лет источника; требуется ограничить применяемость']);
  const exactIdentityCandidate=Boolean(top&&top.variantIds.length===1&&top.score>=80&&top.matchedFields.includes('точный код двигателя')&&
    !top.hardConflicts.length&&top.reviewBlockers.every(b=>allowed.has(b)));
  // These are work-queue hints only: date-scoped full-make rematch and source
  // identity overlay are still required before creating a display revision.
  const disposition=metadata.fluidRequired===false&&!metadata.issues.length?'EXPLICIT_ELECTRIC_STEERING_NO_FLUID':
    reasons.length?'SOURCE_CONTEXT_REVIEW':exactIdentityCandidate?'EQUIPMENT_CONFIRMATION_REMATCH_CANDIDATE':'VEHICLE_IDENTITY_REVIEW';
  findings.push({requirementId:r.id,sourceHash:sha(r),sourceUrl:r.sourceUrl,sourceRowId:r.sourceRowId,
    before:{systemCode:r.systemCode,componentModel:r.componentModel,transmissionType:r.transmissionType,driveType:r.driveType},
    metadata,rematchRequired,disposition,reasons,previousDisposition:decision.disposition,
    topCandidate:top?{variantIds:top.variantIds,score:top.score,matchedFields:top.matchedFields,hardConflicts:top.hardConflicts,reviewBlockers:top.reviewBlockers}:null,
    originalTechnical:{fillVolumeText:r.fillVolumeText,specificationText:r.specificationText},publicationAllowed:false});
}
const counts=field=>Object.fromEntries([...Map.groupBy(findings,field)].map(([k,v])=>[k,v.length]));
const report={kind:'AGGREGATE_SOURCE_CONTEXT_WORK_QUEUE',sourceRequirements:source.length,aggregateRequirements:findings.length,
  sourceHash:sha(sourceRaw),decisionsHash:sha(decisionsRaw),extractorHash:sha(await readFile(resolve(root,'src/lib/fluid-aggregate-source-context.ts'),'utf8')),
  productionApplyAllowed:false,summary:{dispositions:counts(r=>r.disposition),systems:counts(r=>r.metadata.systemCode??r.before.systemCode),
    destinationCorrections:findings.filter(r=>r.rematchRequired).length,explicitDriveConditions:findings.filter(r=>r.metadata.requiredDrive).length,
    attachedTransmissionConditions:findings.filter(r=>r.metadata.attachedTransmissionType).length},
  limitation:'Source evidence and cached identity candidates only; no verified equipment on a VIN, no corrected-source rematch yet, no source edits or publication.',findings};
await writeFile(resolve(dir,'aggregate-source-context-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,findings:undefined},null,2));
