\set ON_ERROR_STOP on
\set QUIET 1
\pset tuples_only on
\pset format unaligned

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';

SELECT json_build_object(
  'type', 'snapshot',
  'checkedAt', clock_timestamp(),
  'database', current_database(),
  'serverVersion', current_setting('server_version'),
  'transactionReadOnly', current_setting('transaction_read_only'),
  'transactionIsolation', current_setting('transaction_isolation')
)::text;

SELECT format(
  'SELECT json_build_object(''type'', ''table'', ''tableName'', %L, ''rowCount'', count(*), ''maxCreatedAt'', %s, ''maxUpdatedAt'', %s, ''maxScheduledAt'', %s, ''maxSentAt'', %s)::text FROM public.%I;',
  table_name,
  CASE WHEN 'created_at' = ANY(columns) THEN 'max(created_at)::text' ELSE 'NULL' END,
  CASE WHEN 'updated_at' = ANY(columns) THEN 'max(updated_at)::text' ELSE 'NULL' END,
  CASE WHEN 'scheduled_at' = ANY(columns) THEN 'max(scheduled_at)::text' ELSE 'NULL' END,
  CASE WHEN 'sent_at' = ANY(columns) THEN 'max(sent_at)::text' ELSE 'NULL' END,
  table_name
)
FROM (
  SELECT
    tables.table_name,
    coalesce(array_agg(columns.column_name) FILTER (WHERE columns.column_name IS NOT NULL), ARRAY[]::text[]) AS columns
  FROM information_schema.tables AS tables
  LEFT JOIN information_schema.columns AS columns
    ON columns.table_schema = tables.table_schema
   AND columns.table_name = tables.table_name
  WHERE tables.table_schema = 'public'
    AND tables.table_type = 'BASE TABLE'
  GROUP BY tables.table_name
) AS public_tables
ORDER BY table_name
\gexec

SELECT json_build_object(
  'type', 'activity',
  'activeNonSnapshotBackends', count(*) FILTER (WHERE state <> 'idle' AND pid <> pg_backend_pid()),
  'applicationNames', coalesce(json_agg(DISTINCT application_name) FILTER (WHERE application_name <> ''), '[]'::json)
)::text
FROM pg_stat_activity
WHERE datname = current_database();

COMMIT;
