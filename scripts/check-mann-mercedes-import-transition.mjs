import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),mode=process.argv[2];
assert.ok(['baseline','verify'].includes(mode));
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{prepareFluidCatalog}=await j.import('../src/lib/fluid-catalog.ts');
const prepared=prepareFluidCatalog({rowsNdjson:raw,mannFiltersCsv:''});
const parserHash=sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8'));
if(mode==='baseline'){
 await writeFile(resolve(dir,'mercedes-import-parser-baseline-v1.json'),JSON.stringify({rawHash:sha(raw),parserHash,requirements:prepared.requirements},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({requirements:prepared.requirements.length,parserHash}));
}else{
 const baselineRaw=await readFile(resolve(dir,'mercedes-import-parser-baseline-v1.json'),'utf8'),baseline=JSON.parse(baselineRaw);assert.equal(baseline.rawHash,sha(raw));assert.equal(prepared.requirements.length,baseline.requirements.length);
 const differences=[];
 for(let i=0;i<prepared.requirements.length;i++){
  const before=baseline.requirements[i],after=prepared.requirements[i];if(sha(before)===sha(after))continue;
  const fields=Object.keys({...before,...after}).filter(k=>sha(before[k]??null)!==sha(after[k]??null));
  assert.ok(fields.every(f=>['engineCodesJson','engineCodeNormalized'].includes(f)),JSON.stringify({id:before.id,fields}));
  assert.equal(after.make,'mercedes');
  for(const code of before.engineCodesJson)assert.ok(after.engineCodesJson.includes(code),'Existing engine removed');
  const added=after.engineCodesJson.filter(c=>!before.engineCodesJson.includes(c));assert.ok(added.length);assert.ok(added.every(c=>/^(OM|M)\d{3}\.\d{3}$/.test(c)));
  differences.push({id:after.id,sourceRowId:after.sourceRowId,systemCode:after.systemCode,fields,before:before.engineCodesJson,after:after.engineCodesJson,added});
 }
 assert.ok(differences.length);
 const report={kind:'MERCEDES_EXPLICIT_PREFIX_IMPORT_TRANSITION',rawHash:sha(raw),beforeParserHash:baseline.parserHash,afterParserHash:parserHash,baselineHash:sha(baselineRaw),summary:{requirements:prepared.requirements.length,changed:differences.length,unchanged:prepared.requirements.length-differences.length},differences,productionApplyAllowed:false,limitations:['Full raw archive reparse without MANN matching; no database import or canonical revision refresh.','Only engine code fields may change; exact source-prefix recovery, not automatic applicability approval.']};
 await writeFile(resolve(dir,'mercedes-import-parser-transition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
}
