// Test-only imports. No real database or authentication connection.
import assert from 'node:assert/strict';
const state=()=>globalThis[Symbol.for('mann-profile-db-route-test')];
export async function requireBranchApi(){assert.ok(state());return {ok:true,context:{test:true}};}
export async function runWithBranchApiContext(context,fn){assert.equal(context.test,true);return fn();}
function project(row,select){return Object.fromEntries(Object.entries(select).map(([key,value])=>[key,value===true?row[key]:Array.isArray(row[key])?row[key].slice(0,value.take??Infinity).map(r=>project(r,value.select)):project(row[key],value.select)]));}
export const prisma={mannTechnicalAssociationRevision:{async findMany(query){
 const s=state();assert.ok(s);s.calls++;
 assert.deepEqual(query.where.verificationStatus.in,['PRIMARY_SOURCE_VERIFIED_FIELDS','UNVERIFIED']);
 assert.deepEqual(query.where.state.in,['ACTIVE','STAGED','REVIEW']);
 return s.rows.filter(r=>query.where.vehicleVariantKey.in.includes(r.vehicleVariantKey)&&query.where.verificationStatus.in.includes(r.verificationStatus)&&query.where.state.in.includes(r.state)).slice(0,query.take).map(r=>project(r,query.select));
}}};
