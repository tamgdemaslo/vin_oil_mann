CREATE TABLE IF NOT EXISTS messenger_connections (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'unknown',
  client_id TEXT,
  employee_id TEXT,
  supplier_id TEXT,
  external_user_id TEXT,
  external_chat_id TEXT NOT NULL,
  external_username TEXT,
  display_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  linked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  blocked_at TIMESTAMPTZ,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS messenger_connections_channel_chat_uidx
  ON messenger_connections(channel, external_chat_id);

CREATE INDEX IF NOT EXISTS messenger_connections_channel_user_idx
  ON messenger_connections(channel, external_user_id);

CREATE INDEX IF NOT EXISTS messenger_connections_channel_idx ON messenger_connections(channel);
CREATE INDEX IF NOT EXISTS messenger_connections_type_idx ON messenger_connections(type);
CREATE INDEX IF NOT EXISTS messenger_connections_client_id_idx ON messenger_connections(client_id);
CREATE INDEX IF NOT EXISTS messenger_connections_employee_id_idx ON messenger_connections(employee_id);
CREATE INDEX IF NOT EXISTS messenger_connections_supplier_id_idx ON messenger_connections(supplier_id);
CREATE INDEX IF NOT EXISTS messenger_connections_is_active_idx ON messenger_connections(is_active);

CREATE TABLE IF NOT EXISTS messenger_conversations (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  external_conversation_id TEXT NOT NULL,
  connection_id TEXT,
  client_id TEXT,
  employee_id TEXT,
  supplier_id TEXT,
  title TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  participant_phone TEXT,
  participant_avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to_id TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_text TEXT NOT NULL DEFAULT '',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_important BOOLEAN NOT NULL DEFAULT false,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  related_case_id TEXT,
  related_appointment_id TEXT,
  related_shipment_id TEXT,
  related_diagnostic_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT messenger_conversations_connection_fk
    FOREIGN KEY (connection_id) REFERENCES messenger_connections(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS messenger_conversations_channel_external_uidx
  ON messenger_conversations(channel, external_conversation_id);

CREATE INDEX IF NOT EXISTS messenger_conversations_last_message_at_idx ON messenger_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS messenger_conversations_channel_idx ON messenger_conversations(channel);
CREATE INDEX IF NOT EXISTS messenger_conversations_status_idx ON messenger_conversations(status);
CREATE INDEX IF NOT EXISTS messenger_conversations_client_id_idx ON messenger_conversations(client_id);
CREATE INDEX IF NOT EXISTS messenger_conversations_employee_id_idx ON messenger_conversations(employee_id);
CREATE INDEX IF NOT EXISTS messenger_conversations_supplier_id_idx ON messenger_conversations(supplier_id);
CREATE INDEX IF NOT EXISTS messenger_conversations_assigned_to_id_idx ON messenger_conversations(assigned_to_id);
CREATE INDEX IF NOT EXISTS messenger_conversations_related_case_id_idx ON messenger_conversations(related_case_id);
CREATE INDEX IF NOT EXISTS messenger_conversations_related_appointment_id_idx ON messenger_conversations(related_appointment_id);
CREATE INDEX IF NOT EXISTS messenger_conversations_related_shipment_id_idx ON messenger_conversations(related_shipment_id);
CREATE INDEX IF NOT EXISTS messenger_conversations_related_diagnostic_id_idx ON messenger_conversations(related_diagnostic_id);

CREATE TABLE IF NOT EXISTS messenger_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  external_message_id TEXT,
  direction TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_id TEXT,
  text TEXT NOT NULL DEFAULT '',
  attachments_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'queued',
  error_code TEXT,
  error_message TEXT,
  raw_json JSONB,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT messenger_messages_conversation_fk
    FOREIGN KEY (conversation_id) REFERENCES messenger_conversations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS messenger_messages_channel_message_uidx
  ON messenger_messages(channel, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messenger_messages_conversation_created_idx
  ON messenger_messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS messenger_messages_status_idx ON messenger_messages(status);
CREATE INDEX IF NOT EXISTS messenger_messages_channel_idx ON messenger_messages(channel);
CREATE INDEX IF NOT EXISTS messenger_messages_author_idx ON messenger_messages(author_type, author_id);

CREATE TABLE IF NOT EXISTS messenger_outbox (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  conversation_id TEXT,
  message_id TEXT,
  connection_id TEXT,
  recipient_external_chat_id TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL DEFAULT '',
  attachments_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  template_key TEXT,
  template_vars_json JSONB,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT messenger_outbox_conversation_fk
    FOREIGN KEY (conversation_id) REFERENCES messenger_conversations(id) ON DELETE SET NULL,
  CONSTRAINT messenger_outbox_message_fk
    FOREIGN KEY (message_id) REFERENCES messenger_messages(id) ON DELETE SET NULL,
  CONSTRAINT messenger_outbox_connection_fk
    FOREIGN KEY (connection_id) REFERENCES messenger_connections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS messenger_outbox_status_next_idx ON messenger_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS messenger_outbox_conversation_idx ON messenger_outbox(conversation_id);
CREATE INDEX IF NOT EXISTS messenger_outbox_message_idx ON messenger_outbox(message_id);
CREATE INDEX IF NOT EXISTS messenger_outbox_connection_idx ON messenger_outbox(connection_id);
CREATE INDEX IF NOT EXISTS messenger_outbox_channel_idx ON messenger_outbox(channel);

CREATE TABLE IF NOT EXISTS messenger_templates (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT,
  text TEXT NOT NULL,
  variables_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS messenger_templates_key_uidx ON messenger_templates(key);
CREATE INDEX IF NOT EXISTS messenger_templates_channel_idx ON messenger_templates(channel);
CREATE INDEX IF NOT EXISTS messenger_templates_active_idx ON messenger_templates(is_active);

CREATE TABLE IF NOT EXISTS messenger_webhook_events (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  external_update_id TEXT NOT NULL,
  raw_json JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS messenger_webhook_events_channel_update_uidx
  ON messenger_webhook_events(channel, external_update_id);

CREATE INDEX IF NOT EXISTS messenger_webhook_events_channel_created_idx
  ON messenger_webhook_events(channel, created_at);

CREATE INDEX IF NOT EXISTS messenger_webhook_events_processed_at_idx
  ON messenger_webhook_events(processed_at);

CREATE TABLE IF NOT EXISTS messenger_link_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  client_id TEXT,
  employee_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS messenger_link_tokens_token_uidx ON messenger_link_tokens(token);
CREATE INDEX IF NOT EXISTS messenger_link_tokens_channel_idx ON messenger_link_tokens(channel);
CREATE INDEX IF NOT EXISTS messenger_link_tokens_type_idx ON messenger_link_tokens(type);
CREATE INDEX IF NOT EXISTS messenger_link_tokens_client_id_idx ON messenger_link_tokens(client_id);
CREATE INDEX IF NOT EXISTS messenger_link_tokens_employee_id_idx ON messenger_link_tokens(employee_id);
CREATE INDEX IF NOT EXISTS messenger_link_tokens_expires_at_idx ON messenger_link_tokens(expires_at);

CREATE TABLE IF NOT EXISTS messenger_channel_settings (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  config_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  secrets_json JSONB,
  created_by_id TEXT,
  updated_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS messenger_channel_settings_channel_uidx
  ON messenger_channel_settings(channel);

CREATE INDEX IF NOT EXISTS messenger_channel_settings_enabled_idx
  ON messenger_channel_settings(enabled);

INSERT INTO messenger_connections
  (id, channel, type, external_chat_id, display_name, is_active, raw_json)
VALUES
  ('conn-telegram-default', 'telegram', 'unknown', 'telegram:default', 'Telegram Bot', true, '{}'::jsonb),
  ('conn-mock-default', 'mock', 'unknown', 'mock:default', 'Mock Gateway', true, '{"mode":"local"}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO messenger_templates (id, key, title, channel, text, variables_json)
VALUES
  ('tpl-hello', 'hello', 'Здравствуйте', NULL, 'Здравствуйте!', '[]'::jsonb),
  ('tpl-diagnostic-report', 'diagnostic_report', 'Отчёт диагностики', NULL, $$Здравствуйте, {{clientName}}!
Готов отчёт диагностики по автомобилю {{vehicleName}}.

{{reportUrl}}

Если хотите согласовать работы — напишите нам.$$, '["clientName","vehicleName","reportUrl"]'::jsonb),
  ('tpl-appointment-confirm', 'appointment_confirm', 'Подтверждение записи', NULL, $$Здравствуйте, {{clientName}}!
Вы записаны на {{date}} в {{time}}.

Автомобиль: {{vehicleName}}
Услуга: {{serviceName}}$$, '["clientName","date","time","vehicleName","serviceName"]'::jsonb),
  ('tpl-need-vin', 'need_vin', 'Нужен VIN', NULL, 'Подскажите, пожалуйста, VIN или госномер автомобиля — так мы точнее подберём расходники.', '[]'::jsonb),
  ('tpl-estimate-ready', 'estimate_ready', 'Расчёт готов', NULL, $$Расчёт готов:
{{summary}}

Итого: {{amount}} ₽$$, '["summary","amount"]'::jsonb),
  ('tpl-task-assigned', 'task_assigned', 'Назначена задача', NULL, $$Вам назначена задача:
{{taskTitle}}

Срок: {{dueAt}}$$, '["taskTitle","dueAt"]'::jsonb),
  ('tpl-case-overdue', 'case_overdue', 'Просрочено дело', NULL, $$Просрочено дело клиента:
{{caseTitle}}

Клиент: {{clientName}}
Срок: {{dueAt}}$$, '["caseTitle","clientName","dueAt"]'::jsonb),
  ('tpl-appointment-today-summary', 'appointment_today_summary', 'Сводка записей на сегодня', NULL, $$Сводка записей на сегодня:
{{summary}}$$, '["summary"]'::jsonb),
  ('tpl-vin', 'vin_request', 'Запрос VIN', NULL, 'Подскажите VIN, пожалуйста', '[]'::jsonb),
  ('tpl-record', 'appointment_offer', 'Запись', NULL, 'Можем записать вас на удобное время', '[]'::jsonb),
  ('tpl-stock-ok', 'stock_available', 'В наличии', NULL, 'Расходники есть в наличии', '[]'::jsonb),
  ('tpl-stock-wait', 'stock_waiting', 'Ожидаются', NULL, 'Расходники ожидаются', '[]'::jsonb),
  ('tpl-thanks', 'thanks_waiting', 'Спасибо', NULL, 'Спасибо, будем ждать', '[]'::jsonb),
  ('tpl-welcome-back', 'welcome_back', 'Обращайтесь', NULL, 'Хорошо, обращайтесь', '[]'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  title = EXCLUDED.title,
  channel = EXCLUDED.channel,
  text = EXCLUDED.text,
  variables_json = EXCLUDED.variables_json,
  is_active = true,
  updated_at = now();
