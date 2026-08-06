# Diagnostic Acceptance Checklist

## Сценарий 1

Статус: pass.

Пользователь открывает отгрузку и нажимает `Произвести диагностику`.
Открывается новый `DiagnosticMapModal`, а не старый hub.

Проверено по коду:

- `src/app/shipment/[id]/page.tsx` импортирует `DiagnosticMapModal`.
- `src/app/shipment/new/NewShipmentPageClient.tsx` импортирует `DiagnosticMapModal`.
- Оба shipment-экрана создают/ищут диагностику через `/api/diagnostics/**`.
- Старый `DiagnosticModal` помечен как legacy и не импортируется в новых shipment-экранах.

## Сценарий 2

Статус: pass.

На экране диагностики видны 4 блока и 17 актуальных пунктов из нового каталога.
Статусы выбираются на одной карте, без обязательного перехода в отдельный экран
каждого узла.

Проверено по коду:

- `src/data/diagnostic-map.ts` содержит `DIAGNOSTIC_MAP_BLOCKS`.
- `src/components/diagnostic/DiagnosticMapModal.tsx` рендерит блоки и пункты
  одним экраном.
- В новом UI нет старого flow `hub -> block -> node -> back`.

## Сценарий 3

Статус: pass.

Статусы `По пробегу` и `Со слов клиента` отображаются как косвенная оценка, а не
как прямой осмотр.

Проверено по коду:

- `DIAGNOSTIC_STATUS_GROUPS` разделяет статусы на `Результат осмотра` и
  `Без прямого осмотра`.
- `by_mileage` имеет method `mileage`.
- `by_client` имеет method `client_words`.
- `src/data/diagnostic-report-text.ts` содержит управляемые клиентские тексты для
  этих статусов.
- `DiagnosticPublicReport` показывает человекочитаемые labels, не raw-коды.

## Сценарий 4

Статус: pass.

Фото с подписью добавляется в пункт и отображается в диагностике, публичном
отчете и печатном отчете.

Проверено по коду:

- `POST /api/diagnostics/[id]/photos` принимает `itemCode`, `file`, `caption`.
- `PATCH /api/diagnostics/[id]/photos/[photoId]` обновляет подпись.
- `DELETE /api/diagnostics/[id]/photos/[photoId]` удаляет фото.
- `DiagnosticMapModal` показывает thumbnails, lightbox и редактируемые подписи.
- `DiagnosticPublicReport` выводит фото с затемнением и подписью.

## Сценарий 5

Статус: pass.

Печать открывает новый клиентский отчет.

Проверено по коду:

- `src/app/report/[token]/print/page.tsx` рендерит `DiagnosticPublicReport` в
  `printMode`.
- `DiagnosticPublicReport` содержит кнопку `Печать отчёта`.
- `src/app/globals.css` содержит print-styles для `.diag-report-page`,
  `.rep-*` и `.no-print`.

## Сценарий 6

Статус: pass.

Клиент открывает `/report/[token]` и видит новый онлайн-отчет.

Проверено по коду:

- `src/app/report/[token]/page.tsx` рендерит `DiagnosticPublicReport`.
- Компонент сначала читает `/api/diagnostics/public/[token]`.
- Legacy `/api/diagnostic/public/[token]` используется только fallback-ом для
  старых token.

## Сценарий 7

Статус: pass.

В отчете нет raw-кодов, внутренних id и технических данных.

Проверено по коду:

- `DiagnosticPublicReport` показывает labels `Норма`, `Внимание`, `Замена`,
  `Нет доступа`, `По пробегу`, `Со слов клиента`.
- `src/data/diagnostic-report-text.ts` хранит клиентские формулировки отдельно от
  JSX.
- В публичном UI не выводятся закупочные цены, маржа, внутренние ids или raw tags.

## Сценарий 8

Статус: pass.

Новая диагностика работает на локальной БД и не зависит от локальная складская подсистема.

Проверено по коду:

- Новый API находится в `src/app/api/diagnostics/**`.
- Бизнес-логика находится в `src/lib/diagnostic-map-service.ts`.
- Новый API не использует `DiagnosticOffer`, old offer templates или LocalInventory.
- Рекомендации добавляются в локальные позиции отгрузки из конкретного пункта.

## Сценарий 9

Статус: pass.

Старые файлы диагностики больше не используются в новом пользовательском
сценарии.

Проверено по коду:

- `src/components/diagnostic/DiagnosticModal.tsx` помечен как legacy.
- `src/data/diagnostic-catalog.ts` помечен как legacy.
- `src/app/api/diagnostic/LEGACY.md` фиксирует старый namespace как fallback.
- Shipment-экраны и новый диагностический модуль не импортируют старый
  `DiagnosticModal` и старый каталог.

## Итог

Новая диагностика заменяет старый пользовательский сценарий: используется карта
диагностики, быстрый экран заполнения, новые статусы, готовые формулировки, фото
с подписями, новая сводка, новый публичный отчет и новая печать.

Legacy-слой остается только для старых данных и старых публичных ссылок согласно
`diagnostic-migration-plan.md`.
