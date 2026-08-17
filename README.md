# VIN → Масло и фильтры Mann

Для быстрого знакомства нового разработчика с проектом см. [ONBOARDING.md](ONBOARDING.md).

- **Номера фильтров (OEM)** — [Parts API](https://partsapi.ru) по VIN: масляный, воздушный, салонный (группы 7, 8, 9).
- **локальная складская подсистема** — поиск по OEM и вывод наличия (опционально).

## Запуск

```bash
npm install
cp .env.local.template .env.local
# Проверьте DATABASE_URL и заполните нужные ключи интеграций
npm run dev
```

Откройте **http://127.0.0.1:3000**, введите VIN и нажмите «Найти».

### Если не открывается

1. Запуск из папки проекта: `npm run dev`.
2. В браузере: **http://127.0.0.1:3000**.
3. Если порт занят: `PORT=3001 npm run dev` → http://127.0.0.1:3001.

## Переменные окружения

| Переменная        | Описание |
|-------------------|----------|
| `PARTS_CATALOGS_API_KEY` | Ключ [Parts Catalogs API](https://api.parts-catalogs.com) (как в проекте «vin pin») — подбор фильтров по VIN. |
| `LOCAL_INVENTORY_LOGIN`  | Опционально. Логин локальная складская подсистема — поиск по OEM и таблица: название, артикул, цена, количество, склад, ячейка. |
| `LOCAL_INVENTORY_PASSWORD` | Пароль локальная складская подсистема (в паре с логином). |
| `MESSENGER_CREDENTIAL_ENCRYPTION_KEY` | Master-key для зашифрованных филиальных секретов интеграций. Сами реквизиты AQSI, Telegram и ROSSKO задаются в «Управление → Интеграции». |

## Смены и зарплата

- **Сотрудники и роли:** новых сотрудников создаёт владелец в «Управление → Филиалы → Сотрудники»; учётная запись и временный PIN-код сохраняются в БД. `AUTH_USERS` остаётся источником базовых/исторических аккаунтов (`логин:пароль:имя:роль`).
- **БД:** PostgreSQL. В `.env.local` укажите `DATABASE_URL=postgresql://...`. После этого выполните:
  ```bash
  npx prisma db push
  ```
- **Смены:** в личном кабинете кнопки «Я на смене» / «Смена окончена». Один раз в сутки. Штраф за опоздание (500 ₽ за каждые 5 мин, макс 1500 ₽). Если смена не закрыта до 00:00 — автозакрытие и штраф 300 ₽.
- **Автозакрытие смен:** каждый день в 00:05 (по серверу) вызывается `GET /api/cron/auto-close-shifts`. На Vercel используется cron из `vercel.json`. Локально можно вызывать вручную: `GET /api/cron/auto-close-shifts?secret=ВАШ_CRON_SECRET` или заголовок `Authorization: Bearer ВАШ_CRON_SECRET`. Задайте `CRON_SECRET` в окружении.
- **Зарплата:** расчёт на лету по API локальная складская подсистема (отгрузки за период). Отгрузка за день относится всем, кто был на смене в этот день. Ставка смены задаётся владельцем в разделе «Аналитика»; бонусы и штрафы — в «Бонусы и штрафы» (создание/редактирование/удаление только владельцем).

## Локальное складское зеркало

Первый шаг ухода от постоянной работы через API локальная складская подсистема — импорт складских данных в PostgreSQL.

- Примените схему: `npm run db:push`.
- Запустите импорт авторизованным владельцем/администратором: `POST /api/local-inventory/sync`.
- Статус импорта: `GET /api/local-inventory/sync`.
- После успешного импорта включите `LOCAL_INVENTORY_READS=1`: товары, контрагенты и список отгрузок начнут читаться из локальной БД с fallback на локальная складская подсистема.
- После проверки можно включить `LOCAL_INVENTORY_WRITES=1`: создание, редактирование, копирование и удаление отгрузок будут работать в локальной БД, а остатки будут списываться/возвращаться локально.

По умолчанию импортируются все товары, услуги, контрагенты, склады, остатки и последние 200 отгрузок. Для полного импорта отгрузок передайте `{ "fullDemands": true }`.

## Публичный API для клиентского сайта

Отдельный клиентский фронт может работать через `/api/public/*` без `eco_session`.

- `GET /api/public/oils` — публичный каталог моторных масел из локальной БД.
- `POST /api/public/vin-oil` — VIN-подбор масла с рекомендациями из локального складского зеркала.
- `POST /api/public/leads` — заявка клиента, создаёт сделку CRM в стадии «Новый лид» с источником `client-site`.

Локальная демо-страница клиентского сайта доступна по `/client-site`.

Перед деплоем задайте `PUBLIC_CLIENT_ORIGINS` доменом клиентского сайта. VIN-подбор и заявки ограничиваются по IP через `PUBLIC_API_VIN_LIMIT_PER_HOUR` и `PUBLIC_API_LEAD_LIMIT_PER_HOUR`; v1 rate-limit хранится в памяти процесса.

## Сборка

```bash
npm run build
npm start
```

## Production deployment

Production runs only on Timeweb Cloud App Platform. Timeweb deploys the `main`
branch from the root `Dockerfile`; GitHub Actions verify committed source only.
Set runtime secrets, including `OPENAI_API_KEY`, only in Timeweb. Application
startup must never apply Prisma migrations: take and verify a Timeweb database
backup, then run an explicitly approved migration operation. See
[`deploy/timeweb/README.md`](deploy/timeweb/README.md).
