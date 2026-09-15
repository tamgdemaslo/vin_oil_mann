import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {parseVolvoLiteralEngineApplication as parse} from './lib/mann-volvo-literal-engine-application.mjs';
import {parsePowerDriveEngineApplication as parsePowerDrive} from './lib/mann-power-drive-engine-application.mjs';
import {volvoApplicationBranches as legacyParse} from './lib/mann-volvo-application-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const planRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8'),plan=JSON.parse(planRaw);assert.equal(sha(planRaw),'0b26388def0c8a88ec23bada5ff32bb8b012f548abdebf34a16a12e653888096');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),plan.inputHashes.source);const sources=parseCopy(sql,'vehicle_fluid_requirements'),byId=new Map(sources.map(s=>[s.id,s])),tables=Map.groupBy(sources,s=>s.sourceTableKey);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const rows=new Map(raw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts'),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts');
const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
const previous=JSON.parse(await readFile(resolve(dir,'legacy-vehicle-drive-audit-v1.json'),'utf8'));
const heldIds=new Set(previous.findings.filter(f=>f.classification==='UNPARSED_OR_UNMATCHED_ANCHOR').map(f=>f.revisionId));
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');const variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const findings=[];
for(const r of plan.newRevisions.filter(r=>heldIds.has(r.id))){
 assert.equal(sha(r),previous.findings.find(f=>f.revisionId===r.id).revisionHash);
 const s=byId.get(r.sourceRequirementId),a=r.applicabilityJson;
 const anchors=[...new Map(tables.get(s.sourceTableKey).filter(s=>s.systemCode==='ENGINE_OIL').map(s=>[s.sourceRowId,rows.get(s.sourceRowId)])).values()];
 const evidence=anchors.map(row=>{
  let parsed=parse(row.application,s.makeNormalized)??parsePowerDrive(row.application,s.makeNormalized);
  if(!parsed&&s.makeNormalized==='VOLVO'){
   const p=legacyParse(row.application);
   if(p&&p.branches.every(b=>b.engineCode.startsWith('D')?p.rawFuel==='Тип топлива: Дизель':p.rawFuel==='Тип топлива: Бензин')){
    const years=p.rawYears.match(/(\d{4})-(\d{4})$/);assert.ok(years);
    parsed={branches:p.branches.map(b=>({...b,powerHp:[b.powerHp],effectiveDates:{from:`${Math.max(+years[1],b.yearFrom)}-01`,to:`${Math.min(+years[2],b.yearTo)}-12`},raw:b.sourcePhrase}))};
   }
  }
  return {rowId:row.row_id,rowHash:sha(row),application:row.application,parsed};
 });
 const branches=evidence.flatMap(e=>(e.parsed?.branches??[]).map(b=>({...b,anchorRowId:e.rowId,anchorHash:e.rowHash}))).filter(b=>(a.matchedEngineScope??[]).map(norm).includes(norm(b.engineCode)));
 const mannPowers=[...new Set(variants.get(r.vehicleVariantKey).map(r=>Number(r.hp)))];
 const exactPowerBranches=branches.filter(b=>mannPowers.length===1&&b.powerHp.includes(mannPowers[0]));
 const drives=[...new Set(branches.flatMap(b=>b.driveCondition?.split(',').map(s=>s.trim())??[]))];
 const covering=branches.filter(b=>b.effectiveDates.from<=a.window?.intersection?.from&&(!b.effectiveDates.to||b.effectiveDates.to>=a.window?.intersection?.to));
 const classification=!evidence.length||evidence.some(e=>!e.parsed)||!branches.length?'UNPARSED_OR_UNMATCHED_ANCHOR':!covering.length?'BRANCH_DATES_NARROWER_THAN_DRAFT':drives.length===1&&['2WD','4WD'].includes(drives[0])?'LITERAL_SINGLE_DRIVE':drives.length===2&&drives.includes('2WD')&&drives.includes('4WD')?'LITERAL_BOTH_DRIVES':'DRIVE_NOT_PROVEN';
 const context={...a.sourceVehicleScope,engineCode:a.matchedEngineScope?.[0],productionMonth:a.window?.intersection?.from,transmissionModel:a.componentModel,transmissionGearCount:a.transmissionGearCount??a.requiredTransmission?.gearCount,confirmedMarket:a.requiredMarket};
 const type=a.requiredTransmission?.type??a.transmissionType;
 const observations=[undefined,'2WD','4WD'].map(confirmedDrive=>({confirmedDrive:confirmedDrive??null,visible:profile([fixture(r)],type,{...context,confirmedDrive}).items.some(i=>i.revisionId===r.id)}));
 findings.push({revisionId:r.id,revisionHash:sha(r),sourceRequirementId:s.id,sourceHash:sha(s),vehicleVariantKey:r.vehicleVariantKey,systemCode:r.systemCode,legacyDriveType:a.driveType,scope:a,evidence,branches,mannPowers,exactPowerBranches,coveringBranches:covering,classification,literalDrives:drives,observations,missingLiteralDriveGate:classification==='LITERAL_SINGLE_DRIVE'&&observations.some(o=>o.confirmedDrive!==drives[0]&&o.visible),productionApplyAllowed:false});
}
assert.equal(findings.length,19);
const summary={revisions:19,sourceRecords:new Set(findings.map(f=>f.sourceRequirementId)).size,classifications:Object.fromEntries([...Map.groupBy(findings,f=>f.classification)].map(([k,a])=>[k,a.length])),missingLiteralDriveGate:findings.filter(f=>f.missingLiteralDriveGate).length};
await writeFile(resolve(dir,'legacy-vehicle-drive-recheck-v2.json'),JSON.stringify({kind:'LEGACY_DRIVE_REMAINING_ANCHOR_RECHECK',planHash:sha(planRaw),sourceHash:sha(sql),rawHash:sha(raw),summary,findings,productionApplyAllowed:false,limitations:['Own raw engine tables and same-table anchors inspected; no inferred drive from legacy awd field.','Single-drive result is a defect candidate, not an automatic scope rewrite: exact power/branch/years still require validation.','Synthetic single-record display probes, not a real VIN or live database.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
