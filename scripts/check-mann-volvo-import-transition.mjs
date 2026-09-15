import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
import {volvoComponentEngineList as parse} from './lib/mann-volvo-component-engine-list.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),mode=process.argv[2];
assert.ok(['baseline','verify'].includes(mode));
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const rows=new Map(raw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{prepareFluidCatalog}=await j.import('../src/lib/fluid-catalog.ts');
const prepared=prepareFluidCatalog({rowsNdjson:raw,mannFiltersCsv:''});
const parserHash=sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8'));
if(mode==='baseline'){
 assert.equal(parserHash,'ffab595af8525552090c85c1df7af762fa3f5ce48466905827373dd7a1f1b7f1');
 await writeFile(resolve(dir,'volvo-import-parser-baseline-v1.json'),JSON.stringify({rawHash:sha(raw),parserHash,requirements:prepared.requirements},null,2)+'\n',{flag:'wx'});
 console.log('Saved baseline: '+prepared.requirements.length);
}else{
 const baselineRaw=await readFile(resolve(dir,'volvo-import-parser-baseline-v1.json'),'utf8'),baseline=JSON.parse(baselineRaw);
 assert.equal(baseline.rawHash,sha(raw));assert.equal(prepared.requirements.length,baseline.requirements.length);
 const {volvoComponentEngineList:runtimeParse}=await j.import('../src/lib/fluid-volvo-component-engine-list.ts');
 for(const row of rows.values())assert.deepEqual(runtimeParse(row.application),parse(row.application));
 const differences=[];let explicit=0,unparsed=0;
 for(let i=0;i<prepared.requirements.length;i++){
  const before=baseline.requirements[i],after=prepared.requirements[i],row=rows.get(after.sourceRowId),list=parse(row.application);
  if(row.brand_slug==='volvo'&&list.status==='EXPLICIT'){
   explicit++;assert.deepEqual(after.engineCodesJson,list.branches.map(b=>b.engineCode));
  }
  if(row.brand_slug==='volvo'&&list.status!=='EXPLICIT'&&/используется.*(?:двс|двигател)|автомобилях с/iu.test(row.application??'')){unparsed++;assert.deepEqual(after,before);}
  if(sha(before)===sha(after))continue;
  assert.equal(row.brand_slug,'volvo');assert.equal(list.status,'EXPLICIT');
  assert.deepEqual({...after,engineCodesJson:before.engineCodesJson,engineCodeNormalized:before.engineCodeNormalized},before);
  assert.equal(after.engineCodeNormalized,after.engineCodesJson[0]);
  const removed=before.engineCodesJson.filter(c=>!after.engineCodesJson.includes(c)),added=after.engineCodesJson.filter(c=>!before.engineCodesJson.includes(c));
  assert.deepEqual(added,[]);
  differences.push({id:after.id,sourceRowId:after.sourceRowId,before:before.engineCodesJson,after:after.engineCodesJson,removed,added});
 }
 assert.equal(explicit,65);assert.equal(unparsed,76);
 const summary={requirements:prepared.requirements.length,changed:differences.length,unchanged:prepared.requirements.length-differences.length,explicitLists:explicit,unparsedUnchanged:unparsed,removedAssociations:differences.reduce((n,d)=>n+d.removed.length,0)};
 const report={kind:'VOLVO_EXPLICIT_COMPONENT_ENGINE_IMPORT_TRANSITION',rawHash:sha(raw),baselineHash:sha(baselineRaw),beforeParserHash:baseline.parserHash,afterParserHash:parserHash,helperHash:sha(await readFile(resolve(root,'src/lib/fluid-volvo-component-engine-list.ts'),'utf8')),summary,differences,productionApplyAllowed:false,limitations:['Engine list restriction only; not proof of installed gearbox or automatic publication.','Original SQL, canonical revisions, all non-engine fields remain unchanged.']};
 await writeFile(resolve(dir,'volvo-import-parser-transition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}
