import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
if(process.argv[2]==='baseline'){
const baselineRaw=await readFile(resolve(dir,'capacity-summary-after-v1.json'),'utf8');assert.equal(sha(baselineRaw),'db5a76c06410bebd795ce8c9b4d23c116a8efebb8dd8ba2820cc1f3b7114660b');
const baseline=JSON.parse(baselineRaw);assert.equal(baseline.parserHash,'4f9abf60a140b3ed5cb5b1b034190d86a2f39c3de3cb80e3f517adb881cdb233');
const compact={parserHash:baseline.parserHash,snapshotHash:baseline.snapshotHash,preparedHash:sha(baseline.prepared),requirements:baseline.prepared.requirements.map(r=>({id:r.id,powerHp:r.powerHp,powerKw:r.powerKw,rowHash:sha(r)}))};
await writeFile(resolve(dir,'table-power-before-hashes-v1.json'),JSON.stringify(compact)+'\n',{flag:'wx'});console.log('Baseline hashes saved');process.exit(0);
}
const baseline=JSON.parse(await readFile(resolve(dir,'table-power-before-hashes-v1.json'),'utf8'));
assert.equal(baseline.preparedHash,'61daaaa182cf15d0de21343c3738c79d89d8109ac31cc5f11b0a96363fc64751');
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),baseline.snapshotHash);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{prepareFluidCatalog}=await j.import('../src/lib/fluid-catalog.ts');
const prepared=prepareFluidCatalog({rowsNdjson:raw,mannFiltersCsv:''});assert.equal(prepared.requirements.length,13296);
const previous=new Map(baseline.requirements.map(r=>[r.id,r])),changes=[];
for(const r of prepared.requirements){const old=previous.get(r.id);assert.ok(old);const fields=['powerHp','powerKw'].filter(f=>r[f]!==old[f]);if(!fields.length){assert.equal(sha(r),old.rowHash);continue;}
 for(const f of fields){assert.equal(r[f],null);assert.notEqual(old[f],null);}
 assert.equal(r.contextConfidence,'table_engine');
 const before=Object.fromEntries(fields.map(f=>[f,old[f]])),after=Object.fromEntries(fields.map(f=>[f,r[f]]));assert.equal(sha({...r,...before}),old.rowHash);
 changes.push({id:r.id,before,after});
}
const afterPreparedHash=sha(prepared),restored={...prepared,requirements:prepared.requirements.map(r=>{const c=changes.find(c=>c.id===r.id);return c?{...r,...c.before}:r;})};
assert.equal(sha(restored),baseline.preparedHash);assert.equal(changes.length,274);
const report={kind:'TABLE_POWER_ONLY_REPARSE_TRANSITION',snapshotHash:sha(raw),beforeParserHash:baseline.parserHash,afterParserHash:sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8')),beforePreparedHash:baseline.preparedHash,afterPreparedHash,checked:13296,changed:changes.length,changes,productionApplyAllowed:false};
await writeFile(resolve(dir,'table-power-reparse-transition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,changes:undefined}));
