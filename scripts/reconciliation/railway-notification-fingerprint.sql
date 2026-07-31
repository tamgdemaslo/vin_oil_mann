\set ON_ERROR_STOP on
\set QUIET 1
\pset tuples_only on
\pset format unaligned

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';

SELECT json_build_object('tableName', 'notification_jobs', 'id', id, 'rowMd5', md5(to_jsonb(row_data)::text))::text
FROM public.notification_jobs AS row_data
UNION ALL
SELECT json_build_object('tableName', 'notification_logs', 'id', id, 'rowMd5', md5(to_jsonb(row_data)::text))::text
FROM public.notification_logs AS row_data
ORDER BY 1;

COMMIT;
