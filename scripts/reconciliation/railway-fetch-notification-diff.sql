\set ON_ERROR_STOP on
\set QUIET 1
\pset tuples_only on
\pset format unaligned

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';

WITH wanted AS (
  SELECT *
  FROM jsonb_to_recordset(:'wanted'::jsonb) AS item("tableName" text, id text)
)
SELECT json_build_object('tableName', 'notification_jobs', 'row', to_jsonb(row_data))::text
FROM public.notification_jobs AS row_data
WHERE row_data.id::text IN (SELECT id FROM wanted WHERE "tableName" = 'notification_jobs')
UNION ALL
SELECT json_build_object('tableName', 'notification_logs', 'row', to_jsonb(row_data))::text
FROM public.notification_logs AS row_data
WHERE row_data.id::text IN (SELECT id FROM wanted WHERE "tableName" = 'notification_logs')
ORDER BY 1;

COMMIT;
