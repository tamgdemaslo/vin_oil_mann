# ROUTE_MIGRATION_MAP

Это проект миграции, а не разрешение менять routes. Базовая стратегия: **сначала меняются labels и канонические входы, затем при необходимости URL; все старые deep links получают server redirect и измеряются минимум 90 дней**.

## Статусы

- **KEEP** — route остаётся каноническим.
- **RELABEL** — URL пока остаётся, меняются положение и label.
- **NEW** — понадобится новый route после отдельного согласования.
- **REDIRECT** — старый route сохраняется как совместимый redirect.
- **MERGE** — функциональность объединяется; старый route становится redirect.
- **INTERNAL** — не показывается обычным пользователям, доступ по capability.
- **PUBLIC** — вне внутренней навигации.

## Сводная карта текущих и новых мест

| Текущий маршрут | Текущее место | Новое место | Переименование | Действие |
|---|---|---|---|---|
| `/`, `/owner` | Главная | Главное | «Главная» → «Главное» | KEEP/RELABEL |
| `/shipment*` | Операции | Работа → Отгрузки | «Все отгрузки» → «Отгрузки» | KEEP |
| `/records` | CRM | Работа → Записи | оставить «Записи», YCLIENTS — подпись | KEEP |
| `/crm` | CRM | Клиенты → Дела | «CRM/Дела клиентов» → «Дела» | KEEP/RELABEL |
| `/messages` | CRM и иконка | Клиенты → Сообщения и иконка | «Сообщения» | KEEP |
| `/clients/counterparties` | CRM → Контрагенты | Клиенты → Клиенты; Склад → Поставщики | «Контрагенты» → task-based представления | KEEP/RELABEL |
| `/cabinet/customer-analytics` | Кабинет и меню пользователя | Клиенты → Аналитика | «Аналитика клиентов» | RELABEL, затем redirect при новом URL |
| `/inventory/products`, `/inventory/receipts`, `/inventory/writeoffs`, `/inventory/restock` | Склад | Склад | уточнить journal plurals | KEEP |
| `/warehouse/inventory*` | Склад | Склад → Инвентаризации | singular → plural для журнала | KEEP |
| `/warehouse/product-analytics` | Склад | Склад → Аналитика | локально «Аналитика товаров» | KEEP |
| `/finance`, `/cash`, `/finance/invoices`, `/finance/profit` | Финансы | Финансы | «Финансовый центр» → «Финансовый обзор»; «Цены и прибыль» → «Рентабельность» | KEEP/RELABEL |
| `/salary` | Финансы | Финансы → Зарплата команды; пользователь → Моя зарплата | два контекстных label | KEEP |
| `/ai-assistant` | ИИ-помощник | ИИ-помощник | «Рабочий чат» | KEEP |
| `/cabinet` | Кабинет | меню пользователя → Мой профиль | убрать «Кабинет» | RELABEL; опционально новый `/profile` |
| `/cabinet/branches` | Кабинет | Управление → Филиалы | без «Кабинета» | RELABEL; новый detail route |
| `/cabinet/organizations` | скрытая карточка Кабинета | Управление → Юридические лица | «Организации» → «Юридические лица» | RELABEL/REDIRECT |
| `/cabinet/notifications` | скрытая карточка Кабинета | Управление → Клиентские коммуникации | «Уведомления клиентам» → «Клиентские коммуникации» | RELABEL/REDIRECT |
| `/cabinet/integrations` | Кабинет | Управление → Интеграции | сохранить label | RELABEL/REDIRECT |
| `/cabinet/integrations/messenger` | Кабинет/Интеграции | Управление → Каналы связи → Рабочий Telegram | «Мессенджеры» → «Рабочий Telegram» | RELABEL/REDIRECT |
| `/cabinet/ai-assistant*` | ИИ и Кабинет | Управление → ИИ и автоматизация | уточнить системный уровень | RELABEL/REDIRECT |
| legacy aliases из раздела ниже | прямые/старые ссылки | соответствующий канонический route | убрать из пользовательских labels | REDIRECT/MERGE |
| `/client-site`, `/report/[token]*`, `/login` | публично / без shell | вне внутренней IA | без изменения | PUBLIC/KEEP |

## Канонические рабочие routes

| Сейчас | Целевой вход / возможный URL | Статус | Что меняется | Совместимость |
|---|---|---|---|---|
| `/` | Главное → Сводка филиала | KEEP | прямой пункт без обязательного dropdown | без изменений |
| `/owner` | Главное → Все филиалы | KEEP | становится полноценным read-only scope | без изменений |
| `/shipment` | Работа → Отгрузки | KEEP | перенос раздела/label | без изменений |
| `/shipment/new` | action «Новая отгрузка» | KEEP | убрать из постоянного submenu, оставить quick action | без изменений |
| `/shipment/[id]` | Отгрузки → Карточка | KEEP | breadcrumbs | без изменений |
| `/shipment/[id]/edit` | Карточка → Редактировать | KEEP | только локальная IA | без изменений |
| `/shipment/[id]/precheck` | Карточка → Диагностика/предчек | KEEP | уточнить label | без изменений |
| `/shipment/[id]/closing` | Карточка → Закрытие | KEEP | добавить route title/breadcrumb | без изменений |
| `/shipment/[id]/poster` | Карточка → Печать постера | KEEP | остаётся без shell | без изменений |
| `/shipment/[id]/tags` | Карточка → Печать бирок | KEEP | остаётся без shell | без изменений |
| `/records` | Работа → Записи | KEEP | убрать связь permission с кассой | без изменений |
| `/crm` | Клиенты → Дела | RELABEL | URL можно сохранить надолго | deep links без изменений |
| `/messages` | Клиенты → Сообщения | KEEP | доступ по capability, быстрый icon entry | без изменений |
| `/notifications` | меню пользователя → Мои уведомления | RELABEL | различить personal inbox и client automation | без изменений |
| `/clients/counterparties` | Клиенты → Клиенты; Склад → Поставщики | RELABEL | route временно общий, UI получает type views | query/состояние совместимы |
| `/inventory/products` | Склад → Товары | KEEP | нет структурной миграции | без изменений |
| `/inventory/receipts` | Склад → Приёмка | KEEP | нет структурной миграции | без изменений |
| `/inventory/writeoffs` | Склад → Корректировки | KEEP | канонический route | без изменений |
| `/inventory/restock` | Склад → Пополнение | KEEP | объединить входы supply/restock | без изменений |
| `/warehouse/inventory` | Склад → Инвентаризации | KEEP | plural label для журнала | без изменений |
| `/warehouse/inventory/[id]` | Инвентаризации → Карточка | KEEP | breadcrumbs | без изменений |
| `/warehouse/product-analytics` | Склад → Аналитика | KEEP | новая внутренняя группировка вкладок | прежние tab query сохраняются |
| `/finance` | Финансы → Обзор | KEEP | второй уровень «Обзор/Учёт/Обязательства/Отчёты» | прежние tab query перенаправляются на соответствующую группу |
| `/finance/invoices` | Финансы → Счета поставщиков | KEEP | cross-link из Приёмки | без изменений |
| `/finance/profit` | Финансы → Рентабельность | RELABEL | устранить конкуренцию «прибыль/цены» | без изменений |
| `/cash` | Финансы → Касса | KEEP | capabilities на действиях | без изменений |
| `/salary` | Финансы → Зарплата команды и меню пользователя → Моя зарплата | KEEP | один route, два режима/entry | `?view=mine` или server-resolved default без ломки старых ссылок |
| `/ai-assistant` | ИИ-помощник → Рабочий чат | KEEP | role/capability и all-branches read-only | без изменений |

## Управление и персональные routes

| Сейчас | Целевой вход / возможный URL | Статус | Что меняется | Совместимость |
|---|---|---|---|---|
| `/cabinet` | меню пользователя → Мой профиль; в будущем `/profile` | RELABEL | убрать системные карточки, оставить личное | `/cabinet` сначала канонический; после нового route — redirect |
| блок пароля в `/cabinet` | `/profile/security` | NEW | самостоятельный personal screen/section | старая anchor-ссылка ведёт в новый экран |
| Telegram сотрудника в `/cabinet` | `/profile/telegram` | NEW | рабочая личная привязка | старый card link получает redirect/cross-link |
| personal salary mode `/salary` | `/profile/salary` или `/salary?view=mine` | NEW/KEEP | отдельный персональный вход без shift lock | `/salary` продолжает работать |
| `/cabinet/branches` | Управление → Филиалы; в будущем `/management/branches` | RELABEL | список и создание остаются, появляется карточка | старый route сначала канонический, затем redirect |
| — | `/management/branches/[branchId]` | NEW | основное, режим, сотрудники, склад/касса, каналы, связи | route использует id, старых ссылок нет |
| — | `/management/employees` | NEW | общий реестр сотрудников/членств | карточка branch даёт filtered deep link |
| — | `/management/access` | NEW | роли, capabilities, приглашения | отдельное согласование security model |
| `/cabinet/organizations` | Управление → Юридические лица; в будущем `/management/legal-entities` | RELABEL | пользовательский термин и новый раздел | старый route redirect после миграции |
| `/cabinet/customer-analytics` | Клиенты → Аналитика; в будущем `/clients/analytics` | RELABEL | убирается из Cabinet/profile | старый route redirect только после переноса state/query |
| `/cabinet/notifications` | Управление → Клиентские коммуникации; в будущем `/management/client-communications` | RELABEL | branch data вынести; tabs сохранить | старый route redirect с сохранением `tab` |
| `/cabinet/integrations` | Управление → Интеграции; в будущем `/management/integrations` | RELABEL | каталог интеграций вместо смешанной страницы | старый route redirect |
| `/cabinet/integrations/messenger` | Управление → Каналы связи → Рабочий Telegram; `/management/channels/telegram` | RELABEL | не называть ежедневным мессенджером | старый route redirect |
| `/cabinet/ai-assistant` | Управление → ИИ и автоматизация; `/management/automation/ai` | RELABEL | убрать дубль верхнего AI | старый route redirect |
| `/cabinet/ai-assistant/pricing` | `/management/automation/ai/pricing` | RELABEL | дочерняя AI setting | старый route redirect |
| `/inventory/products/audit` | Управление → Служебные инструменты → Аудит товаров | INTERNAL | скрыть от обычных ролей, capability | URL можно оставить |
| `/inventory/integrations/mann-pdf` | Управление → Интеграции → Каталоги → MANN | INTERNAL/RELABEL | owner техпроцесса и понятный статус | старый route redirect только при новом URL |

## Уже существующие legacy routes

| Route | Сейчас | Целевое действие | Каноническая цель |
|---|---|---|---|
| `/dashboard` | redirect | REDIRECT, измерять трафик | `/` |
| `/clients` | redirect на записи | изменить семантику только после появления реестра клиентов | `/clients/counterparties` или новый `/clients` |
| `/crm/ai-agent` | redirect | REDIRECT | `/ai-assistant` |
| `/crm/messages` | redirect | REDIRECT | `/messages` |
| `/inventory` | redirect | REDIRECT | `/inventory/products` |
| `/inventory/counterparties` | redirect | REDIRECT | `/clients/counterparties` |
| `/inventory/profit` | redirect | REDIRECT | `/finance/profit` |
| `/warehouse/adjustments` | дубль страницы | заменить на явный REDIRECT | `/inventory/writeoffs` |
| `/operations/restock` | redirect | REDIRECT | `/inventory/restock` |
| `/operations/supply` | отдельный скрытый flow | MERGE после функционального diff | `/inventory/restock` |
| `/finance/shifts` | redirect | REDIRECT с query | `/salary?tab=workdays` |
| `/cabinet/salary` | redirect | REDIRECT | `/salary` или personal mode |
| `/cabinet/shifts` | redirect | REDIRECT с query | `/salary?tab=workdays` |
| `/cabinet/analytics` | redirect на зарплату | REDIRECT; убрать вводящее в заблуждение имя из UI/docs | `/salary` |
| `/cabinet/ai-agent` | redirect | REDIRECT; dead client удалить отдельной задачей | `/cabinet/ai-assistant` |
| `/cabinet/vehicles` | redirect на Cabinet | исправить только когда определена каноническая карточка авто | будущий `/clients/vehicles` |
| `/cabinet/penalties` | скрытая отдельная страница | MERGE | `/salary?tab=adjustments` или `motivation` |

## Публичные и shell-less routes

| Route | Статус | Решение |
|---|---|---|
| `/login` | PUBLIC/AUTH | оставить вне внутренней IA |
| `/client-site` | PUBLIC | оставить вне shell; долгосрочно возможно отдельное приложение/домен, но аудит этого не требует |
| `/report/[token]` | PUBLIC TOKEN | оставить; безопасность token отдельно от internal roles |
| `/report/[token]/print` | PUBLIC TOKEN | оставить без shell |

## Порядок route-миграции

1. **Нулевая фаза:** завести реестр route metadata: canonical URL, label, section, level, capability, branch-scope, shell mode.
2. **Без смены URL:** изменить меню/labels и удалить дублирующие глобальные входы; включить аналитику кликов и 404/redirect.
3. **Новые недостающие routes:** profile security/Telegram, branch detail/employees/access. Старые экраны пока живут параллельно только там, где нет конфликтующих записей.
4. **Redirect phase:** перенести management URLs и настроить permanent redirect лишь после проверки query/deep-link сохранения.
5. **Cleanup:** через 90 дней без значимого трафика удалить dead UI и устаревшую route-документацию; redirects можно сохранять дольше практически бесплатно.

## Требования к deep links

- сохранять pathname, значимые query (`tab`, фильтры, выбранный период) и fragment, если целевой экран поддерживает эквивалент;
- не redirect недоступную страницу молча на `/`; показывать 403 с объяснением и действием «Запросить доступ/сменить филиал»;
- динамические document/report routes не переименовывать в рамках IA-рефакторинга;
- добавлять contract tests для каждой строки со статусом REDIRECT/MERGE;
- логировать старый route, цель, роль и branch mode без секретов/PII.
