# Аудит филиальной архитектуры — 2026-07-28

## Статус

Фундамент филиальной архитектуры реализован, но полная изоляция всей платформы **ещё не подтверждена**. Создавать второй рабочий филиал и включать миграцию в production нельзя до закрытия блокеров ниже и прохождения интеграционных security-тестов на копии Selectel PostgreSQL.

Production-платформа: только Selectel. Railway не используется для приложения, миграций или fallback БД.

Актуальный формальный вердикт: `docs/branch-architecture-go-no-go-2026-07-28.md` — **NO-GO**.

## Что реализовано

- `BusinessGroup`, глобальный `User`, `Branch`, `BranchMembership`, `BusinessGroupMembership`.
- Филиальные юридические лица, коммуникационные настройки, Telegram-интеграция, аудит и документ перемещения товаров.
- Подписанный httpOnly active-branch cookie, серверная проверка membership и аудит отказов.
- Режим владельца «Все филиалы» без операционного создания документов.
- Переключатель филиала в desktop/mobile header и карточке пользователя.
- API управления группой, филиалами, участниками и владельческой сводкой.
- Backfill существующих данных в `branch-main` («Филиал 1») в отдельной Prisma migration.
- Филиальный scope для ключевых путей товаров, клиентов, отгрузок, кассы, смен, CRM, payroll и ИИ-помощника.
- Request-scoped Prisma guard автоматически добавляет/проверяет `branchId` для филиальных моделей, запрещает чужой `branchId` и блокирует записи в режиме «Все филиалы».
- Legacy messenger tenant привязан к серверно проверенному филиалу; основные messenger-таблицы получили `branchId`, а migration trigger синхронизирует raw SQL записи через `organization_id`.
- Глобальный API proxy блокирует POST/PATCH/PUT/DELETE в режиме «Все филиалы», кроме смены филиала и auth-операций.
- Новый филиал создаётся пустым; остатки, клиенты и история не копируются.
- Архивация не удаляет данные и отключает филиальную Telegram-интеграцию.
- Cron маршрутизируется последовательно по всем активным филиалам через отдельный AsyncLocalStorage-контекст; архивные филиалы не запускаются.
- Runtime locks/status для складской и аналитической синхронизации, а также payroll/stock/restock/oil/finance cache keys разделены по `branchId`.
- Новые messenger object-storage keys используют префикс `branches/{branchId}/`; endpoints вложений дополнительно проверяют филиальную организацию.
- Telegram и T-Bank получили branch-addressed webhook endpoints; legacy endpoints явно закреплены за `branch-main`.

## Покрытие Prisma

В schema 145 моделей. `branchId` добавлен в 128 операционных моделей. Оставшиеся 17 моделей — control plane или подтверждённые глобальные технические справочники: `BusinessGroup`, `User`, `Branch`, memberships верхнего уровня, branch transfer с парой source/destination, auth, legacy `LocalOrganization`, MANN/fluid raw catalog и системный integration provider.

Все фактические операционные Prisma-модели теперь содержат `branchId` и включены в migration backfill/query guard. Локальные/внешние записи Yclients и legacy appointment storage находятся вне Prisma и остаются отдельным блокером переноса в филиальное хранилище.

Глобальными остаются допустимые технические справочники: MANN raw catalog, fluid raw catalog, системные providers, `BusinessGroup`, `Branch`, `User`, auth password.

## Обнаруженные блокеры

1. В `src/app/api` и `src/lib` остаётся около 781 прямого обращения к Prisma. 123 операционные модели защищены Prisma query extension (5 branch control-plane моделей намеренно исключены), но raw SQL требует отдельного аудита/перевода в scoped repository.
2. Telegram и T-Bank webhooks маршрутизируются по branch-addressed URL, но остальные входящие account/webhook контуры должны пройти такой же интеграционный тест на реальных аккаунтах Branch 2.
3. Yclients, Telegram employee notifications, ROSSKO и МойСклад всё ещё требуют полноценных филиальных credential/config records. Глобальные env-настройки допустимы только для `branch-main` на переходном этапе; Yclients sync для других филиалов сейчас намеренно пропускается.
4. Новые messenger storage keys и download endpoints изолированы, но диагностические файлы, публичные отчёты и прочие файловые контуры ещё не прошли полный storage-аудит/миграцию старых ключей.
5. Экспорты склада/товаров/зарплаты ещё не прошли полный security-аудит.
6. Часть raw SQL payroll/inventory/CRM требует явного `branch_id` во всех SELECT/UPDATE/INSERT, а не только default БД.
7. Composite foreign keys `(branch_id, entity_id)` не добавлены для всех критичных связей. Сейчас часть связей защищена service-layer проверками.
8. В legacy schema остаются глобальные unique-ограничения для части внешних идентификаторов (в частности MoySklad IDs, messenger update/message IDs и idempotency keys). До Branch 2 их нужно заменить на branch-aware индексы и обновить соответствующие `ON CONFLICT`/Prisma selectors.
9. RLS намеренно не включён: сначала нужно проверить Prisma pooling и transaction-local context. Это отдельный этап hardening.
10. Нет интеграционного тестового стенда с двумя филиалами, одинаковыми телефонами/VIN/артикулами и попытками доступа по чужим ID.
11. Railway → Selectel migration остаётся непроверенной согласно `docs/railway-selectel-audit-2026-07-25.md`; это отдельный production blocker.

## Обязательный security-набор до запуска Branch 2

- сотрудник Branch 1 не читает и не меняет клиента, товар, отгрузку, запись, CRM-дело и диагностику Branch 2 по ID;
- переданный body/query `branchId` игнорируется или проверяется membership;
- одинаковые phone/VIN/article/document number допустимы в разных филиалах;
- поиск, AI tools, exports и dashboard не возвращают чужие строки;
- messenger attachment/content URL не выдаёт файл чужого филиала;
- cron/jobs несут `branchId` и выбирают филиальную интеграцию;
- all-branches mode разрешает только агрегированные read-only endpoints;
- archived branch блокирует все новые операции;
- документы используют юридические реквизиты и нумерацию выбранного филиала.

## Решение по выпуску

Текущий код можно использовать как основу следующего этапа разработки и тестирования. Он не должен маркироваться как завершённая миграция и не должен применяться в production, пока все блокеры не закрыты и runbook не подписан владельцем миграции.
