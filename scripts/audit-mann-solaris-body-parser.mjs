import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
assert.ok(['before','after'].includes(process.argv[2]));
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-transmission-chassis-held-preview-2026-09-14'),raw=await readFile('/tmp/mann_filter_applications.sql','utf8'),rows=parseCopy(raw,'mann_filter_applications');
const {rowBodyCodes}=await createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}).import('../src/lib/mann-vehicle-resolver.ts');
const values=rows.map(r=>({id:r.id,codes:rowBodyCodes(r)})),report={mannHash:sha(raw),resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),values};
if(process.argv[2]==='after'){
 const old=JSON.parse(await readFile(resolve(dir,'solaris-body-parser-before-v1.json'),'utf8'));assert.equal(old.mannHash,report.mannHash);
 const changed=rows.flatMap((r,i)=>{assert.equal(old.values[i].id,r.id);if(sha(old.values[i].codes)===sha(values[i].codes))return[];assert.equal(r.make,'HYUNDAI');assert.equal(r.model,'Solaris');assert.deepEqual(old.values[i].codes,[]);assert.deepEqual(values[i].codes,['RB']);return[{row:r,before:old.values[i].codes,after:values[i].codes}];});
 report.changes=changed;report.summary={catalogRows:rows.length,changedRows:changed.length,changedVariants:new Set(changed.map(c=>c.row.vehicleVariantKey)).size};delete report.values;
}
await writeFile(resolve(dir,`solaris-body-parser-${process.argv[2]}-v1.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary??{rows:values.length,resolverHash:report.resolverHash}));
