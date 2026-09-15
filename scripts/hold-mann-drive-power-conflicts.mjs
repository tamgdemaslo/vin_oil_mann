import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),path=resolve(dir,'plan.json'),reportPath=resolve(dir,'drive-power-conflict-holds-v1.json'),mode=process.argv[2],raw=await readFile(path,'utf8');
if(mode==='prepare'){
 const plan=JSON.parse(raw),auditRaw=await readFile(resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2/legacy-vehicle-drive-recheck-v2.json'),'utf8'),audit=JSON.parse(auditRaw);assert.equal(sha(raw),audit.planHash);
 const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
 const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
 const changes=[];let checks=0,baselineVisible=0;
 for(const f of audit.findings.filter(f=>!f.exactPowerBranches.length)){
  const before=plan.newRevisions.find(r=>r.id===f.revisionId);assert.equal(sha(before),f.revisionHash);assert.equal(before.applyEligible,false);assert.equal(before.verificationStatus,'UNVERIFIED');assert.ok(f.branches.length);
  const after=structuredClone(before);after.provenanceJson.catalogPreviewEligible=false;after.provenanceJson.conditionalEquipmentEligible=false;
  after.provenanceJson.sourcePowerReviewHold={reason:'CATALOG_ENGINE_POWER_PAIR_NOT_PROVEN',auditHash:sha(auditRaw),reviewRevisionId:before.id,sourceBranches:f.branches,mannPowerHp:f.mannPowers,publicationAllowed:false};
  const a=before.applicabilityJson,n=x=>Number(x.slice(0,4))*12+Number(x.slice(5))-1,from=n(a.window.intersection.from),to=n(a.window.intersection.to);
  for(let m=from;m<=to;m++)for(const confirmedDrive of [undefined,'2WD','4WD']){
   const context={...a.sourceVehicleScope,engineCode:a.matchedEngineScope[0],productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`,confirmedMarket:a.requiredMarket,confirmedDrive};
   baselineVisible+=profile([fixture(before)],undefined,context).items.length;
   const result=profile([fixture(after)],undefined,context);assert.equal(result.items.length,0);assert.equal(result.vehicleDriveRequired,undefined);checks++;
  }
  changes.push({before,after,action:'HOLD_POWER_CONFLICT'});
 }
 assert.equal(changes.length,10);assert.ok(baselineVisible>0);
 const render=x=>JSON.stringify(x,null,2).split('\n').map(l=>'    '+l).join('\n')+',';
 const operations=changes.map(c=>({from:render(c.before),to:render(c.after)}));
 let next=raw;for(const o of operations){assert.equal(next.split(o.from).length,2);next=next.replace(o.from,o.to);}
 const updated=JSON.parse(next);assert.deepEqual(updated.existingActions,plan.existingActions);assert.deepEqual(updated.summary,plan.summary);assert.deepEqual(updated.protectedBranches,plan.protectedBranches);assert.deepEqual(updated.newRevisions.map(r=>[r.id,r.semanticFingerprint,r.technicalDataJson,r.applicabilityJson]),plan.newRevisions.map(r=>[r.id,r.semanticFingerprint,r.technicalDataJson,r.applicabilityJson]));
 await writeFile(reportPath,JSON.stringify({parentPlanHash:sha(raw),afterPlanHash:sha(next),auditHash:sha(auditRaw),changes,operations,checks,baselineVisible,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({holds:10,checks,baselineVisible,afterPlanHash:sha(next)}));
}else{
 const r=JSON.parse(await readFile(reportPath,'utf8'));
 if(mode==='patch'){
  const index=Number(process.argv[3]);assert.ok(Number.isInteger(index)&&index>=0&&index<r.operations.length);let restored=raw;
  for(const o of r.operations.slice(0,index).reverse()){assert.equal(restored.split(o.to).length,2);restored=restored.replace(o.to,o.from);}assert.equal(sha(restored),r.parentPlanHash);const o=r.operations[index];assert.equal(raw.split(o.from).length,2);
  process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n@@\n'+o.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+o.to.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n');
 }else if(mode==='verify'){
  assert.equal(sha(raw),r.afterPlanHash);let restored=raw;for(const o of r.operations.slice().reverse()){assert.equal(restored.split(o.to).length,2);restored=restored.replace(o.to,o.from);}assert.equal(sha(restored),r.parentPlanHash);console.log(JSON.stringify({fullFileReversalVerified:true,planHash:sha(raw),holds:10,checks:r.checks}));
 }else throw Error('Unknown mode');
}
