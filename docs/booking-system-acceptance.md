# Приёмка собственной системы записи

## Автоматически проверено локально

- `npm run test:booking-system` — timezone/DST, secure token, несколько услуг, несколько мастеров, компетенции, выходной, исключение, занятый длинный интервал, скрытые услуги/филиал и cutover guards.
- `npm run test:branch-isolation` — branch scope policy и production guards.
- `node scripts/test-navigation-ia.mjs` — 15/15 сценариев.
- `npx tsc --noEmit`.
- прицельный ESLint новых/изменённых модулей — без замечаний; полный `npm run lint` — 0 ошибок (25 существующих предупреждений вне системы записи).
- `npx prisma validate` с синтаксически корректным placeholder URL.
- production build (`npm run build`) — успешно.
- `npm run check:timeweb-only` — PASS.

## Требует migrated test/production-like PostgreSQL

Следующие проверки нельзя честно закрыть без применения новой forward migration к отдельной БД:

1. Два параллельных create на один master/time: одна запись успешна, вторая получает `booking_slot_taken`.
2. Транзакционный override доступен только пользователю с capability и фиксируется в audit.
3. Создание/перенос/отмена освобождают и занимают интервалы на реальных индексах PostgreSQL.
4. Existing client lookup, несколько автомобилей и новый автомобиль сохраняются в общей CRM.
5. Public booking мгновенно виден в существующем журнале; drag-and-drop использует ту же строку `Booking`.
6. Уведомления реально доставляются по подключённому каналу филиала.
7. Идемпотентный импорт сохраняет всю историю Yclients без дублей.
8. Сводный режим владельца не смешивает права изменения филиалов.

Production backup и migration в рамках реализации не выполнялись. Порядок приёмки описан в `docs/booking-system-cutover.md`.
