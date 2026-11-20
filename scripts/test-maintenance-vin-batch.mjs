import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { batchInputRows, batchSummary, isBatchNormalizedVehicle, parseBatchInput } from './lib/maintenance-vin-batch.mjs';
const vin='WDB2030451A000001';
assert.deepEqual(parseBatchInput(JSON.stringify({vin})+'\n'+JSON.stringify({vin})),[{vin},{vin}]);
assert.throws(()=>parseBatchInput('{broken}\n{}'),/Invalid JSONL record 1/);
assert.deepEqual(batchInputRows({results:[{providerTrace:{vin}},vin.toLowerCase(),'BAD']}),{rows:[{vin,vehicle:undefined}],rejected:[{index:1,reason:'DUPLICATE_VIN'},{index:2,reason:'INVALID_VIN'}]});
assert.equal(isBatchNormalizedVehicle({make:'Mercedes',model:'W203',engine:'M111'}),false,'Display labels are not normalized VIN identities');
assert.ok(isBatchNormalizedVehicle({vin,makeRaw:'MERCEDES-BENZ',modelRaw:'W203',confidence:'high',sourceMethods:['partsapi_vindecode'],rawResultIds:[]}));
assert.equal(batchSummary([{status:'ENRICHED',variantKeys:['a'],filters:[{}],research:[{status:'saved',items:[{}]}]}]).savedResearchItems,1);
const dir=await mkdtemp(join(tmpdir(),'maintenance-batch-test-'));
try{
 const input=join(dir,'input.json'),output=join(dir,'checkpoint.json');await writeFile(input,JSON.stringify([vin,vin,'bad']));
 const run=(...args)=>spawnSync(process.execPath,['scripts/backfill-maintenance-vins.mjs','--input',input,'--output',output,...args],{encoding:'utf8'});
 let result=run();assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(await readFile(output,'utf8'));assert.equal(report.config.mode,'inventory');assert.equal(report.results.length,1);assert.equal(report.rejected.length,2);
 assert.notEqual(run().status,0,'Existing checkpoint may not be overwritten without resume');
 result=run('--resume');assert.equal(result.status,0,result.stderr);
 assert.notEqual(run('--research').status,0,'Research must be explicitly executable');
 console.log('PASS input deduplication, invalid VIN rejection, no-network inventory, checkpoint collision protection and resume');
}finally{await rm(dir,{recursive:true,force:true});}
