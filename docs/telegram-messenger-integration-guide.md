# Инструкция для разработчика: переписка с клиентами через Telegram

## Коротко

В проекте переписка с клиентами через Telegram реализована не через обычный Bot API, а через рабочий Telegram-аккаунт сервиса, подключенный как user session через MTProto.

Клиент пишет в обычный Telegram-аккаунт компании. Backend синхронизирует диалоги и сообщения в CRM, а оператор отвечает из CRM. Ответ уходит клиенту от имени этого же рабочего Telegram-аккаунта.

Bot API можно оставить как дополнительный механизм для deep-link привязки клиента, но основной канал переписки работает через user session.

## Что используется

- Node.js 20+
- Next.js backend routes или любой другой backend
- PostgreSQL
- GramJS, npm-пакет `telegram`
- `qrcode`, если нужен QR-login
- S3-compatible storage для фото и файлов: S3, Cloudflare R2, MinIO

Установка:

```bash
npm install telegram qrcode
```

## Переменные окружения

Минимум для Telegram user session:

```env
TELEGRAM_USER_SESSION_ENABLED=true
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_SESSION_ENCRYPTION_KEY=
```

`TELEGRAM_API_ID` и `TELEGRAM_API_HASH` нужно получить в Telegram developer console:

```text
https://my.telegram.org
```

Опционально для вложений:

```env
MESSENGER_STORAGE_ENABLED=true
MESSENGER_STORAGE_ENDPOINT=
MESSENGER_STORAGE_REGION=auto
MESSENGER_STORAGE_BUCKET=
MESSENGER_STORAGE_ACCESS_KEY_ID=
MESSENGER_STORAGE_SECRET_ACCESS_KEY=
MESSENGER_STORAGE_PUBLIC_BASE_URL=
MESSENGER_STORAGE_FORCE_PATH_STYLE=true
```

Если bucket приватный, `MESSENGER_STORAGE_PUBLIC_BASE_URL` можно оставить пустым и отдавать файлы через backend proxy.

## Базовая архитектура

Frontend не должен работать напрямую с Telegram. Он работает только с внутренними сущностями CRM:

- conversations
- messages
- outbox
- attachments
- linked client context

Telegram-адаптер остается backend-only.

## Таблицы

### `messenger_accounts`

Хранит подключенные аккаунты мессенджеров.

Минимальные поля:

```sql
CREATE TABLE messenger_accounts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  channel TEXT NOT NULL,
  mode TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  username TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'disconnected',
  last_sync_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Для Telegram:

```text
channel = telegram
mode = user_session
```

### `telegram_user_sessions`

Хранит авторизованную Telegram-сессию.

Важно: `session_encrypted` нельзя хранить открытым текстом.

```sql
CREATE TABLE telegram_user_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  messenger_account_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  api_id_encrypted JSONB,
  api_hash_encrypted JSONB,
  session_encrypted JSONB,
  phone_code_hash_encrypted JSONB,
  status TEXT NOT NULL DEFAULT 'disconnected',
  last_authorized_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `messenger_conversations`

Один ряд = один Telegram-диалог.

```sql
CREATE TABLE messenger_conversations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  messenger_account_id TEXT,
  channel TEXT NOT NULL,
  external_conversation_id TEXT NOT NULL,
  external_chat_id TEXT,
  external_user_id TEXT,
  participant_username TEXT,
  client_id TEXT,
  supplier_id TEXT,
  employee_id TEXT,
  title TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  participant_phone TEXT,
  participant_avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Нужен уникальный индекс:

```sql
CREATE UNIQUE INDEX messenger_conversations_channel_external_uidx
  ON messenger_conversations(channel, external_conversation_id);
```

### `messenger_messages`

Хранит входящие и исходящие сообщения.

```sql
CREATE TABLE messenger_messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT NOT NULL,
  messenger_account_id TEXT,
  channel TEXT NOT NULL,
  external_message_id TEXT,
  direction TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_id TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL DEFAULT '',
  attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  error_code TEXT,
  error_message TEXT,
  raw_json JSONB,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Нужен уникальный индекс по Telegram message id:

```sql
CREATE UNIQUE INDEX messenger_messages_channel_message_uidx
  ON messenger_messages(channel, external_message_id)
  WHERE external_message_id IS NOT NULL;
```

### `messenger_outbox`

Очередь исходящих сообщений.

```sql
CREATE TABLE messenger_outbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  messenger_account_id TEXT,
  channel TEXT NOT NULL,
  conversation_id TEXT,
  message_id TEXT,
  recipient_external_chat_id TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL DEFAULT '',
  attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  template_key TEXT,
  template_vars_json JSONB,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Подключение Telegram-аккаунта

Нужны backend endpoints:

```text
POST /api/messenger/telegram-user/start-auth
POST /api/messenger/telegram-user/confirm-code
POST /api/messenger/telegram-user/confirm-password
POST /api/messenger/telegram-user/start-qr
POST /api/messenger/telegram-user/check-qr
POST /api/messenger/telegram-user/sync
POST /api/messenger/telegram-user/disconnect
```

Права:

- подключать и отключать Telegram должен только owner;
- синхронизацию может запускать owner/admin;
- session string не должен уходить на frontend.

## Инициализация GramJS client

```ts
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

export async function createTelegramClient(input: {
  apiId: number;
  apiHash: string;
  session?: string;
}) {
  const client = new TelegramClient(
    new StringSession(input.session ?? ""),
    input.apiId,
    input.apiHash,
    {
      connectionRetries: 5,
      useWSS: true,
    }
  );

  await client.connect();
  return client;
}
```

## Авторизация по номеру и коду

Общий flow:

1. Владелец вводит рабочий номер Telegram.
2. Backend отправляет код через Telegram MTProto.
3. Backend сохраняет `phone_code_hash`.
4. Владелец вводит код.
5. Backend подтверждает код.
6. Если Telegram требует 2FA, frontend показывает поле пароля.
7. После успешного входа backend сохраняет `client.session.save()` в зашифрованном виде.

Упрощенный пример:

```ts
import { Api } from "telegram";

export async function startTelegramAuth(phone: string) {
  const client = await createTelegramClient({ apiId, apiHash });

  const result = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId,
      apiHash,
      settings: new Api.CodeSettings({}),
    })
  );

  // result.phoneCodeHash нужно сохранить зашифрованно
  return {
    phone,
    phoneCodeHash: result.phoneCodeHash,
  };
}
```

Подтверждение кода:

```ts
export async function confirmTelegramCode(input: {
  phone: string;
  code: string;
  phoneCodeHash: string;
}) {
  const client = await createTelegramClient({ apiId, apiHash });

  await client.invoke(
    new Api.auth.SignIn({
      phoneNumber: input.phone,
      phoneCodeHash: input.phoneCodeHash,
      phoneCode: input.code,
    })
  );

  const session = client.session.save();

  // session сохранить в БД зашифрованно
  return { session };
}
```

Если включена двухфакторная авторизация, GramJS вернет ошибку, после которой нужно запросить пароль и выполнить `Api.auth.CheckPassword`.

## QR-login

QR-login нужен, чтобы владелец подключил рабочий Telegram как новое устройство.

Пользовательский сценарий:

1. В CRM нажать "Подключить по QR".
2. Backend создает login token через MTProto.
3. Frontend показывает QR.
4. Владелец открывает Telegram на телефоне:

```text
Настройки -> Устройства -> Подключить устройство
```

5. Владелец сканирует QR.
6. Backend проверяет статус.
7. После успешного входа backend сохраняет session string.

Клиенты ничего не сканируют.

## Шифрование session string

Сессию нужно шифровать на backend, например AES-256-GCM.

Принцип:

```ts
import crypto from "crypto";

function encryptionKey() {
  return crypto
    .createHash("sha256")
    .update(process.env.TELEGRAM_SESSION_ENCRYPTION_KEY ?? "")
    .digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };
}

export function decryptSecret(payload: {
  iv: string;
  tag: string;
  data: string;
}) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(payload.iv, "base64")
  );

  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
```

## Синхронизация диалогов и сообщений

Запускать можно:

- при открытии inbox;
- по кнопке "Синхронизировать";
- фоновым worker;
- по расписанию.

Минимальная логика:

```ts
export async function syncTelegramUserAccount(accountId: string, limit = 40) {
  const account = await loadMessengerAccount(accountId);
  const session = decryptSecret(account.sessionEncrypted);
  const client = await createTelegramClient({ apiId, apiHash, session });

  const dialogs = await client.getDialogs({ limit });

  for (const dialog of dialogs) {
    if (!isDirectConversation(dialog)) continue;

    const conversation = await upsertConversationFromDialog(account, dialog);

    const messages = await client.getMessages(dialog.inputEntity, { limit: 30 });

    for (const message of messages.reverse()) {
      await upsertMessageFromTelegram(conversation.id, message);
    }
  }

  await client.disconnect();
}
```

Для каждого диалога нужно сохранить:

- internal `conversation.id`;
- `messenger_account_id`;
- `external_conversation_id`;
- Telegram chat/user id;
- имя участника;
- username;
- телефон, если доступен;
- последнее сообщение;
- счетчик непрочитанных.

Для каждого сообщения нужно сохранить:

- internal `message.id`;
- `conversation_id`;
- `external_message_id`;
- direction: `inbound` или `outbound`;
- text;
- attachments metadata;
- raw Telegram payload;
- status.

Важно делать `upsert`, а не простую вставку, чтобы повторная синхронизация не дублировала сообщения.

## Отправка текста

Правильный поток:

1. Оператор нажимает "Отправить" в CRM.
2. Backend создает `messenger_messages` со статусом `queued`.
3. Backend создает `messenger_outbox`.
4. Outbox processor отправляет сообщение в Telegram.
5. После успеха backend обновляет статус сообщения на `sent`.
6. При ошибке ставит `failed` и сохраняет `error_message`.

Пример отправки:

```ts
export async function sendTelegramUserText(outbox: MessageOutbox) {
  const session = decryptSecret(outbox.sessionEncrypted);
  const client = await createTelegramClient({ apiId, apiHash, session });

  try {
    const target = await resolveTelegramTarget(client, outbox.recipientExternalChatId);

    const result = await client.sendMessage(target, {
      message: outbox.text,
      linkPreview: false,
    });

    return {
      ok: true,
      status: "sent",
      channelMessageId: result.id ? String(result.id) : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Telegram send failed",
    };
  } finally {
    await client.disconnect();
  }
}
```

## Вложения

Вложения лучше делать через отдельные таблицы и worker.

Минимальная схема:

```text
messenger_attachments
messenger_media_jobs
```

Flow для входящих файлов:

1. При синхронизации сообщения увидеть `message.media`.
2. Создать attachment со статусом `pending`.
3. Поставить job на скачивание.
4. Worker скачивает файл через GramJS.
5. Worker кладет файл в S3/R2/MinIO.
6. Attachment получает статус `ready`.
7. UI показывает файл через backend proxy.

Flow для исходящих файлов:

1. Frontend загружает файл на backend.
2. Backend сохраняет файл в storage.
3. Создает `messenger_messages` и `messenger_outbox`.
4. Outbox processor отправляет файл:

```ts
await client.sendFile(target, {
  file: buffer,
  caption: outbox.text || "",
  forceDocument: !isPhoto,
  workers: 1,
});
```

## API для CRM-интерфейса

Минимальный набор:

```text
GET  /api/messenger/conversations
GET  /api/messenger/conversations/:id/messages
POST /api/messenger/conversations/:id/messages
POST /api/messenger/conversations/:id/attachments
POST /api/messenger/conversations/:id/read
POST /api/messenger/conversations/:id/link-client
POST /api/messenger/conversations/:id/messages/:messageId/retry
```

Frontend должен опрашивать backend, например раз в 10-15 секунд, или использовать SSE:

```text
GET /api/messenger/events
```

В нашем проекте есть оба подхода: polling плюс SSE для обновлений.

## Привязка диалога к клиенту

Доставка Telegram и CRM-привязка должны быть разделены.

Диалог может существовать без клиента:

```text
state = unclassified
```

Потом оператор может:

- выбрать клиента вручную;
- создать клиента из диалога;
- связать диалог с записью;
- связать с отгрузкой;
- связать с диагностикой;
- выбрать автомобиль клиента.

Минимальная таблица идентичностей:

```sql
CREATE TABLE communication_identities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  channel TEXT NOT NULL,
  messenger_account_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  external_conversation_id TEXT,
  username TEXT,
  display_name TEXT,
  phone_normalized TEXT,
  entity_type TEXT,
  client_id TEXT,
  supplier_id TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  match_source TEXT,
  linked_by_id TEXT,
  linked_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Уникальный индекс:

```sql
CREATE UNIQUE INDEX communication_identities_account_user_uidx
  ON communication_identities(organization_id, messenger_account_id, external_user_id);
```

## Bot deep-link как дополнительная опция

Можно добавить Telegram bot только для привязки карточки клиента:

```text
https://t.me/<bot_username>?start=client_<token>
```

После `/start client_<token>` backend связывает Telegram chat id с `client_id`.

Но это не обязательно для переписки через user session. Клиент может просто написать в рабочий аккаунт, а оператор привяжет диалог вручную.

## Production-рекомендации

1. Не использовать Telegram user session для массовых рассылок.
2. Не хранить session string открытым текстом.
3. Не отдавать session/API hash на frontend.
4. Не запускать MTProto-клиент в Edge runtime.
5. Добавить outbox/retry для всех исходящих.
6. Обрабатывать `flood wait` и временные ошибки Telegram.
7. Добавить статус `needs_auth`, если Telegram-сессия слетела.
8. Делать `upsert` сообщений по `external_message_id`.
9. Для вложений использовать отдельный worker.
10. Логировать отправки и ошибки без секретов.
11. Ограничить подключение аккаунта ролью owner.
12. Добавить кнопку disconnect, которая чистит сохраненную session.

## Проверка после внедрения

1. Включить env-переменные.
2. Подключить рабочий Telegram через код или QR.
3. Запустить синхронизацию.
4. Убедиться, что диалоги появились в CRM.
5. Отправить сообщение из Telegram в рабочий аккаунт.
6. Убедиться, что входящее появилось в CRM.
7. Ответить из CRM.
8. Проверить, что ответ пришел клиенту в Telegram.
9. Отправить фото в Telegram и проверить отображение в CRM.
10. Отправить фото из CRM и проверить доставку в Telegram.
11. Отключить аккаунт и проверить, что отправка блокируется с понятной ошибкой.

## Что можно взять из нашего проекта

Основные файлы:

```text
src/lib/messenger/channels/telegram-user-session.ts
src/lib/messenger/messenger-gateway.ts
src/lib/messenger/messenger-outbox.ts
src/lib/messenger/messenger-schema.ts
src/lib/messenger/messenger-storage.ts
src/app/cabinet/integrations/messenger/MessengerIntegrationsClient.tsx
src/components/messenger/MessengerProvider.tsx
src/app/messages/MessagesPageClient.tsx
```

Основной принцип переноса:

```text
Telegram adapter -> internal messenger gateway -> conversations/messages/outbox -> CRM UI
```

Не стоит завязывать UI напрямую на Telegram. Тогда позже можно добавить WhatsApp, VK, Avito, MAX или SMS как отдельные адаптеры, не переписывая inbox.
