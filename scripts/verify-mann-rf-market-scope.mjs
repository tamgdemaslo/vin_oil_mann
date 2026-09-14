import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-exact-capacity-engine-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--request-context'));
const requestContext=process.argv[2]==='--request-context';
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const auditRaw=await readFile(resolve(dir,'recovered-rf-engine-recheck-v1.json'),'utf8');
const plan=JSON.parse(planRaw),audit=JSON.parse(auditRaw);
assert.equal(audit.planHash,sha(planRaw));
for(const [field,path] of [['matcherHash','mann-fluid-matcher-v2.ts'],['resolverHash','mann-vehicle-resolver.ts']])assert.equal(audit[field],sha(await readFile(resolve(root,'src/lib',path),'utf8')));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {mannTechnicalContextFromVehicle}=await jiti.import('../src/lib/mann-technical-request-context.ts');
const {toVehicle}=await jiti.import('../src/lib/vehicle-identity.ts');
const runtime=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
let checks=0,visible=0;
const proposals=[];
for(const finding of audit.results){
  assert.equal(finding.target.independentlyValidated,true);
  assert.deepEqual(finding.reasons,['SOURCE_RUSSIA_MARKET_CONDITION_NOT_YET_VERIFIED']);
  assert.deepEqual(finding.sourceConditions,{powerHp:83,fuelType:'diesel',market:'Россия'});
  const original=plan.newRevisions.find(r=>r.id===finding.revisionId);
  assert.equal(sha(original),finding.revisionHash);
  const scope={...original.applicabilityJson,matchedEngineScope:['RF'],requiredMarket:'RU'};
  const proposed={...original,applicabilityJson:scope}; // Diagnostic only, not a persistable revision.
  const bounds=scope.window.intersection,lo=index(bounds.from),hi=index(bounds.to);
  for(let m=lo-1;m<=hi+1;m++)for(const confirmedMarket of ['RU','DE',undefined])for(const engineCode of ['RF','WRONG',undefined]){
    const month=`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
    const context=requestContext ? JSON.parse(JSON.stringify(mannTechnicalContextFromVehicle(toVehicle({
      Brand:scope.sourceVehicleScope.make,Model:scope.sourceVehicleScope.model,Generation:scope.sourceVehicleScope.generation,
      EngineCode:engineCode,Market:confirmedMarket,
    },'tronk_vindecode'),{productionMonth:month})))
      : {...scope.sourceVehicleScope,engineCode,confirmedMarket,productionMonth:month};
    const items=profile([runtime(proposed)],undefined,context).items;
    const expected=confirmedMarket==='RU'&&engineCode==='RF'&&m>=lo&&m<=hi;
    assert.equal(items.length,expected?1:0);
    if(expected){
      const old=profile([runtime(original)],undefined,context).items;assert.equal(old.length,1);
      for(const field of ['capacities','specifications','viscosityGrades','replacementInterval','recommendation'])assert.deepEqual(items[0][field],old[0][field]);
      assert.equal(items[0].automaticSelectionEligible,false);visible++;
    }
    checks++;
  }
  proposals.push({originalRevisionId:original.id,originalRevisionHash:sha(original),proposedApplicability:scope,
    remaining:[...(requestContext?['LIVE_HTTP_AND_BROWSER_FLOW_NOT_VERIFIED']:['CONFIRMED_MARKET_INPUT_NOT_YET_WIRED_FROM_VIN_OR_USER']),'SEMANTIC_REPLACEMENT_AND_PREDECESSOR_RECONCILIATION'],publicationAllowed:false});
}
assert.equal(proposals.length,2);
const report={planHash:sha(planRaw),auditHash:sha(auditRaw),
  applicabilityHash:sha(await readFile(resolve(root,'src/lib/mann-technical-applicability.ts'),'utf8')),
  profileHash:sha(await readFile(resolve(root,'src/lib/mann-unified-technical-profile.ts'),'utf8')),
  requestContextHash:requestContext?sha(await readFile(resolve(root,'src/lib/mann-technical-request-context.ts'),'utf8')):null,
  vehicleIdentityHash:requestContext?sha(await readFile(resolve(root,'src/lib/vehicle-identity.ts'),'utf8')):null,
  vehicleMarketHash:requestContext?sha(await readFile(resolve(root,'src/lib/vehicle-market.ts'),'utf8')):null,
  summary:{proposals:proposals.length,checks,visible},proposals,productionApplyAllowed:false,
  limitation:'All bounded months plus neighbors tested for RF/wrong/missing engine and RU/DE/missing market. Optional request-context mode uses fixture provider response through production normalizer and request serializer. Technical payload preserved, not OEM verified. No plan merge, real provider call or HTTP/UI test.'};
await writeFile(resolve(dir,requestContext?'rf-market-request-verification-v1.json':'rf-market-scope-verification-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary));
