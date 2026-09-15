import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {MANN_RESOLVER_ROW_SELECT:select}=await j.import('../src/lib/mann-resolver-row-select.ts');
const {mannRowGenerationEvidence:gen}=await j.import('../src/lib/mann-row-generation-evidence.ts');
const raw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(raw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const rows=parseCopy(raw,'mann_filter_applications');assert.equal(rows.length,37600);
let restored=0;
for(const row of rows){
 const projected=Object.fromEntries(Object.keys(select).map(k=>[k,row[k]]));
 assert.equal(gen(projected),gen(row));
 const {modelYears,...previousProjection}=projected;
 if(gen(previousProjection)!==gen(projected))restored++;
}
assert.ok(restored>0);
const source=await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8');
assert.match(source,/select: MANN_RESOLVER_ROW_SELECT/);
console.log(JSON.stringify({catalogRows:rows.length,generationEvidencePreserved:true,rowsLosingEvidenceWithoutModelPeriod:restored}));
