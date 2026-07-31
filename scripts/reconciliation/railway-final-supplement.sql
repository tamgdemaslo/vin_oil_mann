\set ON_ERROR_STOP on
\set QUIET 1
\pset tuples_only on
\pset format unaligned

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT json_build_object('tableName', 'communication_identities', 'row', to_jsonb(row_data))::text
FROM public.communication_identities AS row_data
WHERE created_at > :'previous_cut'::timestamptz OR updated_at > :'previous_cut'::timestamptz
UNION ALL
SELECT json_build_object('tableName', 'conversation_entity_links', 'row', to_jsonb(row_data))::text
FROM public.conversation_entity_links AS row_data
WHERE created_at > :'previous_cut'::timestamptz
UNION ALL
SELECT json_build_object('tableName', 'integration_audit_logs', 'row', to_jsonb(row_data))::text
FROM public.integration_audit_logs AS row_data
WHERE created_at > :'previous_cut'::timestamptz
UNION ALL
SELECT json_build_object('tableName', 'messenger_connections', 'row', to_jsonb(row_data))::text
FROM public.messenger_connections AS row_data
WHERE created_at > :'previous_cut'::timestamptz OR updated_at > :'previous_cut'::timestamptz
UNION ALL
SELECT json_build_object('tableName', 'messenger_conversations', 'row', to_jsonb(row_data))::text
FROM public.messenger_conversations AS row_data
WHERE created_at > :'previous_cut'::timestamptz OR updated_at > :'previous_cut'::timestamptz
UNION ALL
SELECT json_build_object('tableName', 'messenger_messages', 'row', to_jsonb(row_data))::text
FROM public.messenger_messages AS row_data
WHERE created_at > :'previous_cut'::timestamptz OR updated_at > :'previous_cut'::timestamptz
UNION ALL
SELECT json_build_object('tableName', 'messenger_outbox', 'row', to_jsonb(row_data))::text
FROM public.messenger_outbox AS row_data
WHERE created_at > :'previous_cut'::timestamptz OR updated_at > :'previous_cut'::timestamptz
UNION ALL
SELECT json_build_object('tableName', 'notification_jobs', 'row', to_jsonb(row_data))::text
FROM public.notification_jobs AS row_data
WHERE created_at > :'previous_cut'::timestamptz OR updated_at > :'previous_cut'::timestamptz
UNION ALL
SELECT json_build_object('tableName', 'notification_logs', 'row', to_jsonb(row_data))::text
FROM public.notification_logs AS row_data
WHERE created_at > :'previous_cut'::timestamptz
ORDER BY 1;

COMMIT;
