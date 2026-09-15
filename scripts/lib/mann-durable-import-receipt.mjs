import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Offline SQL building blocks. Schema installation is a separately approved
// maintenance operation, never part of application startup or an import.
export const durableReceiptSchemaDraft = readFileSync(new URL('../../prisma/migrations/20260915130000_mann_technical_import_receipts/migration.sql',import.meta.url),'utf8');

export function persistInsertedReceiptSql({ batchId, planHash, authorizationRef, receiptRelation }) {
  assert.match(batchId, /^[a-zA-Z0-9_-]{8,160}$/);
  assert.match(planHash, /^[a-f0-9]{64}$/);
  assert.ok(typeof authorizationRef === 'string' && authorizationRef.trim().length >= 8 && authorizationRef.length <= 500);
  assert.match(receiptRelation, /^_[a-z0-9_]+$/);
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  // LOCK also rejects accidental execution outside a transaction. Serialize
  // receipt claims so an existing batch can never acquire additional row owners.
  return `LOCK TABLE mann_technical_import_receipts IN SHARE ROW EXCLUSIVE MODE;
DO $receipt$
DECLARE incoming jsonb; previous mann_technical_import_receipts%ROWTYPE;
BEGIN
 IF (SELECT count(*) FROM ${receiptRelation}) <> 1 THEN
  RAISE EXCEPTION 'exactly one import receipt required';
 END IF;
 SELECT journal INTO incoming FROM ${receiptRelation};
 IF incoming IS NULL OR coalesce(incoming->>'kind','') NOT IN ('INSERTED_ROWS_ONLY','INSERTED_ROWS_WITH_REVISION_CHANGES')
    OR (incoming->>'kind' = 'INSERTED_ROWS_WITH_REVISION_CHANGES' AND jsonb_typeof(incoming->'revisionChanges') IS DISTINCT FROM 'array')
    OR incoming->>'planSha256' IS DISTINCT FROM ${quote(planHash)}
    OR jsonb_typeof(incoming->'vehicles') IS DISTINCT FROM 'array'
    OR jsonb_typeof(incoming->'runs') IS DISTINCT FROM 'array'
    OR jsonb_typeof(incoming->'revisions') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'invalid inserted-row receipt';
 END IF;
 SELECT * INTO previous FROM mann_technical_import_receipts WHERE batch_id=${quote(batchId)};
 IF FOUND THEN
  IF previous.plan_sha256 IS DISTINCT FROM ${quote(planHash)}
     OR previous.authorization_ref IS DISTINCT FROM ${quote(authorizationRef)}
     OR previous.database_name IS DISTINCT FROM current_database() THEN
   RAISE EXCEPTION 'receipt batch identity conflict';
  END IF;
  IF incoming IS DISTINCT FROM previous.journal_json
     AND (jsonb_array_length(incoming->'vehicles') + jsonb_array_length(incoming->'runs') + jsonb_array_length(incoming->'revisions') + CASE WHEN incoming->>'kind' = 'INSERTED_ROWS_WITH_REVISION_CHANGES' THEN jsonb_array_length(incoming->'revisionChanges') ELSE 0 END) <> 0 THEN
   RAISE EXCEPTION 'receipt batch ownership conflict: use a new authorized attempt';
  END IF;
 ELSE
  INSERT INTO mann_technical_import_receipts(batch_id,plan_sha256,authorization_ref,journal_json)
  VALUES (${quote(batchId)},${quote(planHash)},${quote(authorizationRef)},incoming);
 END IF;
END $receipt$;`;
}
