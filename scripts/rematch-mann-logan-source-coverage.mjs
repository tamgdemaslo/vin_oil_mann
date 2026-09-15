import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const version=process.argv[2]??'v1';assert.ok(['v1','v2','v3'].includes(version));const partition=version!=='v1';
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);assert.equal(sha(planRaw),'244d1c661d1ac5d6943c1c9b97b41e4c4072847ca002ef6740b682d34cee3936');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sourceRaw),plan.inputHashes.source);
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(s=>[s.id,s])),rows=parseCopy(mannRaw,'mann_filter_applications');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const key='8edddc03d3a2997c6f9257dc8da33b1264a7bbd15e992901673cbc30c0697321',targetRows=rows.filter(r=>r.vehicleVariantKey===key);assert.equal(targetRows.length,2);assert.ok(targetRows.every(r=>r.engineCode==='K7M'&&Number(r.hp)===83&&r.model==='Logan II'));
const rawRows=(await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
const findings=[];
for(const id of ['mtar_246f0ac48e2695e9de56df7c','mtar_6788ba1dba394fc0d65c6414']){
 const donor=plan.newRevisions.find(r=>r.id===id);assert.ok(donor);const source=sources.get(donor.sourceRequirementId);assert.ok(source);
 const own=rawRows.find(r=>r.row_id===source.sourceRowId);assert.ok(own);
 const anchors=rawRows.filter(r=>r.source_url===own.source_url&&r.table_index===own.table_index&&r.system_name.startsWith('МАСЛО в ДВИГАТЕЛЬ'));
 assert.equal(anchors.length,1);assert.ok(anchors[0].application.includes('- K7M (8 клапанов)'));assert.equal(anchors[0].power,'');assert.ok(source.engineCodesJson.includes('K7M'));
 assert.equal(source.powerHp,null);assert.equal(source.powerKw,null);
 const window=applicabilityWindow(source,targetRows[0]);assert.ok(window.intersection.from&&window.intersection.to);
 const narrowed={...source,engineCodeNormalized:'K7M',engineCodesJson:['K7M'],yearFrom:Number(window.intersection.from.slice(0,4)),yearTo:Number(window.intersection.to.slice(0,4))};
 const periods=partition?[[2013,2014],[2015,2022]]:[[narrowed.yearFrom,narrowed.yearTo]];
 for(const [yearFrom,yearTo] of periods){
  assert.ok(yearFrom>=narrowed.yearFrom&&yearTo<=narrowed.yearTo);
  const decision=match({...narrowed,yearFrom,yearTo},rows.filter(r=>r.make==='RENAULT'));
  const target=decision.targets.find(t=>t.vehicleVariantKey===key&&t.independentlyValidated);
  const scopedWindow={...window,narrowedYears:{yearFrom,yearTo},restricted:true,intersection:{from:[window.intersection.from,`${yearFrom}-01`].sort().at(-1),to:[window.intersection.to,`${yearTo}-12`].sort()[0]}};
  findings.push({sourceRequirementId:source.id,donorRevisionId:id,donorHash:sha(donor),originalSourceHash:sha(source),sourceAnchorHash:sha(anchors[0]),sourceAnchor:anchors[0].application,ownApplication:own.application,vehicleVariantKey:key,window:scopedWindow,sourcePowerRetained:null,decision,target:target??null});
 }
}
const files=['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-reviewed-model-scope.ts','data/mann-partner-tepee-model-evidence-v1.json','src/lib/mann-vehicle-resolver.ts','src/lib/vehicle-normalization.ts','src/lib/mann-catalog.ts'];
const runtimeHashes=Object.fromEntries(await Promise.all(files.map(async file=>[file,sha(await readFile(resolve(root,file),'utf8'))])));
if(partition)for(const group of Map.groupBy(findings,f=>f.sourceRequirementId).values()){
 assert.equal(group.length,2);assert.equal(group[0].window.intersection.from,'2013-05');assert.equal(group[0].window.intersection.to,'2014-12');assert.equal(group[1].window.intersection.from,'2015-01');assert.equal(group[1].window.intersection.to,'2022-12');assert.ok(group.every(f=>f.target?.independentlyValidated));
}
await writeFile(resolve(dir,`logan-source-coverage-rematch-${version}.json`),JSON.stringify({kind:'LOGAN_K7M_KNOWN_SOURCE_COVERAGE_REMATCH',planHash:sha(planRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),runtimeHashes,findings,productionApplyAllowed:false,limitations:['No source horsepower invented; explicit K7M membership retained from its original table.','Existing sibling draft is not proof of this target; each source independently rematched against all Renault rows.','Not a new draft or publication; own-fluid conditions, predecessors and joint profile still require verification.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(findings.map(f=>({source:f.sourceRequirementId,validated:!!f.target,status:f.decision.status,reasons:f.decision.reviewReasons,top:f.decision.topCandidates.slice(0,2).map(c=>({keys:c.variantIds,blockers:c.reviewBlockers,conflicts:c.hardConflicts}))}))));
