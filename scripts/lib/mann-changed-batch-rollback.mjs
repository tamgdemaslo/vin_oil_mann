import assert from 'node:assert/strict';
import { insertedBatchRollback } from './mann-inserted-batch-rollback.mjs';

// Offline builder. Receipt must be recovered from the target DB, never inferred
// from planned rows. A changed/reviewed/missing row rejects the whole rollback.
export function changedBatchRollback(receipt) {
  const journal = receipt.journal_json;
  assert.equal(journal.kind, 'INSERTED_ROWS_WITH_REVISION_CHANGES');
  assert.equal(journal.planSha256, receipt.plan_sha256);
  assert.ok(typeof receipt.database_name === 'string' && receipt.database_name.length > 0);
  assert.ok(typeof receipt.batch_id === 'string' && receipt.batch_id.length > 0);
  const changes = journal.revisionChanges;
  assert.ok(Array.isArray(changes) && changes.length > 0);
  assert.equal(new Set(changes.map(row => row.id)).size, changes.length);
  const newRows = new Map(journal.revisions.map(row => [row.id, row]));
  for (const row of changes) {
    assert.equal(row.id, row.before_image.id);
    assert.equal(row.id, row.after_image.id);
    // Current supersessions only change these fields, never technical content.
    const unchanged = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['state','supersedes_revision_id'].includes(key)));
    assert.deepEqual(unchanged(row.before_image), unchanged(row.after_image));
    if (newRows.has(row.id)) assert.deepEqual(newRows.get(row.id), row.after_image);
  }
  const oldChanges = changes.filter(row => !newRows.has(row.id));
  assert.ok(oldChanges.length > 0);
  const q = value => `'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
  const s = value => `'${value.replaceAll("'","''")}'`;
  const insertionRollback = insertedBatchRollback({...journal, kind:'INSERTED_ROWS_ONLY'});
  assert.ok(insertionRollback.startsWith('BEGIN;'));
  // Old rows can be restored before removing inserted successors because their
  // IDs remain unchanged; any later deletion failure rolls the restore back too.
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
LOCK TABLE mann_vehicle_variants,mann_technical_materialization_runs,mann_technical_association_revisions,mann_technical_review_decisions,mann_technical_import_receipts IN SHARE ROW EXCLUSIVE MODE;
DO $restore$
BEGIN
 IF current_database() IS DISTINCT FROM ${s(receipt.database_name)} OR NOT EXISTS (
 SELECT 1 FROM mann_technical_import_receipts WHERE batch_id=${s(receipt.batch_id)} AND to_jsonb(mann_technical_import_receipts)=${q(receipt)}
 ) THEN RAISE EXCEPTION 'rollback receipt identity mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(${q(changes)}) j LEFT JOIN mann_technical_association_revisions r ON r.id=j->>'id' WHERE to_jsonb(r) IS DISTINCT FROM j->'after_image') THEN
 RAISE EXCEPTION 'revision restoration refused: row changed or missing'; END IF;
 IF EXISTS (SELECT 1 FROM mann_technical_review_decisions WHERE revision_id IN (SELECT j->>'id' FROM jsonb_array_elements(${q(changes)}) j)) THEN
 RAISE EXCEPTION 'revision restoration refused: review decisions exist'; END IF;
END $restore$;
UPDATE mann_technical_association_revisions r SET state=j->'before_image'->>'state',supersedes_revision_id=j->'before_image'->>'supersedes_revision_id'
FROM jsonb_array_elements(${q(oldChanges)}) j WHERE r.id=j->>'id';
${insertionRollback.slice('BEGIN;'.length)}`;
}
