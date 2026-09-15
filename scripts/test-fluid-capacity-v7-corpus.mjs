import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const baseline=execFileSync('git',['show','797a17eaf5ae7087f1144067b3c6542b12ea454d:src/lib/fluid-capacity-parser.ts'],{encoding:'utf8'});
assert.ok(baseline.includes('capacity-parser-v5'));
const js=ts.transpileModule(baseline,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const old=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const j=createJiti(import.meta.url,{alias:{'@':resolve('src')}}),now=await j.import('../src/lib/fluid-capacity-parser.ts');
const catalog=await j.import('../src/lib/fluid-catalog.ts');
const raw=readFileSync('/tmp/vehicle_fluid_requirements.sql','utf8');
assert.equal(sha(raw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const rows=parseCopy(raw,'vehicle_fluid_requirements'),changed=[];
const quantities=p=>p.capacities.map(({kind,serviceContext,confidence,...rest})=>rest);
for(const r of rows){
 const a=old.parseFluidCapacities(r.fillVolumeText,r.systemCode),b=now.parseFluidCapacities(r.fillVolumeText,r.systemCode);
 assert.deepEqual(quantities(b),quantities(a),r.id+' quantity changed');
 if(sha(a.capacities)!==sha(b.capacities)){
  assert.match(r.fillVolumeText,/полн[а-яё]*\s+(?:аппаратн[а-яё]*\s+)?замен[а-яё]*/iu);
  changed.push({id:r.id,model:r.model,text:r.fillVolumeText,before:a,after:b});
 }
}
const caps=catalog.parseCapacities('5.0 л. для частичной замены 6.9 л. для полной замены');
assert.deepEqual(caps.map(c=>c.kind),['partial','full_replacement']);
assert.equal(catalog.capacitySummary(caps).total,null);
const output=`outputs/mann-live-audit-1789479529769/capacity-v7-corpus-proof-${Date.now()}.json`;
writeFileSync(output,JSON.stringify({rows:rows.length,changedRows:changed.length,numericValuesUnchanged:true,baselineHash:sha(baseline),productionChanged:false,changed},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,rows:rows.length,changedRows:changed.length,numericValuesUnchanged:true}));
