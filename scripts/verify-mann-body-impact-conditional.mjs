import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--specific-body'));
const specific=process.argv[2]==='--specific-body';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,specific?'outputs/mann-passat-date-inclusive-preview-2026-09-14':'outputs/mann-passat-inclusive-preview-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);
const auditRaw=await readFile(resolve(dir,specific?'specific-body-preview-recheck-v1.json':'body-hardening-preview-recheck-v2.json'),'utf8'),audit=JSON.parse(auditRaw);
assert.equal(audit.planHash,sha(planRaw));
assert.equal(audit.resolverHash,sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')));
const revisions=new Map(plan.newRevisions.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {mannTransmissionComponent:classify}=await jiti.import('../src/lib/mann-transmission-component.ts');
const results=[];let assertions=0;
for(const entry of audit.results.filter(r=>r.disposition==='TARGET_REQUIRES_REVIEW'&&(!specific||!r.target.hardConflicts.length))){
  const row=revisions.get(entry.revisionId);assert.ok(row);assert.equal(sha(row),entry.revisionHash);
  assert.deepEqual(entry.target.hardConflicts,[]);
  const p=row.provenanceJson,scope=row.applicabilityJson,equipment=Boolean(p.conditionalEquipmentPolicy);
  assert.ok(equipment||p.conditionalTransmissionPolicy);
  const allowed=equipment?['MANN variant не подтверждает привод или модель агрегата','MANN variant не подтверждает наличие этой гидравлической системы']:['MANN variant не подтверждает тип или модель коробки'];
  assert.ok(entry.target.reviewBlockers.length>0&&entry.target.reviewBlockers.every(r=>allowed.includes(r)));
  const runtime={...row,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,
    productionApplyAuthorized:false,gatesJson:{automaticProductSelection:false,...(equipment?{conditionalEquipmentPolicy:p.conditionalEquipmentPolicy}:{conditionalTransmissionPolicy:p.conditionalTransmissionPolicy})}}};
  let checked=0;
  for(const engineCode of scope.matchedEngineScope)for(const productionMonth of new Set(Object.values(scope.window.intersection).filter(Boolean))){
    const base={...scope.sourceVehicleScope,engineCode,productionMonth};
    const assertCount=(type,context,count)=>{const result=profile([runtime],type,context);assert.equal(result.items.length,count,row.id);assertions++;return result;};
    let context,type;
    if(equipment){
      const {systemCode,...confirmation}=scope.requiredEquipment;assert.equal(systemCode,row.systemCode);
      type=confirmation.attachedTransmissionType??undefined;
      context={...base,confirmedEquipment:[confirmation]};
      const blank=assertCount(type,base,0);assert.ok(blank.equipmentOptions?.length);
      assertCount(type,{...context,confirmedEquipment:[]},0);
      assertCount(type,{...context,confirmedEquipment:[{...confirmation,circuit:'WRONG'}]},0);
      assertCount(type,{...context,confirmedEquipment:[confirmation,confirmation]},0);
      if(confirmation.drive){
        assertCount(type,{...context,confirmedEquipment:[{...confirmation,drive:undefined}]},0);
        assertCount(type,{...context,confirmedEquipment:[{...confirmation,drive:confirmation.drive==='4WD'?'2WD':'4WD'}]},0);
      }
    }else{
      const component=classify(row.componentModel);assert.notEqual(component.kind,'conditions');
      type=scope.transmissionType;
      context={...base,transmissionGearCount:scope.transmissionGearCount,...(component.kind==='model'?{transmissionModel:component.model}:{})};
      assertCount(undefined,context,0);assertCount(type==='manual'?'automatic':'manual',context,0);
      if(scope.transmissionGearCount!=null){
        assertCount(type,{...context,transmissionGearCount:undefined},0);
        assertCount(type,{...context,transmissionGearCount:scope.transmissionGearCount===5?6:5},0);
      }
      if(component.kind==='model')for(const transmissionModel of [undefined,'WRONG'])assertCount(type,{...context,transmissionModel},0);
    }
    const shown=assertCount(type,context,1);
    assert.equal(shown.items[0].automaticSelectionEligible,false);
    assert.equal(shown.items[0].capacities.length,row.technicalDataJson.capacities.length);
    for(const wrong of [{engineCode:'WRONG'},{model:'WRONG'},{make:'WRONG'},{productionMonth:'1800-01'}])assertCount(type,{...context,...wrong},0);
    if(context.generation)assertCount(type,{...context,generation:'WRONG'},0);
    checked++;
  }
  assert.ok(checked);results.push({revisionId:row.id,revisionHash:sha(row),kind:equipment?'EQUIPMENT':'TRANSMISSION',checkedContexts:checked,
    status:'CONDITIONAL_RUNTIME_GATES_PASSED',publicationAllowed:false});
}
assert.equal(results.length,specific?21:16);
const report={kind:'BODY_HARDENING_CONDITIONAL_RUNTIME_REPLAY',planHash:sha(planRaw),auditHash:sha(auditRaw),productionApplyAllowed:false,
  summary:{revisions:results.length,contexts:results.reduce((n,r)=>n+r.checkedContexts,0),profileAssertions:assertions},
  limitation:'Local endpoint/choice checks for selected unchanged revisions; hard-conflict records excluded, not cleared. Not primary source equipment verification, full-month production API checks or complete resolver impact clearance.',results};
await writeFile(resolve(dir,specific?'specific-body-conditional-runtime-v1.json':'body-impact-conditional-runtime-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
