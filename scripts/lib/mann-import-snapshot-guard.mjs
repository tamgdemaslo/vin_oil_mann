import assert from 'node:assert/strict';

const tables=['mann_vehicle_variants','mann_technical_materialization_runs','mann_technical_association_revisions','mann_technical_review_decisions'];
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
// Read-only SQL; a single statement obtains a consistent MVCC snapshot.
export const captureImportSnapshotSql=`SELECT jsonb_build_object(
 'databaseName',current_database(), 'capturedAt',CURRENT_TIMESTAMP,
 'tables',jsonb_build_object(${tables.map(table=>`${quote(table)},(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM ${table} r)`).join(',')})
);`;

// Offline SQL only. Lock + exact full-row comparison closes the gap between
// review and write. It is NOT provider verification, authorization or a backup.
export function importSnapshotGuard(snapshot) {
 assert.ok(snapshot && typeof snapshot.databaseName==='string' && snapshot.databaseName.length>0);
 assert.ok(Number.isFinite(Date.parse(snapshot.capturedAt)));
 assert.deepEqual(Object.keys(snapshot.tables).sort(),[...tables].sort());
 for(const table of tables){
  assert.ok(Array.isArray(snapshot.tables[table]));
  const id=table==='mann_vehicle_variants'?'variant_key':'id';
  assert.ok(snapshot.tables[table].every(row=>typeof row[id]==='string' && row[id].length>0));
  assert.equal(new Set(snapshot.tables[table].map(row=>row[id])).size,snapshot.tables[table].length);
 }
 return `LOCK TABLE ${tables.join(',')} IN SHARE ROW EXCLUSIVE MODE;
DO $snapshot$
BEGIN
 IF current_database() IS DISTINCT FROM ${quote(snapshot.databaseName)} THEN
 RAISE EXCEPTION 'import snapshot database mismatch'; END IF;
${tables.map(table=>`IF (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM ${table} r)
 IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM jsonb_populate_recordset(NULL::${table},${quote(JSON.stringify(snapshot.tables[table]))}::jsonb) r) THEN
 RAISE EXCEPTION 'import snapshot drift: ${table}'; END IF;`).join('\n')}
END $snapshot$;`;
}
