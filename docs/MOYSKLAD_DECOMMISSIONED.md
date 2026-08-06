# «МойСклад» выведен из эксплуатации

Дата деактивации кода: 2026-08-06.

Собственная PostgreSQL Эко-платформы в Timeweb является единственным
источником истины для товаров, клиентов, контрагентов, отгрузок, остатков,
цен, кассовых операций и документов. Повторное подключение «МойСклад»
запрещено без отдельного архитектурного решения и согласованного плана
миграции.

В этой рабочей ветке удалены UI, маршруты, клиент API, фоновые синхронизации,
переменные окружения и runtime-модель прежней интеграции. Бизнес-данные в
PostgreSQL не удалялись. Forward-only migration создана с обязательным
`migration_approval_required` gate; в production ничего не развёртывалось и
миграции не запускались.

Commit удаления: не создан — изменения остаются непубликуемой рабочей
веткой до проверки и отдельного решения владельца.

## Ручное завершение

В Timeweb App Platform и GitHub Secrets/Variables удалить только следующие
имена переменных, если они существуют (значения не просматривать и не
выводить):

- `MOYSKLAD_TOKEN`, `MOYSKLAD_ACCESS_TOKEN`, `MOYSKLAD_API_TOKEN`
- `MOYSKLAD_WEBHOOK_SECRET`, `MOYSKLAD_ACCOUNT_ID`
- `MOYSKLAD_LOGIN`, `MOYSKLAD_PASSWORD`, `MOYSKLAD_PREFER_BEARER`
- `MOYSKLAD_ENABLED`, `MOYSKLAD_READ_ENABLED`, `MOYSKLAD_WRITE_ENABLED`, `MOYSKLAD_SYNC_ENABLED`, `MOYSKLAD_DEBUG_ENABLED`
- `NEXT_PUBLIC_MOYSKLAD_DEBUG_ENABLED`
- `MOYSKLAD_TIMEOUT_MS`, `MOYSKLAD_LOOKUP_STOCK_CACHE_MS`, `MOYSKLAD_LOOKUP_OIL_CACHE_MS`
- `MOYSKLAD_PAYROLL_FETCH_ATTEMPTS`, `MOYSKLAD_PAYROLL_MIN_INTERVAL_MS`
- `MOYSKLAD_DEMAND_PLATE_ATTRIBUTE_ID`, `MOYSKLAD_ATTR_SAE`, `MOYSKLAD_ATTR_OEM`, `MOYSKLAD_ATTR_ACEA`, `MOYSKLAD_ATTR_API`, `MOYSKLAD_ATTR_ILSAC`, `MOYSKLAD_ATTR_VOLUME`, `MOYSKLAD_ATTR_CATEGORY`

После подтверждённого развёртывания удалить webhook-подписки на стороне
провайдера и отозвать его API-токен. Выполнять эти внешние действия следует
только после проверки, что сотрудники используют актуальный URL Timeweb и
что входящие вызовы больше не поступают.
