# Перенос AQSI, рабочего Telegram и ROSSKO в филиальную PostgreSQL

Статус документа: реализация подготовлена, production cutover не выполнялся.

Целевой филиал одноразового переноса: **«Дачная 6В»**. Скрипт ищет ровно один активный филиал по `name` или `shortName`; фиксированный `branch-main` не используется.

## Что изменено

- AQSI: несколько касс на филиал, одна основная; API-ключ и пароль пропуска маркировки зашифрованы; открытая кассовая смена блокирует связанные изменения.
- Фискализация AQSI: durable outbox с идемпотентным ключом `branch + local demand`, состояниями `pending/processing/retry/succeeded`, backoff и cron-повтором.
- Рабочий Telegram: API ID/API Hash и MTProto session принадлежат филиалу; QR pending session дополнительно закреплена за инициировавшим пользователем и имеет TTL.
- ROSSKO: общий филиальный resolver используется пополнением склада, заказом и ИИ-ассистентом; server env fallback отсутствует.
- Статус одноразового переноса хранится отдельно для `aqsi`, `telegram_user`, `rossko` в `branch_integration_migrations`.
- Статусы миграции: `NOT_STARTED → IMPORTED → VALIDATING → ACTIVE_FROM_DATABASE`; при независимой ошибке — `FAILED`, для документированного ручного отката — `ROLLED_BACK`.
- Уведомления владельца и журнал изменений хранятся в существующем `integration_audit_logs`, дедуплицируются и не содержат секретов/provider payload.

## Обязательные условия production cutover

1. `npm run check:timeweb-only` завершён без блокеров.
2. Создана полная резервная копия PostgreSQL Timeweb и проверено, что архив читается средствами восстановления.
3. Зафиксированы время копии, размер, checksum и ответственное лицо.
4. Владелец отдельно подтвердил окно обслуживания и применение forward migration.
5. Подтверждены master-keys `MESSENGER_CREDENTIAL_ENCRYPTION_KEY` и `TELEGRAM_SESSION_ENCRYPTION_KEY`; их смена после переноса без ротации данных запрещена.
6. После проверки backup в GitHub repository variable выставлено `TIMEWEB_BRANCH_INTEGRATION_MIGRATION_APPROVAL=approved-with-verified-timeweb-backup`; до этого job `migration_approval_required` намеренно блокирует CI.

Без выполнения всех шести пунктов миграция не запускается. В её начале стоит fail-closed gate `migration_approval_required`.

## Порядок применения

1. Перевести приложение в окно обслуживания и остановить фоновые процессы, создающие кассовые/Telegram операции.
2. Проверить отсутствие открытой кассовой смены и дублирующих pending/connected Telegram user accounts в одном филиале.
3. Передать migration approval только процессу миграции:

   ```bash
   PGOPTIONS="-c app.branch_integration_db_cutover=approved-with-verified-timeweb-backup" npm run db:deploy
   ```

   Если в очереди осталась ранее подготовленная decommission-миграция, её собственный approval gate подтверждается отдельно в том же согласованном окне.

4. Однократно передать старые provider-переменные только процессу переноса и выполнить:

   ```bash
   npm run migrate:branch-integrations-from-env
   ```

5. Ожидаемый безопасный отчёт без секретов:

   ```text
   branch=Дачная 6В; aqsi=PASS; telegram=PASS|REAUTH_REQUIRED; rossko=PASS; env_fallback=OFF
   ```

6. Если Telegram вернул `REAUTH_REQUIRED`, завершить QR-подключение в `Управление → Интеграции → Рабочий Telegram`; это не влияет на AQSI/ROSSKO.
7. Удалить `AQSI_*`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_USER_SESSION_ENABLED`, `ROSSKO_KEY1`, `ROSSKO_KEY2` из runtime-окружения Timeweb.
8. Настроить вызов `GET /api/cron/aqsi-fiscalization-retry` с `Authorization: Bearer <CRON_SECRET>` каждые 2–5 минут.
9. Выполнить smoke-check: история чеков AQSI, тест каждой кассы, QR/sync Telegram, ROSSKO GetCheckoutDetails/GetSearch, заказ без создания тестовой закупки.

## Независимый отказ провайдера

Сбой одного провайдера записывает только его строку `FAILED` и не откатывает строки `ACTIVE_FROM_DATABASE` других интеграций. Runtime не возвращается к server env. Исправление выполняется через интерфейс филиала или повторный идемпотентный запуск одноразового скрипта.

## Rollback

Миграция forward-only: таблицы не удаляют бизнес-данные. При проблеме откатывается версия приложения, а созданные таблицы сохраняются. Возврат к глобальным env как аварийный fallback запрещён; вместо этого конкретная интеграция помечается ошибкой/отключается в выбранном филиале.
