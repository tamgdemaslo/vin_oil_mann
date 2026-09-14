import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {narrowFluidEngineContext:narrow}=await jiti.import('../src/lib/fluid-engine-context-branch.ts');
const source={id:'coolant',sourceRowId:'fluid',sourceUrl:'source',systemCode:'ENGINE_COOLANT',engineCodesJson:['CAPA','CLAA'],
  yearFrom:2007,yearTo:2016,engineVolumeCc:3000,powerHp:null,powerKw:null,fuelType:null,
  fillVolumeText:'11.5 л.',specificationsJson:[{type:'TEST',value:'unchanged'}]};
const anchor={sourceRowId:'engine',sourceUrl:'source',systemCode:'ENGINE_OIL',contextConfidence:'row_engine',engineCodesJson:['CAPA'],
  yearFrom:2007,yearTo:2008,engineVolumeCc:3000,powerHp:240,powerKw:176,fuelType:'diesel'};
const row={row_id:'fluid',source_url:'source',table_index:47},anchorRow={...row,row_id:'engine'};
const frozen=JSON.stringify({source,anchor});
const result=narrow(source,row,anchor,anchorRow,'CAPA');assert.deepEqual(result.reasons,[]);
assert.equal(result.requirement.yearTo,2008);assert.equal(result.requirement.powerHp,240);assert.equal(result.requirement.fuelType,'diesel');
for(const field of ['id','fillVolumeText','specificationsJson','systemCode'])assert.deepEqual(result.requirement[field],source[field]);
assert.equal(JSON.stringify({source,anchor}),frozen,'Inputs mutated');
for(const patch of [{yearFrom:2017},{yearTo:2006},{yearFrom:'2007'},{engineVolumeCc:2000},{powerHp:-1},{engineCodesJson:['OTHER']},{contextConfidence:'table_engine'},{systemCode:'BRAKE_FLUID'}])assert.equal(narrow(source,row,{...anchor,...patch},anchorRow,'CAPA').requirement,null);
for(const patch of [{table_index:48},{source_url:'other'},{row_id:'wrong'}])assert.equal(narrow(source,row,anchor,{...anchorRow,...patch},'CAPA').requirement,null);
assert.equal(narrow({...source,powerHp:200},row,anchor,anchorRow,'CAPA').requirement,null);
assert.equal(narrow({...source,systemCode:'ENGINE_OIL'},row,anchor,anchorRow,'CAPA').requirement,null);
assert.equal(narrow(source,row,anchor,anchorRow,'4WD').requirement,null);
assert.equal(narrow(source,row,{...anchor,yearFrom:2000,yearTo:2020},anchorRow,'CAPA').requirement.yearFrom,2007);
assert.equal(narrow(source,row,{...anchor,yearFrom:2000,yearTo:2020},anchorRow,'CAPA').requirement.yearTo,2016);
console.log('Engine context narrowing: exact lineage, intersected years, conflicting anchors rejected, technical fields unchanged');
