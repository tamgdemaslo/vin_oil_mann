# Собственная система записи: Timeweb cutover

Статус: код и forward migration подготовлены; production backup, migration и импорт архива не выполнялись.

## Источник истины после переключения

- Каноническая запись: `Booking` + `BookingServiceItem`.
- Публичная форма, внутренний журнал, Messenger и ИИ-агент вызывают один availability service и одни транзакционные команды.
- `Yclients` остаётся только read-only источником одноразового импорта истории.
- `POST`, `PUT` и `DELETE /api/yclients` возвращают `410`; обратной синхронизации нет.
- Старые строки помечаются `source=LEGACY_YCLIENTS` и не удаляются.

## Обязательный gate

До любого production-действия:

1. Выполнить `npm run check:timeweb-only`.
2. Создать полную резервную копию PostgreSQL в Timeweb.
3. Проверить возможность чтения/восстановления копии и зафиксировать ID, время, размер, checksum и ответственного.
4. Отдельно согласовать окно обслуживания и применение миграции `20260816120000_internal_booking_system`.
5. Добавить в Timeweb runtime длинный случайный `BOOKING_MANAGEMENT_TOKEN_SECRET`; не выводить его в логи.

Без подтверждённого backup миграцию не запускать. Старт приложения миграции не применяет.

## До миграции

```bash
npm run check:timeweb-only
npm run test:booking-system
npm run test:branch-isolation
node scripts/test-navigation-ia.mjs
npx tsc --noEmit
DATABASE_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder' npx prisma validate
```

Проверить в Timeweb переменные:

- `DEPLOYMENT_PROVIDER=timeweb`;
- `DATABASE_URL`;
- `APP_ORIGIN` и `NEXT_PUBLIC_APP_ORIGIN`;
- `SESSION_SECRET`;
- `BOOKING_MANAGEMENT_TOKEN_SECRET`;
- `NEXT_PUBLIC_BOOKING_URL=/booking`;
- при необходимости `PUBLIC_BOOKING_READ_LIMIT_PER_HOUR` и `PUBLIC_BOOKING_WRITE_LIMIT_PER_HOUR`.

## Применение в согласованном окне

1. Остановить пользовательские операции записи на время короткого окна.
2. Ещё раз сверить идентификатор подтверждённой Timeweb-копии.
3. Применить forward migration отдельной одобренной операцией:

   ```bash
   npm run db:deploy
   ```

4. Выпустить версию приложения и проверить `GET /api/health/live`, затем `GET /api/health/ready`.
5. В каждом филиале открыть `Управление → Система записи` и до публикации настроить:
   - недельные часы филиала;
   - услуги, длительность, порядок и онлайн-доступность;
   - `requiresVin` и `requiresConfirmation` для АКПП;
   - услуги и графики мастеров;
   - исключения расписания.
6. Оставить `publicBookingEnabled=false`, пока внутренний smoke-check не пройден.

## Импорт истории

В каждом филиале открыть блок `Архив Yclients`, выбрать начальную дату и запустить импорт.

- Импорт read-only относительно Yclients.
- Уникальность `(branchId, legacyExternalId)` исключает дубли.
- Прогресс страницы хранится в `branch_integration_migrations`; прерванный запуск продолжает со следующей полностью обработанной страницы.
- Несопоставленный по имени мастер остаётся в колонке `Архив Yclients`.
- После импорта сравнить количество и крайние даты с последним архивным отчётом Yclients.

Контрольные SQL-запросы выполнять только через одобренный доступ Timeweb:

```sql
SELECT branch_id, source, count(*)
FROM bookings
GROUP BY branch_id, source
ORDER BY branch_id, source;

SELECT branch_id, min(starts_at), max(starts_at), count(*)
FROM bookings
WHERE source = 'LEGACY_YCLIENTS'
GROUP BY branch_id;

SELECT branch_id, legacy_external_id, count(*)
FROM bookings
WHERE legacy_external_id IS NOT NULL
GROUP BY branch_id, legacy_external_id
HAVING count(*) > 1;
```

Последний запрос должен вернуть ноль строк.

## Smoke-check перед публикацией

Для каждого филиала:

1. Создать внутреннюю запись и проверить её в журнале.
2. Перетащить запись на свободное время и к другому допустимому мастеру.
3. Проверить предупреждение конфликта и capability для override.
4. В тестовой онлайн-услуге пройти `/booking`, открыть secure management link, перенести и отменить запись.
5. Убедиться, что обычная услуга не требует VIN.
6. Убедиться, что АКПП требует VIN, создаётся как `PENDING`, занимает слот и подтверждается администратором.
7. Проверить уведомления о создании, переносе, отмене и подтверждении.
8. Проверить историю отгрузок по телефону в карточке записи.
9. В режиме владельца `Все филиалы` проверить сводный журнал и фильтр филиала.
10. Под двумя параллельными запросами на один слот получить ровно одну запись и один `booking_slot_taken`.

После успешной проверки включить `publicBookingEnabled` у нужных филиалов.

## Переключение ссылок

Заменить публичную ссылку на `/booking` на сайте, картах, в соцсетях, Telegram и остальных каналах. После проверки входящего трафика отключить создание новых записей в кабинете Yclients. Не включать двустороннюю синхронизацию.

## Наблюдение первой недели

Ежедневно проверять:

- ошибки `booking_slot_taken` и неожиданные 5xx;
- pending-записи АКПП без реакции администратора;
- доставку уведомлений;
- записи без мастера/услуг/автомобиля;
- расхождения локальной даты и времени филиала;
- обращения клиентов по management link.

## Rollback

Миграция forward-only и не удаляет историю. При проблеме:

1. Сразу выключить `publicBookingEnabled` у филиалов.
2. Оставить таблицы и импортированную историю на месте.
3. Откатить версию приложения штатным механизмом Timeweb только после оценки совместимости схемы.
4. Продолжить ручную внутреннюю запись; не включать обратную синхронизацию новых записей в Yclients.
5. Восстановление всей БД из backup выполнять только при подтверждённом повреждении данных и отдельном согласовании.
