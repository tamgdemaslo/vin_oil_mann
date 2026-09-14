import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCopy, sha } from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-combined-preview-plan-2026-09-13');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const plan=JSON.parse(planRaw);
assert.equal(plan.inputHashes.source,sha(sourceRaw));
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),mann=parseCopy(mannRaw,'mann_filter_applications');
const sourceMap=new Map(sources.map(r=>[r.id,r]));
assert.equal(sourceMap.size,sources.length);
const modelNames = new Map();
for(const source of sources){
  const key=`${source.makeNormalized}:${source.modelNormalized}`;
  const names=modelNames.get(key)??new Set();names.add(source.model);modelNames.set(key,names);
}
const pages=[...Map.groupBy(sources,r=>r.sourceUrl)].map(([url,rows])=>{
  let path=[];try{path=new URL(url).pathname.split('/').filter(Boolean);}catch{}
  const tail=path.at(-1)??'';
  const signals=[];
  const missingGeneration=rows.filter(r=>!r.generation?.trim());
  const noBody=rows.filter(r=>!(r.bodyCodesJson??[]).some(code=>!/^\d+GEN$/i.test(code)));
  if(missingGeneration.length)signals.push('MISSING_GENERATION');
  if(noBody.length)signals.push('MISSING_REAL_BODY_CODE');
  if(missingGeneration.length && /(?:^|[_-])(?:gen\d+|\d+gen|[a-z])$/i.test(tail))signals.push('URL_HAS_POSSIBLE_GENERATION_NOT_IN_FIELDS');
  if(rows.some(r=>(r.bodyCodesJson??[]).some(code=>/^\d+GEN$/i.test(code))))signals.push('GENERATION_PLACEHOLDER_IN_BODY_CODES');
  return {sourceUrl:url,pathTail:tail,requirements:rows.length,requirementIds:rows.map(r=>r.id),
    makes:[...new Set(rows.map(r=>r.make))],models:[...new Set(rows.map(r=>r.model))],
    generations:[...new Set(rows.map(r=>r.generation))],bodyCodes:[...new Set(rows.flatMap(r=>r.bodyCodesJson??[]))],
    missingGeneration:missingGeneration.length,missingRealBodyCode:noBody.length,signals,automaticCorrectionAllowed:false};
});
const candidateByVariant=Map.groupBy(plan.newRevisions,r=>r.vehicleVariantKey),mannByVariant=Map.groupBy(mann,r=>r.vehicleVariantKey);
const shared=[];
for(const [key,candidates] of candidateByVariant){
  const identityGroups=Map.groupBy(candidates,r=>{const s=sourceMap.get(r.sourceRequirementId);return `${s.make}:${s.model}:${s.generation??''}`;});
  if(identityGroups.size<2)continue;
  shared.push({vehicleVariantKey:key,mannModels:[...new Set((mannByVariant.get(key)??[]).map(r=>r.model))],
    sourceIdentities:[...identityGroups].map(([identity,rows])=>({identity,revisionIds:rows.map(r=>r.id),sourceUrls:[...new Set(rows.map(r=>sourceMap.get(r.sourceRequirementId).sourceUrl))]})),requiresReview:true});
}
const flagged=pages.filter(p=>p.signals.includes('URL_HAS_POSSIBLE_GENERATION_NOT_IN_FIELDS'));
const report={kind:'FULL_SOURCE_IDENTITY_AUDIT',sourceHashes:{source:sha(sourceRaw),mann:sha(mannRaw),plan:sha(planRaw)},
  requirements:sources.length,pages:pages.length,missingGeneration:sources.filter(r=>!r.generation?.trim()).length,
  possibleLostGenerationPages:flagged.length,possibleLostGenerationRequirements:flagged.reduce((n,p)=>n+p.missingGeneration,0),
  multiIdentityCandidateVariants:shared.length,productionApplyAllowed:false,
  limitation:'URL patterns are review signals only, not verified generation/body corrections. Shared variants are not necessarily conflicts.',
  pageFindings:pages,sharedCandidateVariants:shared};
await writeFile(resolve(dir,'source-identity-audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,pageFindings:undefined,sharedCandidateVariants:undefined},null,2));
console.log(JSON.stringify(flagged.map(p=>({url:p.sourceUrl,requirements:p.requirements,generations:p.generations})),null,2));
