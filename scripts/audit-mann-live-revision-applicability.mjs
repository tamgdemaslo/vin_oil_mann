#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,YEAR_BLOCKER} from './lib/mann-offline-scope.mjs';
assert.equal(process.argv.length,3,'Pass live audit directory');
const root=resolve(import.meta.dirname,'..'),directory=resolve(process.argv[2]);
const raw=await readFile(resolve(directory,'revisions.json'),'utf8'),revisions=JSON.parse(raw);
const requirements=new Map(parseCopy(await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),'vehicle_fluid_requirements').map(r=>[r.id,r]));
const variants=Map.groupBy(parseCopy(await readFile('/tmp/mann_filter_applications.sql','utf8'),'mann_filter_applications'),r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {buildMannUnifiedTechnicalProfile,MANN_TRANSMISSION_TYPES}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const results=[],counts={};
for(const revision of revisions){
  const r=requirements.get(revision.sourceRequirementId),rows=variants.get(revision.vehicleVariantKey);
  let disposition,match=null,capacity=null;
  if(revision.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS')disposition='PRIMARY_SOURCE_SEPARATE_REVIEW';
  else if(!r||!rows)disposition='SOURCE_OR_VARIANT_MISSING';
  else{
    match=matchFluidRequirementToMann(r,rows);capacity=parseFluidCapacities(r.fillVolumeText,r.systemCode);
    const c=match.topCandidates[0];
    if(c?.hardConflicts.length || ['CONFLICT','NO_MATCH','MANN_CATALOG_GAP','INSUFFICIENT_SOURCE_CONTEXT'].includes(match.status))disposition='IDENTITY_REVIEW_REQUIRED';
    else if(c?.reviewBlockers.includes(YEAR_BLOCKER))disposition='DATE_SCOPE_REQUIRED';
    else if(revision.matchClass==='CONDITIONAL_TRANSMISSION' && c?.reviewBlockers.length===1 && c.reviewBlockers[0]==='MANN variant не подтверждает тип или модель коробки')disposition='TRANSMISSION_CONFIRMATION_REQUIRED';
    else if(match.status.startsWith('CONFIRMED'))disposition='TARGET_IDENTITY_PASSES';
    else disposition='OTHER_APPLICABILITY_REVIEW';
  }
  counts[disposition]=(counts[disposition]??0)+1;
  results.push({revisionId:revision.id,sourceRequirementId:revision.sourceRequirementId,vehicleVariantKey:revision.vehicleVariantKey,
    systemCode:revision.systemCode,oldMatchClass:revision.matchClass,disposition,capacityNeedsReview:capacity?.needsReview??null,
    newStatus:match?.status??null,hardConflicts:match?.topCandidates[0]?.hardConflicts??[],reviewBlockers:match?.topCandidates[0]?.reviewBlockers??[]});
}
const transmissionItems=new Set(),byType={};
for(const rows of Map.groupBy(revisions,r=>r.vehicleVariantKey).values())for(const type of MANN_TRANSMISSION_TYPES){
  const profile=buildMannUnifiedTechnicalProfile(rows.map(r=>({...r,createdAt:new Date(r.createdAt)})),type);
  const items=profile.items.filter(item=>item.userConfirmedTransmission);
  byType[type]=(byType[type]??0)+items.length;
  for(const item of items){assert.equal(item.automaticSelectionEligible,false);transmissionItems.add(item.revisionId);}
}
const report={kind:'LIVE_REVISIONS_TARGET_RECHECK',publicationAllowed:false,liveRevisionHash:sha(raw),counts,
  existingProfileWithManualTransmission:{uniqueDisplayedRevisions:transmissionItems.size,byType},
  limitation:'Target-only replay, not full ranking or OEM fluid approval. Existing primary-source subset kept separate. No database changes.',results};
await writeFile(resolve(directory,'revision-applicability.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,results:undefined},null,2));
