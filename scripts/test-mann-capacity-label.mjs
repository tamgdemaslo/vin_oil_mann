import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {mannCapacityLabel:label}=await j.import('../src/lib/mann-capacity-label.ts');
const {buildMannUnifiedTechnicalProfile:build}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const base={id:'test',sourceRequirementId:'test',systemCode:'ENGINE_COOLANT',componentModel:null,applicabilityJson:{},verifiedFieldsJson:['technical.capacity'],fieldConfidenceJson:{'technical.capacity':'PRIMARY_SOURCE_VERIFIED'},evidenceJson:[{publisher:'Synthetic transport test — not OEM evidence'}],provenanceJson:{},state:'STAGED',verificationStatus:'PRIMARY_SOURCE_VERIFIED_FIELDS',matchClass:'PRIMARY_SOURCE_VERIFIED_SUBSET',applyEligible:false,reviewConfirmed:false,matchScore:100,createdAt:new Date(),run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{}}};
const convert=capacity=>build([{...base,reviewConfirmed:true,evidenceJson:[{publisher:'Synthetic transport test',title:'Test fixture — not OEM evidence'}],technicalDataJson:{capacity}}]).items[0]?.capacity;
const cases=[
 [{qualifier:'APPROXIMATE',nominalLiters:8},'примерно 8 л'],
 [{qualifier:'UP_TO',maxLiters:4,nominalLiters:4},'до 4 л'],
 [{qualifier:'RANGE',minLiters:4,maxLiters:5,nominalLiters:5},'4–5 л'],
 [{qualifier:'TOLERANCE',nominalLiters:4,toleranceLiters:0.1},'4 л ± 0,1 л'],
 [{qualifier:'EXACT',nominalLiters:8.365,serviceContext:'TOTAL'},'8,365 л · полная ёмкость'],
 [{nominalLiters:4,serviceContext:'PARTIAL'},'4 л · частичная замена'],
];
for(const [capacity,expected]of cases)assert.equal(label(convert(capacity)),expected);
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),'31f8407dde303ca792f858299a5c40282a4079d65b9e8a9a8e020941e8411c5c');const plan=JSON.parse(raw);
const findings=[],qualifiers={};
function walk(value,path,revision){
 if(!value||typeof value!=='object')return;
 if(['nominalLiters','minLiters','maxLiters'].some(k=>typeof value[k]==='number')){
  const output=convert(value);assert.ok(output,`${revision.id} ${path}`);
  for(const key of ['nominalLiters','minLiters','maxLiters','toleranceLiters'])assert.equal(output[key],value[key]??undefined,`${path} ${key}`);
  if(value.qualifier)assert.equal(output.qualifier,value.qualifier);
  const display=label(output);if(value.qualifier==='APPROXIMATE')assert.ok(display.startsWith('примерно '));if(value.qualifier==='UP_TO')assert.ok(display.startsWith('до '));
  qualifiers[value.qualifier??'missing']=(qualifiers[value.qualifier??'missing']??0)+1;
  findings.push({revisionId:revision.id,path,qualifier:value.qualifier,display});return;
 }
 for(const [k,v]of Object.entries(value))walk(v,`${path}.${k}`,revision);
}
for(const r of plan.newRevisions)walk(r.technicalDataJson,'technicalDataJson',r);
assert.equal(sha(JSON.parse(raw)),sha(plan));assert.ok(findings.length>=1885);
const report={kind:'CANONICAL_CAPACITY_TRANSPORT_AND_LABEL_CHECK',planHash:sha(raw),checkedRevisions:plan.newRevisions.length,checkedCapacities:findings.length,qualifiers,syntheticCases:cases.length,findings,productionApplyAllowed:false,limitation:'Tests representation using synthetic publication fixtures, not real revision eligibility, vehicle identity or OEM approval.'};
await writeFile(resolve(dir,'capacity-label-verification-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined}));
