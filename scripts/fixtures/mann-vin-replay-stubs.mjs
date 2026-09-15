import assert from 'node:assert/strict';
import {prisma as catalogDb} from './mann-resolver-archive-stubs.mjs';
import {prisma as profileDb} from './mann-profile-db-route-stubs.mjs';
export {requireBranchApi,runWithBranchApiContext} from './mann-profile-db-route-stubs.mjs';
const state=()=>globalThis[Symbol.for('mann-vin-recorded-replay')];
async function replay(method,input){
  const s=state();assert.ok(s);assert.equal(input,s.vin,'Replay identifier differs');
  const attempt=s.trace.attempts.find(a=>a.method===method);
  if(!attempt){const error=new Error(`RECORDED_ATTEMPT_MISSING:${method}`);error.code='RECORDED_ATTEMPT_MISSING';throw error;}
  s.methods.push(method);
  return {...attempt,durationMs:0,providerRequestId:null};
}
export const tronkClient={
  decodeVinPrimary:vin=>replay('vindecode',vin),decodeVinExtended:vin=>replay('vindecode2',vin),
  lookupVinByPlate:()=>{throw new Error('Plate replay is outside this VIN-only test');},
  lookupVehicleByPlate:()=>{throw new Error('Plate replay is outside this VIN-only test');},
  lookupVehicleByPlateGate:()=>{throw new Error('Plate replay is outside this VIN-only test');},
  lookupVehicleByFrame:()=>{throw new Error('Frame replay is outside this VIN-only test');},
};
export const prisma={...catalogDb,...profileDb,vehicleLookupCache:{
  async findFirst(){return null;},
  async create(){state().discardedCacheWrites++;return null;},
  async updateMany(){throw new Error('Replay must not persist normalized vehicle');},
}};
