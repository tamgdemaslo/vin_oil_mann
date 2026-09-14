import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
import {intersectMonths,unionMonths,subtractMonths} from './lib/mann-month-intervals.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-non-ru-market-guarded-preview-2026-09-14');
const [planRaw,draftRaw,recheckRaw,partitionRaw]=await Promise.all(['plan.json','source-market-month-drafts-v1.json','source-market-month-identity-recheck-v1.json','source-market-month-partition-v1.json'].map(f=>readFile(resolve(dir,f),'utf8')));
const plan=JSON.parse(planRaw),draft=JSON.parse(draftRaw),recheck=JSON.parse(recheckRaw),partition=JSON.parse(partitionRaw);assert.equal(draft.planHash,sha(planRaw));assert.equal(draft.recheckHash,sha(recheckRaw));assert.equal(draft.partitionHash,sha(partitionRaw));
for(const[file,hash]of Object.entries(draft.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts'),{mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts'),{normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const oldRows=new Map(plan.newRevisions.map(r=>[r.id,r])),proposals=new Map(recheck.findings.flatMap(f=>f.branches.map(b=>[`${f.revisionId}:${b.proposalHash}`,{...b,revisionId:f.revisionId}]))),seen=new Set();let negativeChecks=0;
for(const d of draft.drafts){
 const old=oldRows.get(d.originalRevisionId),fresh=d.revision;assert.equal(sha(old),d.originalRevisionHash);
 for(const field of Object.keys(old).filter(k=>!['id','semanticFingerprint','applicabilityJson','technicalDataJson','provenanceJson'].includes(k)))assert.deepEqual(fresh[field],old[field]);
 const {sourceMarketMonthRepair,...provenance}=fresh.provenanceJson;assert.deepEqual(provenance,old.provenanceJson);
 const tech=structuredClone(fresh.technicalDataJson);for(let i=0;i<(tech.capacityBranches??[]).length;i++)tech.capacityBranches[i].applicabilityJson=old.technicalDataJson.capacityBranches[i].applicabilityJson;assert.deepEqual(tech,old.technicalDataJson);
 for(const hash of d.proposalHashes){const key=`${old.id}:${hash}`;assert.ok(!seen.has(key));seen.add(key);const b=proposals.get(key);assert.ok(b);assert.equal(b.revisionId,old.id);assert.deepEqual(b.identityReasons,[]);
  const p=b.proposal,scope=fresh.technicalDataJson.capacityBranches?.[p.scopeIndex]?.applicabilityJson??fresh.applicabilityJson,oldScope=old.technicalDataJson.capacityBranches?.[p.scopeIndex]?.applicabilityJson??old.applicabilityJson;
  assert.deepEqual(scope.matchedEngineScope,[p.engineCode]);assert.equal(scope.requiredMarket,p.requiredMarket);assert.deepEqual(scope.window.intersection,p.window);assert.deepEqual(scope.window.source,p.sourceBranchWindow);assert.deepEqual(scope.window.mann,oldScope.window.mann);
  assert.deepEqual(intersectMonths(p.window,oldScope.window.intersection),p.window);
  for(const field of Object.keys(oldScope).filter(k=>!['yearFrom','yearTo','matchedEngineScope','requiredMarket','window'].includes(k)))assert.deepEqual(scope[field],oldScope[field]);
 }
 const s=fresh.applicabilityJson,m=component(fresh.componentModel),{systemCode,...equipment}=s.requiredEquipment??{},context={...s.sourceVehicleScope,engineCode:s.matchedEngineScope[0],productionMonth:s.window.intersection.from??s.window.intersection.to,confirmedMarket:s.requiredMarket,transmissionModel:m.kind==='model'?m.model:undefined,transmissionGearCount:s.transmissionGearCount,confirmedEquipment:systemCode?[equipment]:undefined};
 const row={...fresh,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:fresh.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:fresh.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:fresh.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}};
 const variants=[{engineCode:undefined},{engineCode:'WRONG_ENGINE'},{confirmedMarket:undefined},{confirmedMarket:'UNKNOWN'}];
 if(systemCode)variants.push({confirmedEquipment:[]});
 if(s.transmissionGearCount!==undefined)variants.push({transmissionGearCount:undefined},{transmissionGearCount:99});
 if(fresh.provenanceJson.conditionalTransmissionPolicy&&m.kind==='model')variants.push({transmissionModel:undefined},{transmissionModel:'WRONG_MODEL'});
 for(const type of [undefined,'automatic','manual','cvt','robot'])for(const change of variants){assert.equal(profile([row],type,{...context,...change}).items.length,0,`${old.id}: ${JSON.stringify(change)}`);negativeChecks++;}
}
const accepted=recheck.findings.flatMap(f=>f.branches.filter(b=>!b.identityReasons.length).map(b=>`${f.revisionId}:${b.proposalHash}`));assert.equal(seen.size,accepted.length);assert.ok(accepted.every(key=>seen.has(key)));
const sourcePartitions=[];
for(const f of partition.findings){
 const current=draft.drafts.filter(d=>d.originalRevisionId===f.revisionId),branches=f.partition.map(b=>{
  const candidateWindows=unionMonths(current.filter(d=>d.revision.applicabilityJson.requiredMarket===b.requiredMarket&&d.revision.provenanceJson.sourceMarketMonthRepair.sourcePowerHp===b.powerHp&&d.revision.applicabilityJson.matchedEngineScope.some(e=>norm(e)===norm(b.engineCode))).map(d=>intersectMonths(d.revision.applicabilityJson.window.intersection,b.sourceWindow)).filter(Boolean));
  const pendingWindows=subtractMonths(b.sourceWindow,candidateWindows);assert.deepEqual(unionMonths([...candidateWindows,...pendingWindows]),[b.sourceWindow]);for(const x of candidateWindows)for(const y of pendingWindows)assert.equal(intersectMonths(x,y),null);
  return {...b,candidateWindows,pendingWindows};
 });sourcePartitions.push({originalRevisionId:f.revisionId,sourceRequirementId:f.sourceRequirementId,replacementRevisionIds:current.map(d=>d.revision.id),branches,publicationAllowed:false});
}
const summary={drafts:draft.drafts.length,representedProposalBranches:seen.size,negativeChecks,sourcePartitions:sourcePartitions.length,pendingIntervals:sourcePartitions.reduce((n,p)=>n+p.branches.reduce((k,b)=>k+b.pendingWindows.length,0),0)};
await writeFile(resolve(dir,'source-market-month-draft-verification-v1.json'),JSON.stringify({planHash:sha(planRaw),draftHash:sha(draftRaw),partitionHash:sha(partitionRaw),summary,sourcePartitions,productionApplyAllowed:false,limitation:'Structural preservation, negative runtime context tests, and source partition recomputed using only identity-passed drafts. Drafts remain unverified technical source data, not production coverage.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
