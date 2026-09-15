import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
const root=resolve(import.meta.dirname,'..'),j=createJiti(import.meta.url),{volvoSourceFuelCorrection:correct}=await j.import('../src/lib/fluid-volvo-source-fuel.ts');
const data=JSON.parse(await readFile(resolve(root,'src/lib/fluid-volvo-source-fuel-data.json'),'utf8'));
const rows=new Map((await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')).trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
let negative=0;
for(const c of data.corrections){
 const row=rows.get(c.sourceRowId),anchors=c.anchorIds.map(id=>rows.get(id));assert.ok(correct(c.id,row,anchors,'gasoline'));
 for(const [id,r,a,f] of [[c.id,row,anchors,'diesel'],['unknown',row,anchors,'gasoline'],[c.id,{...row,application:row.application+' extra'},anchors,'gasoline'],[c.id,row,[],'gasoline'],[c.id,row,anchors.map(a=>({...a,fuel_type:'changed'})),'gasoline']]){assert.equal(correct(id,r,a,f),null);negative++;}
 if(!anchors.some(a=>a.row_id===row.row_id)){assert.equal(correct(c.id,row,[...anchors,{...row,row_id:'extra-anchor'}],'gasoline'),null);negative++;}
}
console.log(JSON.stringify({positive:data.corrections.length,negative}));
