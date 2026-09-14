import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),archive=resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);assert.equal(sha(planRaw),'31f8407dde303ca792f858299a5c40282a4079d65b9e8a9a8e020941e8411c5c');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),plan.inputHashes.source);
const jsonldRaw=await readFile(resolve(archive,'podbormasla_jsonld.ndjson'),'utf8'),rowsRaw=await readFile(resolve(archive,'podbormasla_rows.ndjson'),'utf8');assert.equal(sha(rowsRaw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const pages=jsonldRaw.trim().split('\n').map(JSON.parse),sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),rawRows=new Map(rowsRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
assert.equal(new Set(pages.map(p=>p.source_url)).size,pages.length);
const configs=[],byPage=new Map();
function literalEngineCodes(value){
 if(typeof value!=='string'||!/^[A-Z0-9-]+(?:\s*[,/]\s*[A-Z0-9-]+)*$/.test(value))return null;
 const codes=value.split(/\s*[,/]\s*/);return codes.every(c=>/[A-Z]/.test(c)&&/\d/.test(c))?[...new Set(codes)]:null;
}
function walk(node,page,path){
 if(!node||typeof node!=='object')return;
 if(Object.hasOwn(node,'vehicleConfiguration')){
  const config=node.vehicleConfiguration,body=typeof config==='string'?config.match(/кузов\s+([^,]+)/iu)?.[1]??null:config?.bodyType??null;
  const powerText=typeof node.vehicleEngine?.enginePower==='string'?node.vehicleEngine.enginePower:typeof config==='string'?config:'';
  const powerMatches=[...powerText.matchAll(/(\d+(?:[.,]\d+)?)\s*л\.с\./g)],powerHp=powerMatches.length===1?Number(powerMatches[0][1].replace(',','.')):null;
  const identity={name:node.name??null,model:node.model??null,vehicleEngine:node.vehicleEngine??null,vehicleConfiguration:config,productionDate:node.productionDate??null,fuelType:node.fuelType??null,additionalProperty:node.additionalProperty??null};
  const finding={id:sha({url:page.source_url,path}),sourceUrl:page.source_url,pageHash:page.page_sha256,jsonPath:path,nodeHash:sha(node),identity,bodyLiteral:body,engineCodes:literalEngineCodes(node.model),powerHp,publicationAllowed:false};
  configs.push(finding);const list=byPage.get(page.source_url)??[];list.push(finding);byPage.set(page.source_url,list);
 }
 for(const[key,value]of Object.entries(node))if(value&&typeof value==='object')walk(value,page,`${path}.${key}`);
}
for(const page of pages)walk(page.documents,page,'documents');
const findings=[],statusCounts={};
for(const s of sources){
 const candidates=byPage.get(s.sourceUrl)??[];
 if(!candidates.length){statusCounts.NO_ARCHIVED_VEHICLE_CONFIGURATION=(statusCounts.NO_ARCHIVED_VEHICLE_CONFIGURATION??0)+1;continue;}
 const raw=rawRows.get(s.sourceRowId);assert.ok(raw);assert.equal(raw.source_url,s.sourceUrl);
 const sameHash=candidates.filter(c=>c.pageHash===raw.page_sha256),codes=s.engineCodesJson??[];
 const exact=codes.length?sameHash.filter(c=>c.engineCodes&&codes.every(code=>c.engineCodes.includes(code))):[];
 const exactPower=exact.filter(c=>s.powerHp!=null&&c.powerHp===s.powerHp);
 const status=!sameHash.length?'PAGE_HASH_MISMATCH':!exact.length?'NO_WHOLE_SOURCE_EXACT_ENGINE_CONFIGURATION':exactPower.length===1?'UNIQUE_EXACT_ENGINE_AND_POWER_CONFIGURATION':exactPower.length>1?'MULTIPLE_EXACT_ENGINE_AND_POWER_CONFIGURATIONS':'SOURCE_OR_CONFIGURATION_POWER_MISSING_OR_DIFFERENT';
 statusCounts[status]=(statusCounts[status]??0)+1;
 const unique=exactPower.length===1?exactPower[0]:null;
 findings.push({sourceRequirementId:s.id,sourceHash:sha(s),sourceUrl:s.sourceUrl,sourceRowId:s.sourceRowId,sourcePageHash:raw.page_sha256,make:s.make,model:s.model,systemCode:s.systemCode,sourceEngineCodes:codes,sourcePowerHp:s.powerHp,sourceBodyCodes:s.bodyCodesJson,sourceDriveType:s.driveType,status,pageConfigurationIds:candidates.map(c=>c.id),exactEngineConfigurationIds:exact.map(c=>c.id),exactEnginePowerConfigurationIds:exactPower.map(c=>c.id),uniqueConfigurationId:unique?.id??null,missingImportedBodyWithExplicitConfiguration:Boolean(unique?.bodyLiteral&&!(s.bodyCodesJson??[]).length),existingCandidateRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===s.id).map(r=>r.id),publicationAllowed:false});
}
assert.equal(Object.values(statusCounts).reduce((a,b)=>a+b,0),13296);assert.equal(new Set(findings.map(f=>f.sourceRequirementId)).size,findings.length);
const bodyCandidates=findings.filter(f=>f.missingImportedBodyWithExplicitConfiguration),gentra=findings.filter(f=>f.sourceUrl==='https://podbormasla.ru/daewoo/gentra/2gen/');assert.equal(gentra.length,8);
assert.ok(gentra.every(f=>f.status==='UNIQUE_EXACT_ENGINE_AND_POWER_CONFIGURATION'&&f.missingImportedBodyWithExplicitConfiguration));
const gentraConfig=configs.find(c=>c.id===gentra[0].uniqueConfigurationId);assert.equal(gentraConfig.bodyLiteral,'KLAS (2WD)');
const report={kind:'ARCHIVED_JSONLD_IDENTITY_INVENTORY_NOT_APPROVAL',planHash:sha(planRaw),sourceHash:sha(sourceRaw),archiveRowsHash:sha(rowsRaw),jsonldHash:sha(jsonldRaw),pagesScanned:pages.length,configurations:configs.length,configurationPages:byPage.size,checkedSourceRows:sources.length,statusCounts,explicitBodyConfigurations:configs.filter(c=>c.bodyLiteral).length,missingImportedBodyUniqueEnginePowerSources:bodyCandidates.length,affectedExistingCandidateSources:bodyCandidates.filter(f=>f.existingCandidateRevisionIds.length).length,byMake:Object.fromEntries([...Map.groupBy(bodyCandidates,f=>f.make)].map(([k,v])=>[k,v.length])),configurationEvidence:configs,findings,productionApplyAllowed:false,limitation:'Same archived page and literal engine/power linkage only. JSON-LD may conflict with table data; body/generation/drive/date/market must be reconciled per engine branch before any correction. Engine lists are required to cover every source code. No aliases, fuzzy model match, source overwrites or publication.'};
await writeFile(resolve(dir,'archived-vehicle-configurations-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,configurationEvidence:undefined,findings:undefined}));
