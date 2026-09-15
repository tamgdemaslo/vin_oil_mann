-- Apply only in a separately approved Timeweb maintenance operation after a
-- verified backup. Application startup must never apply this migration.
-- No foreign keys: receipts must survive a rollback of their imported rows.
CREATE TABLE mann_technical_import_receipts (
 batch_id text PRIMARY KEY,
 plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
 authorization_ref text NOT NULL CHECK (length(btrim(authorization_ref)) >= 8),
 database_name text NOT NULL DEFAULT current_database(),
 journal_json jsonb NOT NULL CHECK ((
   journal_json->>'kind' IN ('INSERTED_ROWS_ONLY','INSERTED_ROWS_WITH_REVISION_CHANGES')
   AND (journal_json->>'kind' = 'INSERTED_ROWS_ONLY' OR jsonb_typeof(journal_json->'revisionChanges') = 'array')
   AND jsonb_typeof(journal_json->'vehicles') = 'array'
   AND jsonb_typeof(journal_json->'runs') = 'array'
   AND jsonb_typeof(journal_json->'revisions') = 'array'
   AND journal_json->>'planSha256' = plan_sha256
   AND journal_json ?& ARRAY['kind','vehicles','runs','revisions','planSha256']
 ) IS TRUE),
 committed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
