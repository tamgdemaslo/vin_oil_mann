import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),path=resolve(dir,'plan.json'),reportPath=resolve(dir,'literal-drive-repair-v1.json');
const raw=await readFile(path,'utf8'),mode=process.argv[2];
if(mode==='prepare'){
 const plan=JSON.parse(raw),auditRaw=await readFile(resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2/legacy-vehicle-drive-audit-v1.json'),'utf8'),audit=JSON.parse(auditRaw);assert.equal(sha(raw),audit.planHash);
 const mann=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mann),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');const variants=Map.groupBy(parseCopy(mann,'mann_filter_applications'),r=>r.vehicleVariantKey);
 const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
 const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
 const changes=[],ids=new Map();let checks=0;
 for(const f of audit.findings.filter(f=>f.missingLiteralDriveGate)){
  const before=plan.newRevisions.find(r=>r.id===f.revisionId);assert.equal(sha(before),f.revisionHash);assert.equal(before.applyEligible,false);assert.equal(before.verificationStatus,'UNVERIFIED');
  assert.equal(f.coveringBranches.length,1);assert.deepEqual(f.literalDrives,['4WD']);const branch=f.coveringBranches[0];
  const powers=[...new Set(variants.get(f.vehicleVariantKey).map(r=>Number(r.hp)))];assert.equal(powers.length,1);
  const powerMatches=branch.powerHp.includes(powers[0]),after=structuredClone(before);
  if(powerMatches){
   after.applicabilityJson.requiredVehicleDrive='4WD';
   for(const b of after.technicalDataJson.capacityBranches??[])b.applicabilityJson.requiredVehicleDrive='4WD';
   after.provenanceJson.literalVehicleDriveRepair={auditHash:sha(auditRaw),originalRevisionId:before.id,originalRevisionHash:sha(before),branch,mannPowerHp:powers[0],publicationAllowed:false};
   after.semanticFingerprint=sha({policy:after.provenanceJson.catalogPreviewPolicy,sourceRequirementId:after.sourceRequirementId,vehicleVariantKey:after.vehicleVariantKey,applicability:after.applicabilityJson,technical:after.technicalDataJson});after.id=`mtar_${after.semanticFingerprint.slice(0,24)}`;ids.set(before.id,after.id);
  }else{
   after.provenanceJson.catalogPreviewEligible=false;after.provenanceJson.conditionalEquipmentEligible=false;
   after.provenanceJson.sourcePowerReviewHold={reason:'LITERAL_ENGINE_POWER_MISMATCH',auditHash:sha(auditRaw),reviewRevisionId:before.id,sourcePowerHp:branch.powerHp,mannPowerHp:powers[0],publicationAllowed:false};
  }
  const a=before.applicabilityJson,n=x=>Number(x.slice(0,4))*12+Number(x.slice(5))-1,from=n(a.window.intersection.from),to=n(a.window.intersection.to);let baseline=0;
  for(let m=from-1;m<=to+1;m++)for(const confirmedDrive of [undefined,'2WD','4WD']){
   const context={...a.sourceVehicleScope,engineCode:a.matchedEngineScope[0],productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`,confirmedMarket:a.requiredMarket,confirmedDrive};
   const old=profile([fixture(before)],undefined,context),next=profile([fixture(after)],undefined,context);baseline+=old.items.length;
   const expected=powerMatches&&confirmedDrive==='4WD'&&m>=from&&m<=to;assert.equal(next.items.length,expected?old.items.length:0);
   if(expected){assert.equal(next.items.length,1);assert.deepEqual({...next.items[0],revisionId:before.id},old.items[0]);}
   checks++;
  }
  assert.ok(baseline>0);changes.push({before,after,action:powerMatches?'REQUIRE_LITERAL_4WD':'HOLD_POWER_CONFLICT',sourcePowerHp:branch.powerHp,mannPowerHp:powers[0]});
 }
 assert.equal(changes.length,9);assert.equal(ids.size,5);
 const render=x=>JSON.stringify(x,null,2).split('\n').map(l=>'    '+l).join('\n')+',';
 const operations=changes.map(c=>({from:render(c.before),to:render(c.after)}));let actionReferences=0;
 for(const a of plan.existingActions)if(ids.has(a.successorId)){operations.push({from:render(a),to:render({...a,successorId:ids.get(a.successorId)})});actionReferences++;}
 const history={parentPlanHash:sha(raw),auditHash:sha(auditRaw),changes:changes.map(c=>({beforeId:c.before.id,afterId:c.after.id,action:c.action})),checks,actionReferences,productionApplyAllowed:false};
 const anchor='  "kind": '+JSON.stringify(plan.kind)+',';
 operations.push({from:anchor,to:anchor+'\n'+JSON.stringify({literalVehicleDriveRepair:history},null,2).split('\n').slice(1,-1).join('\n')+','});
 let next=raw;for(const o of operations){assert.equal(next.split(o.from).length,2);next=next.replace(o.from,o.to);}
 const updated=JSON.parse(next),newIds=new Set(updated.newRevisions.map(r=>r.id));assert.equal(newIds.size,2025);
 for(const a of updated.existingActions)if(a.successorId)assert.ok(newIds.has(a.successorId));
 assert.deepEqual(updated.summary,plan.summary);assert.deepEqual(updated.protectedBranches,plan.protectedBranches);
 await writeFile(reportPath,JSON.stringify({parentPlanHash:sha(raw),afterPlanHash:sha(next),operations,changes,checks,actionReferences,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({changes:9,driveGates:5,powerHolds:4,checks,actionReferences,afterPlanHash:sha(next)}));
}else{
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 if(mode==='patch'){
  const index=Number(process.argv[3]);assert.ok(Number.isInteger(index)&&index>=0&&index<report.operations.length);
  let restored=raw;for(const o of report.operations.slice(0,index).reverse()){assert.equal(restored.split(o.to).length,2);restored=restored.replace(o.to,o.from);}assert.equal(sha(restored),report.parentPlanHash);
  const o=report.operations[index];assert.equal(raw.split(o.from).length,2);
  process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n@@\n'+o.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+o.to.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n');
 }
 else if(mode==='verify'){assert.equal(sha(raw),report.afterPlanHash);let restored=raw;for(const o of [...report.operations].reverse()){assert.equal(restored.split(o.to).length,2);restored=restored.replace(o.to,o.from);}assert.equal(sha(restored),report.parentPlanHash);console.log(JSON.stringify({fullFileReversalVerified:true,planHash:sha(raw),checks:report.checks,actionReferences:report.actionReferences}));}
 else throw Error('Unknown mode');
}
