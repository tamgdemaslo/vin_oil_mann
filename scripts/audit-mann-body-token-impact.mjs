import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-passat-inclusive-preview-2026-09-14');
const raw=await readFile('/tmp/mann_filter_applications.sql','utf8'),rows=parseCopy(raw,'mann_filter_applications');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeDecodedVehicleForTest:normalize}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const previous=/\b(?:[A-Z]{1,3}\d{1,3}[A-Z]{0,3}|\d[A-Z]{1,3}\d{0,2})\b/g;
const allowed=code=>!/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/.test(code)&&!/^\d+GEN$/.test(code)
  &&!/^V(?:6|8|10|12)$/.test(code)&&!/^(?:GLK|GL|GLE|GLS|ML)\d{2,3}$/.test(code)
  &&!/^\d{3}[DIE]$/.test(code)&&!/^\d+(?:V|XDI|TDI|TFSI|TSI|FSI|DCI|CDI|HDI|CRDI|GDI|MPI|VVT|CVVT|D|I)/.test(code);
const changes=[];
for(const row of rows){
  const value=`${row.model} ${row.vehicleText??''} ${row.effectiveVehicleText??''}`.toUpperCase();
  const before=[...new Set((value.match(previous)??[]).filter(allowed))].sort();
  const current=normalize({makeRaw:'volkswagen',modelRaw:'passat',bodyCode:value});assert.ok(current);
  const after=[...current.bodyCodes].sort();
  const removed=before.filter(c=>!after.includes(c)),added=after.filter(c=>!before.includes(c));
  assert.equal(added.length,0,'Hardening must not introduce new tokens');
  if(removed.length)changes.push({rowId:row.id,rowHash:sha(row),make:row.make,model:row.model,vehicleText:row.vehicleText,removed});
}
const removed=changes.flatMap(r=>r.removed);
const report={kind:'CATALOGUE_BODY_TOKEN_HARDENING_IMPACT',mannHash:sha(raw),resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),
  productionApplyAllowed:false,summary:{rows:rows.length,changedRows:changes.length,removedTokens:Object.fromEntries([...Map.groupBy(removed,x=>x)].map(([k,v])=>[k,v.length]))},
  limitation:'Extraction comparison against immediately preceding digit-leading parser, not fresh full-match ranking or fluid/OEM applicability verification.',changes};
await writeFile(resolve(dir,'body-token-hardening-impact-v3.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
