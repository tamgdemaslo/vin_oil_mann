import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createJiti} from 'jiti';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const baselineMode=process.argv[2]==='--capture-before',dir='outputs/mann-live-audit-1789469257907';
const raw=readFileSync('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(raw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');const rows=parseCopy(raw,'mann_filter_applications');
const j=createJiti(import.meta.url,{alias:{'@':resolve('src')}}),{rowBodyCodes}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const current=rows.map(r=>({id:r.id,codes:rowBodyCodes(r)}));
if(baselineMode){writeFileSync(`${dir}/kodiaq-ns-before.json`,JSON.stringify({sourceHash:sha(raw),rows:current})+'\n',{flag:'wx'});console.log('Captured pre-change chassis extraction for '+rows.length+' rows');}
else{
 const before=JSON.parse(readFileSync(`${dir}/kodiaq-ns-before.json`,'utf8'));assert.equal(before.sourceHash,sha(raw));assert.equal(before.rows.length,current.length);const changed=[];
 for(let i=0;i<rows.length;i++){assert.equal(current[i].id,before.rows[i].id);if(sha(current[i].codes)===sha(before.rows[i].codes))continue;const r=rows[i];assert.equal(r.make,'SKODA');assert.equal(r.model,'Kodiaq');assert.match(r.vehicleText,/^(?:1\.[45]TSI|2\.0(?:RS)?TDI|2\.0TSI)\(NS\)$/);assert.deepEqual(current[i].codes,[...new Set([...before.rows[i].codes,'NS'])]);changed.push({id:r.id,key:r.vehicleVariantKey,text:r.vehicleText,before:before.rows[i].codes,after:current[i].codes});}
 assert.ok(changed.length>0);
 const base=rows.find(r=>r.model==='Kodiaq'&&r.vehicleText==='1.4TSI(NS)');
 for(const vehicleText of ['1.4TSI(DSG)','1.4TSI(NS) gearbox','1.4TSI(NV)','2.0RS(NS,NV)','All models','Automatikgetriebe/Automaticgearbox(2)'])assert.equal(rowBodyCodes({...base,vehicleText,effectiveVehicleText:vehicleText}).includes('NS'),false,vehicleText);
 assert.equal(rowBodyCodes({...base,model:'Other',effectiveVehicleText:base.vehicleText}).includes('NS'),false);
 const output=`${dir}/kodiaq-ns-extraction-proof-${Date.now()}.json`;writeFileSync(output,JSON.stringify({sourceHash:sha(raw),rows:rows.length,changedRows:changed.length,changed,allOtherRowsUnchanged:true,productionChanged:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,rows:rows.length,changedRows:changed.length}));
}
