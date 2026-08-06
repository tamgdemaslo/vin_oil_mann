# Audit замены старой диагностики

Дата аудита: 2026-06-01.

Целевая модель новой диагностики описана отдельно в `diagnostic-new-module-spec.md`.

## Текущий старый модуль

Основной UI старой диагностики находится в `src/components/diagnostic/DiagnosticModal.tsx`. Это большой клиентский модал на 3289 строк: быстрая диагностика, детальные экраны блоков/позиций, фото, hotkeys, сводка, офферы, завершение, ссылка на публичный отчет и создание CRM-напоминаний.

Каталог старого чек-листа находится в `src/data/diagnostic-catalog.ts`: блоки `AGGREGATE_FLUID`, `SERVICE_FLUID`, `VISUAL`, `SURVEY`, список узлов, теги, правила замеров, recommendation presets, шаблоны офферов для красной зоны и следующего визита.

Публичный отчет находится в `src/app/report/[token]/page.tsx`: грузит `GET /api/diagnostic/public/[token]`, показывает клиентский отчет, фото, print-view, lightbox и сохраняет напоминание через `POST /api/diagnostic/public/[token]/reminder`.

Backend старой диагностики полностью лежит в `src/app/api/diagnostic/**/route.ts`:

- `POST /api/diagnostic` - создает диагностику и seed-позиции.
- `GET /api/diagnostic/for-shipment?shipmentId=...` - ищет последнюю диагностику по отгрузке.
- `GET/PATCH /api/diagnostic/[id]` - загрузка полной диагностики и обновление шапки/vehicle hints.
- `GET /api/diagnostic/[id]/by-history` - история отгрузок и диагностик.
- `PUT /api/diagnostic/[id]/position` - сохранение позиции.
- `POST /api/diagnostic/[id]/photo` - загрузка фото.
- `GET/DELETE /api/diagnostic/[id]/photo/[photoId]` - чтение/удаление внутреннего фото.
- `POST /api/diagnostic/[id]/complete` - проверка обязательных фото/рекомендаций, пересчет итогов, завершение.
- `POST /api/diagnostic/[id]/rebuild-offers` - пересборка офферов.
- `POST /api/diagnostic/[id]/add-offers-to-shipment` - добавление выбранных офферов в локальную отгрузку.
- `POST /api/diagnostic/[id]/report-link` - генерация публичной ссылки.
- `POST /api/diagnostic/[id]/send-report` - отметка отправки отчета.
- `POST /api/diagnostic/[id]/crm-reminders` - создание CRM-дел по проблемным позициям.
- `GET /api/diagnostic/public/[token]` - публичные данные отчета.
- `POST /api/diagnostic/public/[token]/reminder` - клиентское напоминание/CRM-дела.
- `GET /api/diagnostic/public/[token]/photo/[photoId]` - публичное фото.

Сервисные файлы старого модуля:

- `src/lib/diagnostic-seed-positions.ts` - seed/sync позиций из каталога с учетом vehicle hints.
- `src/lib/diagnostic-regenerate-offers.ts` - пересчет summary counters и пересоздание `DiagnosticOffer`.
- `src/lib/diagnostic-local_inventory-resolve.ts` - подбор `LocalProduct` для вариантов офферов.
- `src/lib/diagnostic-photos.ts` - путь `.data/diagnostic-photos` или `DIAGNOSTIC_PHOTOS_PATH`, запись/удаление/ MIME фото.

Связанные хвосты, не указанные в первичном списке, но завязанные на старую диагностику:

- `src/data/diagnostic-report-copy.ts` - клиентский текст публичного отчета.
- `src/lib/diagnostic-report-link.ts` - построение `/report/[token]`.
- `src/lib/diagnostic-vehicle-hints.ts` - вывод подсказок по АКПП/МКПП/AWD/hybrid/electric из VIN lookup.
- `src/app/globals.css` - большой CSS-блок `.eco-diagnostic-*` и `.client-report-*`.
- `docs/diagnostic-roadmap.md` и `docs/diagnostic-report-figma-map.md` - документация старого сценария.

## Prisma и хранение

Старые модели находятся в `prisma/schema.prisma`:

- `Diagnostic` -> таблица `diagnostics`: связь с отгрузкой через `shipmentLocalInventoryId`, шапка авто, статус, публичный token, summary-счетчики.
- `DiagnosticPosition` -> `diagnostic_positions`: блок, node, статус, tags, measurement, recommendation, notes.
- `DiagnosticPhoto` -> `diagnostic_photos`: `filePath`, caption, связь с позицией.
- `DiagnosticOffer` -> `diagnostic_offers`: offerKey, variants JSON, selectedVariantIndex, addedToShipment, nextVisitOnly.

Миграция-источник: `prisma/migrations/20260202000000_add_diagnostic_module/migration.sql`.

## Точки запуска

`src/app/shipment/new/NewShipmentPageClient.tsx`:

- импортирует `DiagnosticModal`;
- держит `diagnosticModalOpen` и `diagnosticRowId`;
- `handleOpenDiagnostic()` при необходимости сначала создает отгрузку, затем вызывает `GET /api/diagnostic/for-shipment`, `POST /api/diagnostic`, `PATCH /api/diagnostic/[id]`;
- кнопка `Произвести диагностику` находится в VIN-блоке;
- внизу страницы рендерится `<DiagnosticModal ... />`.

`src/app/shipment/[id]/page.tsx`:

- импортирует `DiagnosticModal`;
- при загрузке вызывает `GET /api/diagnostic/for-shipment?shipmentId=...`;
- `handleOpenDiagnosticDetail()` создает диагностику через `POST /api/diagnostic` или открывает найденную, затем `PATCH /api/diagnostic/[id]`;
- кнопки `Произвести диагностику` / `Открыть диагностику` встречаются в карточке автомобиля, VIN-вкладке и legacy workbench;
- показывает статус диагностики в боковом summary;
- внизу страницы рендерится `<DiagnosticModal ... />`.

Публичный вход клиента: `/report/[token]`.

## Что удаляем после замены

- Старый `DiagnosticModal.tsx` целиком.
- Старый `diagnostic-catalog.ts`, если новый модуль имеет свой каталог/схему.
- Старую бизнес-логику `diagnostic-seed-positions.ts`, `diagnostic-regenerate-offers.ts`, `diagnostic-local_inventory-resolve.ts`.
- Старую реализацию хранения фото `diagnostic-photos.ts`, когда новый модуль возьмет на себя storage и migration старых файлов.
- Старую реализацию public report в `src/app/report/[token]/page.tsx`, если новый модуль поставляет новый отчет.
- Старые CSS-блоки `.eco-diagnostic-*` и `.client-report-*` после переключения UI.
- Документацию старого сценария в `docs/diagnostic-roadmap.md` / `docs/diagnostic-report-figma-map.md`, либо пометить как legacy.

## Что заменяем

- Кнопки в `shipment/new` и `shipment/[id]` должны открывать новый диагностический модуль, но сохранить пользовательские сценарии `Произвести диагностику` и `Открыть диагностику`.
- Все прямые fetch-вызовы `/api/diagnostic...` во фронте должны быть заменены на клиент нового модуля или адаптер старого URL-контракта.
- API handlers в `src/app/api/diagnostic/**/route.ts` должны стать thin adapters к новому модулю или быть перенесены под новую реализацию с теми же публичными маршрутами.
- Офферы, CRM-напоминания, добавление в отгрузку и публичный отчет должны работать от новой модели данных, но не ломать текущие ссылки и кнопки.

## Временно оставляем для миграции/совместимости

- Prisma-модели `Diagnostic`, `DiagnosticPosition`, `DiagnosticPhoto`, `DiagnosticOffer` и таблицы `diagnostics`, `diagnostic_positions`, `diagnostic_photos`, `diagnostic_offers` до завершения миграции исторических данных.
- `clientReportToken` и маршрут `/report/[token]`, чтобы старые клиентские ссылки не умерли.
- Старые файлы фото в `.data/diagnostic-photos` / `DIAGNOSTIC_PHOTOS_PATH` до переноса или read-through совместимости.
- `src/lib/diagnostic-report-link.ts` или совместимый аналог, пока публичные ссылки строятся по старому token.
- `src/data/diagnostic-report-copy.ts`, если новый публичный отчет временно читает старые позиции.
- `GET /api/diagnostic/for-shipment` как bridge для экранов отгрузок на время поэтапной замены.

## Правило работы с БД

Старые Prisma-модели и данные диагностики нельзя удалять первым шагом. Порядок замены должен быть таким:

1. Отключить старый UI из пользовательского сценария.
2. Отключить старые API только из новых пользовательских сценариев, сохранив совместимые route handlers там, где они нужны для старых ссылок или миграции.
3. Добавить новые модели/поля, если они нужны новому модулю.
4. Написать миграцию или адаптер чтения старых данных.
5. После проверки истории и публичных ссылок отдельно решить: удалять старые таблицы или оставить их как legacy.

Если старые данные диагностики нужны для истории, они остаются как legacy-слой. Старые публичные ссылки `/report/[token]`, которые уже выдавались клиентам, ломать нельзя. Допустим fallback: новый отчет открывается для новых диагностик, а старый отчет используется только для старых token, если адаптер не может отрисовать их в новом формате без потерь.

## Маршруты, которые должны остаться

Эти URL стоит сохранить как стабильный внешний/внутренний контракт, но перевести на новый модуль:

- `/report/[token]`
- `POST /api/diagnostic`
- `GET /api/diagnostic/for-shipment`
- `GET/PATCH /api/diagnostic/[id]`
- `GET /api/diagnostic/[id]/by-history`
- `PUT /api/diagnostic/[id]/position`
- `POST /api/diagnostic/[id]/photo`
- `GET/DELETE /api/diagnostic/[id]/photo/[photoId]`
- `POST /api/diagnostic/[id]/complete`
- `POST /api/diagnostic/[id]/rebuild-offers`
- `POST /api/diagnostic/[id]/add-offers-to-shipment`
- `POST /api/diagnostic/[id]/report-link`
- `POST /api/diagnostic/[id]/send-report`
- `POST /api/diagnostic/[id]/crm-reminders`
- `GET /api/diagnostic/public/[token]`
- `POST /api/diagnostic/public/[token]/reminder`
- `GET /api/diagnostic/public/[token]/photo/[photoId]`

## Вывод

Старая диагностика сейчас не изолирована: UI, API, Prisma, public report, CSS и shipment-экраны связаны напрямую. Безопасная замена должна идти через совместимый слой: сначала сохранить маршруты и публичные token-ссылки, затем переключить кнопки отгрузок на новый UI/API, после этого мигрировать исторические данные и только потом удалить legacy-файлы, модели и CSS.

## Состояние после переключения на новую карту

Старый UX выведен из пользовательского сценария:

- `src/app/shipment/new/NewShipmentPageClient.tsx` импортирует `DiagnosticMapModal` и работает с `/api/diagnostics/**`.
- `src/app/shipment/[id]/page.tsx` импортирует `DiagnosticMapModal`, имеет вкладку `Диагностика` и работает с `/api/diagnostics/**`.
- Кнопки `Произвести диагностику` и `Открыть диагностику` открывают новую карту, а не старый hub.
- `/report/[token]` рендерит новый `DiagnosticPublicReport`; старый `/api/diagnostic/public/[token]` используется только как fallback для legacy-token.
- Старый `DiagnosticModal.tsx`, `diagnostic-catalog.ts` и `src/app/api/diagnostic/**` помечены как legacy и не должны использоваться в новых экранах.

Новый API-слой находится в `src/app/api/diagnostics/**` и покрывает:

- создание диагностики для отгрузки;
- поиск/получение диагностики;
- сохранение пункта;
- загрузку, обновление подписи и удаление фото;
- завершение диагностики;
- публичный отчёт;
- сохранение публичного напоминания;
- CRM-задачу из рекомендации;
- добавление рекомендации в локальную отгрузку;
- payload для report/print.

Принята безопасная стратегия миграции, вариант A: старые диагностики остаются legacy, новые создаются в новой схеме, старые публичные ссылки открываются через fallback. Старые таблицы и данные не удаляются без отдельного backup и решения по истории.

Подробный миграционный план вынесен в `diagnostic-migration-plan.md`.

Приёмочная матрица по сценариям 1-9 вынесена в `diagnostic-acceptance.md`.
