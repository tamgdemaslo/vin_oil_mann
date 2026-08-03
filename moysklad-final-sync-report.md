# MoySklad final sync report

Generated: 2026-05-31T19:59:48.182Z

## 1. Период проверки

- Период: последние 7 дней.
- Cutoff: 2026-05-23T22:00:00.000Z.
- Последний режим sync-скрипта: `verify`.
- Последний dry-run JSON: `moysklad-last-days-sync-dry-run.json`.

## 2. Проверенные сущности

- Клиенты
- Товары
- Услуги
- Остатки
- Отгрузки
- Позиции
- Расходные ордера
- Оплаты
- Счета
- Приёмки
- Списания

## 3. Итог по сущностям

| Сущность | Найдено в МойСклад | Найдено локально | Импортировано | Обновлено | Пропущено | Конфликтов | Ошибок |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Клиенты | 10 | 10 | 0 | 0 | 0 | 0 | 0 |
| Товары | 366 | 935 | 0 | 0 | 0 | 0 | 0 |
| Услуги | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Остатки | 833 | 837 | 0 | 0 | 0 | 0 | 0 |
| Отгрузки | 48 | 56 | 0 | 0 | 0 | 0 | 0 |
| Позиции | 145 | 162 | 0 | 0 | 0 | 0 | 0 |
| Расходные ордера | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| Оплаты | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Счета | 1 | 1 | 0 | 0 | 1 | 0 | 0 |
| Приёмки | 15 | 1 | 0 | 0 | 15 | 0 | 0 |
| Списания | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## 4. Что не синхронизировано

| Раздел | Сущность | ID / ключ | Название | Причина | Можно исправить автоматически | Нужно ручное действие |
| --- | --- | --- | --- | --- | --- | --- |
| needsManualReview | payments | 0156497a-5848-11f1-0a80-09d2003a7cd5 | 00041 | Оплаты МойСклад имеют nullable legacy-поля локально, но требуют ручной проверки связи с локальным счётом/кассовым документом перед automatic import | нет | да |
| needsManualReview | payments | 993f7eb2-5847-11f1-0a80-1948003abd3e | 00040 | Оплаты МойСклад имеют nullable legacy-поля локально, но требуют ручной проверки связи с локальным счётом/кассовым документом перед automatic import | нет | да |
| needsManualReview | supplierInvoices | 92e2410f-5847-11f1-0a80-09d2003a6604 | 3470 | LocalSupplierInvoice хранит nullable legacy-поля, но automatic import счетов поставщиков заблокирован до проверки связей с приёмками и оплатами | нет | да |
| needsManualReview | supplies | 114dbc9f-5cee-11f1-0a80-1b8b0022c48d | 00241 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | c8196b24-5cfa-11f1-0a80-041d00241381 | 00243 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | 31cfa0cc-5cf8-11f1-0a80-19be0023237d | 00242 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | 8c14f09b-5c1c-11f1-0a80-130600197537 | 00240 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | 724c13d2-5c04-11f1-0a80-1aef001854c6 | 00239 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | 6a9bb5dc-5b52-11f1-0a80-1cae000d24a8 | 00238 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | b2317bd4-5aaa-11f1-0a80-07fb002401b5 | 00237 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | e10f86e0-5a9e-11f1-0a80-07fb0021227d | 00236 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | 1b513bfd-5a63-11f1-0a80-09d80005721e | 00234 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | 5e22f674-5a8e-11f1-0a80-0586000efa88 | 00235 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | 756a4139-59b6-11f1-0a80-03b6000b3264 | 00233 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | fc6998b5-599b-11f1-0a80-157900059e58 | 00232 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | 5f2494a5-5921-11f1-0a80-1adf00adbada | 00231 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | be0488b5-58f0-11f1-0a80-1948004b8c4c | 00230 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |
| needsManualReview | supplies | 4bda5a51-58e2-11f1-0a80-10740046721d | 00229 | LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей | нет | да |

## 5. Готово к отключению

- Решение: нет.
- Блокеры:
  - Для import supplies/writeoffs нужен проверенный transformer/upsert; legacy-поля уже nullable и не блокируют локальную работу
  - Для import supplier invoices нужна проверка связей с приёмками/оплатами; legacy-поля уже nullable
  - Для import payments нужна проверка связи с локальным счётом/кассовым документом; legacy-поля уже nullable
  - Есть записи для ручной проверки: 18.

## 6. После отключения проверено

| Проверка | Статус | Комментарий |
| --- | --- | --- |
| Feature flags | Выполнено статически | `MOYSKLAD_ENABLED`, `MOYSKLAD_READ_ENABLED`, `MOYSKLAD_WRITE_ENABLED`, `MOYSKLAD_SYNC_ENABLED` заведены и по умолчанию выключены в env-шаблонах. |
| Write-интеграция | Выполнено статически | Обычные write-сценарии переведены на локальные модели; live write остаётся только в ручных/debug сценариях под flags. |
| Read-интеграция | Выполнено статически | Обычные read-сценарии используют локальные источники или local-backed compatibility endpoints. |
| UI | Выполнено статически | Основные sync/debug кнопки и raw legacy блоки убраны; ручной запуск вынесен в `/cabinet/integrations` для owner/admin. |
| TypeScript | Проверено | `node_modules/.bin/tsc --noEmit` прошёл. |
| ESLint | Проверено с предупреждениями | `node_modules/.bin/eslint` прошёл без ошибок; остались существующие warnings. |
| Dry-run report command | Проверено | `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=report` обновляет отчёты без записи в БД. |
| Runtime smoke UI | Не завершено | Локальный `next build/dev` в этом окружении блокируется macOS code-signature ошибкой native `@next/swc` / `lightningcss`, не ошибкой МойСклад. |
| Страницы и сценарии | Требует ручного smoke после исправления окружения | Проверить отгрузки, склад, кассу, счета, CRM, аналитику и CSV/Excel с выключенными `MOYSKLAD_*`. |

## Rollback Plan

- План: `moysklad-rollback-plan.md`.
- Acceptance gate: `moysklad-acceptance-report.md`.
- Перед backfill обязателен DB backup и backup env/config.
- Read-only rollback flags: `MOYSKLAD_ENABLED=true`, `MOYSKLAD_DEBUG_ENABLED=true`, `MOYSKLAD_READ_ENABLED=true`, `MOYSKLAD_SYNC_ENABLED=true`, `MOYSKLAD_WRITE_ENABLED=false`.
- При критичной проблеме write-интеграция не включается автоматически; восстановление делается из backup только после проверки dump в отдельной БД.

## Remaining MoySklad dependencies

- Runtime live fetch должен оставаться только в guarded sync-модулях: `local-inventory-sync` и `moysklad-customer-analytics-sync`.
- `/api/moysklad/*` используется как compatibility namespace для local-backed endpoints и admin/debug интеграции.
- Legacy-поля `moyskladId`, `moyskladHref`, `moyskladMetaHref`, `externalCode`, `source`, `syncedAt`, `syncStatus`, `syncError` остаются для аудита/rollback.
- Для новых локальных документов legacy-поля необязательны: `source` имеет local default, sync/status/error-поля nullable.
