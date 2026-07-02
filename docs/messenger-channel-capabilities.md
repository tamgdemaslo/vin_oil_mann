# Messenger Channel Capabilities

Дата аудита: 2026-06-22

Этап 0-1 фиксирует только подтвержденные возможности и ограничения каналов. До утверждения этой матрицы адаптеры WhatsApp, VK, Avito, MAX и SMS остаются `planned/disabled`; UI может показывать мастер подключения только в режиме audit/coming-soon.

## Статусы

| Status | Значение |
| --- | --- |
| Supported | Можно реализовывать в Gateway после настройки официального доступа. |
| Partially supported | Доступно, но есть ограничения сценария, прав, тарифа или окна сообщений. |
| Requires approval | Нужны модерация, бизнес-доступ, OAuth/app approval или договор с провайдером. |
| Unsupported | Не делать в этом канале или не делать таким способом. |

## Matrix

| Канал | Разрешенный режим | Входящие | Исходящие | Webhook / realtime | Доступ и стоимость | Статус этапа 1 |
| --- | --- | --- | --- | --- | --- | --- |
| Telegram | Рабочий аккаунт через User Session / MTProto; legacy bot-only скрыт из основного UI. | Supported: диалоги рабочего аккаунта синхронизируются в `MessengerConversation` / `MessengerMessage`. | Supported: текст через user session и общий `MessengerOutbox`. | Supported internally: SSE `/api/messenger/events`; Telegram session sync/polling. | Требуются `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, encrypted session. Массовая рассылка запрещена продуктово. | Supported, единственный рабочий канал. |
| WhatsApp | Только official WhatsApp Business Platform / Cloud API + Embedded Signup. | Partially supported: события сообщений через Meta webhooks после настройки WABA/phone number. | Partially supported: исходящие ограничены правилами WhatsApp, окнами переписки и approved templates. | Supported after Meta app/webhook setup. | Requires approval: Meta Business, WABA, номер, templates, биллинг conversations. Никаких личных WhatsApp Web/session. | Planned, disabled. |
| VK | Только сообщения сообщества через официальный VK API/Callback API. | Supported for community messages when messages are enabled. | Partially supported: ответы от имени сообщества; личные аккаунты и пароли запрещены. | Supported via Callback API / webhook. | Requires approval/settings for community token, callback confirmation, secret. | Planned, disabled. |
| Avito | Только официальный Avito API/OAuth, если у аккаунта есть доступ к messenger endpoints. | Partially supported: зависит от доступности API и прав аккаунта. | Partially supported: только через OAuth/API, без парсинга сайта. | Requires approval/access: webhooks или polling в рамках официального API. | Requires approval: доступ к Avito API может быть ограничен категорией/аккаунтом/модерацией. | Planned, disabled; UI показывает "Ожидается доступ". |
| MAX | Только MAX Bot API, не личный аккаунт. | Partially supported: bot updates через Webhook/Long Polling, production только webhook. | Supported for bot messages через `platform-api.max.ru/messages`. | Supported: production Webhook; Long Polling только dev/test. | Requires approval/config: bot token, HTTPS webhook; token в `Authorization` header, 30 rps limit. | Planned, disabled. |
| SMS | Провайдер не выбран. Нужно сравнить 2-3 российских провайдера до adapter design. | Partially supported у большинства провайдеров через delivery callbacks. | Supported у провайдеров, но формат, цена и sender id различаются. | Partially supported: зависит от провайдера. | Requires approval: договор, sender name, тарифы, персональные данные, opt-in/out. | Planned, disabled до отдельного аудита. |

## Guardrails

- Frontend работает только с внутренними моделями `Conversation`, `Message`, `MessengerAccount`, `MessengerOutbox`.
- Секреты каналов хранятся только в `IntegrationCredential.encryptedValue`.
- Для всех новых messenger-записей используется `organization_id`; текущий этап использует `MESSENGER_DEFAULT_ORG_ID ?? "default"`.
- Planned/disabled adapter не должен ломать Telegram, общий inbox, CRM и outbox.
- Клиентские действия не требуются для рабочего Telegram User Session; QR в Telegram UI сканирует только владелец аккаунта как "подключить устройство".

## References

- WhatsApp Business Platform: https://developers.facebook.com/docs/whatsapp/cloud-api/
- WhatsApp Embedded Signup: https://developers.facebook.com/docs/whatsapp/embedded-signup/
- VK community messages: https://dev.vk.com/ru/api/community-messages/getting-started
- VK Callback API: https://dev.vk.com/ru/api/callback/getting-started
- Avito messenger API: https://developers.avito.ru/api-catalog/messenger/documentation
- Avito OAuth: https://developers.avito.ru/api-catalog/auth/documentation
- MAX Bot API: https://dev.max.ru/docs-api
- SMS candidates for later audit: https://smsc.ru/api/ , https://sms.ru/api/ , https://dev.infobip.com/docs/sms
