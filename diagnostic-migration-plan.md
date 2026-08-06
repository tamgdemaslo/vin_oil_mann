# Diagnostic Migration Plan

## Решение

Выбран безопасный вариант A.

Старые диагностики остаются legacy-данными. Новые диагностики создаются только в
новой схеме `DiagnosticMapSession`, `DiagnosticMapItem`, `DiagnosticMapPhoto` и
`DiagnosticMapRecommendationAction`.

Старые таблицы `Diagnostic`, `DiagnosticPosition`, `DiagnosticPhoto` и
`DiagnosticOffer` не удаляются на этом этапе. Удаление возможно только отдельной
задачей после backup, проверки истории и подтверждения, что старые публичные
ссылки больше не нужны или полностью мигрированы.

## Текущее поведение

- Новый пользовательский сценарий работает через `/api/diagnostics/**`.
- Новый экран заполнения создает записи новой диагностической карты.
- Новый публичный маршрут `/report/[token]` сначала ищет новую диагностику.
- Если новый token не найден, `/report/[token]` использует legacy fallback через
  `/api/diagnostic/public/[token]`.
- Legacy fallback адаптирует старые `GREEN`, `YELLOW`, `RED` в клиентские статусы
  нового отчета и не показывает клиенту внутренние id/raw-коды.

## Что нельзя делать без отдельной миграционной задачи

- Нельзя удалять старые Prisma-модели диагностики.
- Нельзя дропать таблицы `diagnostics`, `diagnostic_positions`,
  `diagnostic_photos`, `diagnostic_offers`.
- Нельзя удалять старые файлы фото.
- Нельзя отключать `/api/diagnostic/public/[token]`, пока есть шанс, что ссылка
  уже была выдана клиенту.
- Нельзя переписывать старые записи в новую схему без backup.

## Future Option B

Если позже потребуется полная миграция старых диагностик в новую карту, делать
это отдельным скриптом/миграцией после backup.

Предлагаемая карта статусов:

- `GREEN` -> `normal`
- `YELLOW` -> `attention`
- `RED` -> `replace`
- `SKIPPED` -> `skipped`
- `NOT_CHECKED` -> `unchecked`

Предлагаемая карта полей:

- `Diagnostic.shipmentLocalInventoryId` -> только legacy-reference, не переносить как
  зависимость нового API.
- `DiagnosticPosition.block` -> `DiagnosticMapItem.blockCode` с человекочитаемым
  snapshot title из нового каталога.
- `DiagnosticPosition.node` -> `DiagnosticMapItem.itemCode`.
- `DiagnosticPosition.tags` -> человекочитаемые комментарии/labels. Технические
  tag-коды не показывать клиенту.
- `DiagnosticPosition.notes` -> `DiagnosticMapItem.customComment`.
- `DiagnosticPosition.recommendation` -> `DiagnosticMapItem.customRecommendation`.
- `DiagnosticPhoto.caption` -> `DiagnosticMapPhoto.caption`.
- `DiagnosticOffer` -> не переносить один в один; при необходимости создать
  recommendation actions из конкретных рекомендаций.

## Критерий готовности к удалению legacy

Legacy можно удалять только когда выполнены все пункты:

- сделан backup старых таблиц и файлов фото;
- посчитано количество старых диагностик и публичных token;
- принято решение по старым клиентским ссылкам;
- миграционный скрипт, если нужен, прогнан на копии базы;
- новые отчеты проверены на выборке старых данных;
- есть отдельное подтверждение на удаление legacy.
