import assert from 'node:assert/strict';
const state=()=>{const value=globalThis[Symbol.for('mann-resolver-archive-test')];assert.ok(value);return value;};
export const prisma={
 vehicleModelAlias:{async findMany(){state().aliasCalls++;return [];}},
 vehicleMannMapping:{async findMany(){state().mappingCalls++;return [];}},
 mannFilterApplication:{async findMany(query){
  const s=state();s.catalogCalls++;
  assert.deepEqual(Object.keys(query.where),['makeNormalized']);
  const rows=s.rows.filter(r=>query.where.makeNormalized.in.includes(r.makeNormalized));
  assert.ok(rows.length<query.take,'Archive query would be truncated');
  return rows.slice(0,query.take).map(r=>Object.fromEntries(Object.entries(query.select).filter(([,v])=>v===true).map(([key])=>[key,r[key]])));
 }},
};
