import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const suffix=process.argv[2]?`-${process.argv[2]}`:'';
assert.ok(process.argv.length===2||(process.argv.length===3&&['v2','v3','v4'].includes(process.argv[2])));
const raw=await readFile(resolve(dir,`conditional-transmission-plan${suffix}.json`),'utf8'),plan=JSON.parse(raw);
assert.equal(plan.productionApplyAllowed,false);
if(suffix==='-v4'){
  const metadataRaw=await readFile(resolve(dir,'source-system-context-v3.json'),'utf8');
  assert.equal(sha(metadataRaw),plan.systemContextHash);
  assert.equal(JSON.parse(metadataRaw).extractorHash,sha(await readFile(resolve(root,'src/lib/fluid-source-system-context.ts'),'utf8')));
  for(const row of plan.revisions){
    const metadata=row.provenanceJson.sourceSystemContext;
    assert.equal(metadata.destinationSystemCode,row.systemCode);
    assert.deepEqual(metadata.issues,[]);
    assert.equal(metadata.hasAdditionalLabelConditions,false);
    assert.equal(row.applicabilityJson.transmissionGearCount??null,metadata.transmissionGearCount);
  }
}
for(const [file,hash] of Object.entries(plan.codeHashes))assert.equal(sha(await readFile(resolve(root,file),'utf8')),hash);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),plan.inputHashes.source);
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {mannTransmissionComponent:classify}=await jiti.import('../src/lib/mann-transmission-component.ts');
const rows=plan.revisions.map(r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,
  run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalTransmissionPolicy:plan.policy,automaticProductSelection:false}}}));
let cases=0;const conflicts=[];
for(const row of rows){
  const scope=row.applicabilityJson,source=sources.get(row.sourceRequirementId);assert.ok(source);
  assert.equal(row.technicalDataJson.fillVolumeText,source.fillVolumeText);assert.deepEqual(row.technicalDataJson.specifications,source.specificationsJson);
  const component=classify(row.componentModel);assert.notEqual(component.kind,'conditions');
  for(const engineCode of scope.matchedEngineScope)for(const productionMonth of new Set([scope.window.intersection.from,scope.window.intersection.to].filter(Boolean))){
    const context={...scope.sourceVehicleScope,engineCode,productionMonth,transmissionGearCount:scope.transmissionGearCount,...(component.kind==='model'?{transmissionModel:component.model}:{})};
    const type=scope.transmissionType;
    const result=profile([row],type,context);
    assert.equal(result.items.length,1,row.id);assert.equal(result.items[0].automaticSelectionEligible,false);
    assert.equal(profile([row],undefined,context).items.length,0);
    assert.equal(profile([row],type==='automatic'?'manual':'automatic',context).items.length,0);
    if(scope.transmissionGearCount!=null){
      const noCount=profile([row],type,{...context,transmissionGearCount:undefined});
      assert.equal(noCount.items.length,0);assert.ok(noCount.transmissionGearCountOptions.includes(scope.transmissionGearCount));
      assert.equal(profile([row],type,{...context,transmissionGearCount:scope.transmissionGearCount===4?6:4}).items.length,0);
    }
    for(const invalid of [{engineCode:'WRONG'},{model:'WRONG'},{make:undefined},{productionMonth:'1800-01'}])assert.equal(profile([row],type,{...context,...invalid}).items.length,0);
    if(context.generation)assert.equal(profile([row],type,{...context,generation:'WRONG'}).items.length,0);
    if(component.kind==='model'){
      assert.equal(profile([row],type,{...context,transmissionModel:undefined}).items.length,0);
      assert.equal(profile([row],type,{...context,transmissionModel:'WRONG999'}).items.length,0);
    }
    const group=rows.filter(r=>r.vehicleVariantKey===row.vehicleVariantKey);
    const grouped=profile(group,type,context);
    const signatures=new Set(grouped.items.map(i=>sha({system:i.systemCode,capacities:i.capacities,specifications:i.specifications,componentModel:i.componentModel})));
    if(signatures.size>1)conflicts.push({vehicleVariantKey:row.vehicleVariantKey,type,context,items:grouped.items.map(i=>({id:i.revisionId,component:i.componentModel,capacities:i.capacities,specifications:i.specifications}))});
    cases++;
  }
}
const report={kind:'CONDITIONAL_TRANSMISSION_RUNTIME_VERIFICATION',planSha256:sha(raw),revisions:rows.length,individualCases:cases,
  individualIssues:0,compositionConflictCases:conflicts.length,productionApplyAllowed:false,
  limitation:'Synthetic runtime and sampled endpoints; not production HTTP or OEM verification. Composition conflicts require resolution before merge.',conflicts};
const reportPath=resolve(dir,`conditional-transmission-runtime${suffix}.json`),reportRaw=JSON.stringify(report,null,2)+'\n';
try { await writeFile(reportPath,reportRaw,{flag:'wx'}); }
catch(error){
  if(error.code!=='EEXIST')throw error;
  assert.equal(await readFile(reportPath,'utf8'),reportRaw,'Existing audit differs: use a new artifact version');
}
console.log(JSON.stringify({...report,conflicts:undefined},null,2));
if(suffix==='-v4')assert.equal(conflicts.length,0,'Unresolved composition conflicts prevent merging');
