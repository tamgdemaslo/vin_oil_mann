import assert from 'node:assert/strict';
// Offline SQL draft only. Caller must supply an INSERT RETURNING journal, not
// all rows belonging to a run. This function never opens a database connection.
export function insertedBatchRollback(journal) {
 assert.equal(journal.kind,'INSERTED_ROWS_ONLY');
 const specs=[['revisions','mann_technical_association_revisions','id'],['runs','mann_technical_materialization_runs','id'],['vehicles','mann_vehicle_variants','variant_key']];
 const quote=v=>`'${String(v).replaceAll("'","''")}'`;
 const parts=[];
 for(const [key,table,id] of specs){
  const rows=journal[key];assert.ok(Array.isArray(rows));assert.equal(new Set(rows.map(r=>r[id])).size,rows.length);
  for(const r of rows)assert.ok(typeof r[id]==='string'&&r[id].length>0);
  parts.push({table,id,rows,ids:rows.map(r=>quote(r[id])).join(',')||'NULL'});
 }
 const rev=parts[0];
 return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE mann_vehicle_variants, mann_technical_materialization_runs, mann_technical_association_revisions, mann_technical_review_decisions IN SHARE ROW EXCLUSIVE MODE;
DO $rollback$
BEGIN
IF EXISTS(SELECT 1 FROM mann_technical_review_decisions WHERE revision_id IN (${rev.ids})) THEN
 RAISE EXCEPTION 'batch rollback refused: review decisions exist';
END IF;
${parts.map(p=>`IF EXISTS(SELECT 1 FROM ${p.table} actual JOIN jsonb_array_elements(${quote(JSON.stringify(p.rows))}::jsonb) expected ON actual.${p.id}=expected->>${quote(p.id)} WHERE to_jsonb(actual) IS DISTINCT FROM expected) THEN
 RAISE EXCEPTION 'batch rollback refused: ${p.table} changed';
END IF;`).join('\n')}
END $rollback$;
${parts.map(p=>`DELETE FROM ${p.table} WHERE ${p.id} IN (${p.ids});`).join('\n')}
COMMIT;`;
}
