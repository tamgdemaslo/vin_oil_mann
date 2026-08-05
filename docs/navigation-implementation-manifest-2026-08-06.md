# Navigation implementation manifest — 06.08.2026

Scope: только этап 0 и этап 1 утверждённой IA. Существующие рабочие URL сохраняются. Новых Prisma-моделей и migrations нет.

## Компоненты и server policy

| Файл/поверхность | Изменение |
|---|---|
| `src/lib/navigation-policy.mjs` | новый централизованный `resolveNavigationForUser(...)`: видимые разделы/подразделы, personal menu, management actions и all-branches |
| `src/lib/branch-context.ts` | передача фактической роли/permissions активного BranchMembership; branch owner/administrator и явные permissions получают управление своей точкой |
| `src/app/api/auth/session/route.ts` | возвращает готовую navigation policy; shell больше не собирает меню по разрозненным `owner/admin/master` |
| `src/components/platform/PlatformShell.tsx` | семь утверждённых групп, personal menu, служебные действия branch switcher, сгруппированное mobile menu |
| `src/app/globals.css` | стили grouped mobile, management cards, personal tabs и branch workspace |

## Критичные сценарии

| Сценарий | Изменение | Существующие сущности/API |
|---|---|---|
| Редактирование филиала | список филиалов становится master-detail; вкладки «Основное», «Сотрудники», «Каналы связи» | `Branch`, `BranchCommunicationSettings`, `LocalOrganization`, `GET/PATCH /api/branches/[branchId]`, archive endpoint |
| Связанная организация | выбор существующего юрлица отдельно от полей физической точки | `Branch.legacyOrganizationId`, `/api/organizations` |
| Сотрудники филиала | назначение существующего пользователя, роль, смена роли, отключение доступа | `User`, `BranchMembership`, существующие members APIs |
| Приглашение | не показывается как фиктивный placeholder: текущая auth-модель поддерживает только уже настроенных `AUTH_USERS` | реальный invite/accept flow потребовал бы новый auth onboarding; он остаётся за пределами этапа |
| Личный Telegram | personal POST генерирует ссылку/QR; disconnect отключает только employee connection | существующие messenger tables и `/api/cabinet/telegram-link` |
| Рабочий Telegram | отдельный вход «Управление → Каналы связи» | существующий `/cabinet/integrations/messenger` |

## Страницы и точки входа

| Поверхность | Действие |
|---|---|
| `/cabinet` | только personal tabs: «Мой профиль», «Безопасность», «Мой Telegram», «Доступные филиалы» |
| `/management` | новая route-обёртка с группами и ссылками на существующие страницы; новые реализации модулей не создаются |
| `/cabinet/branches` | сохраняется; получает рабочее редактирование и members UI |
| `/cabinet/organizations` | сохраняется; вход переносится в Управление |
| `/cabinet/integrations` | сохраняется; визуальные группы «Финансы», «Учёт и склад», «Система» |
| `/cabinet/integrations/messenger` | сохраняется; label «Каналы связи / Рабочий Telegram филиала» |
| `/cabinet/notifications` | сохраняется; вход «Управление → Уведомления клиентам» |
| `/cabinet/customer-analytics` | сохраняется; единственный глобальный вход «Клиенты → Аналитика клиентов» |
| `/cabinet/ai-assistant` | сохраняется; только «Управление → Настройки ИИ», не personal menu |

## Переименования без смены URL

- «Главная» → «Главное».
- «Операции» → «Работа».
- «CRM» → «Клиенты».
- «Кабинет» удаляется из top navigation.
- «Мессенджеры» для настроек → «Каналы связи».
- Рабочий модуль `/messages` остаётся «Сообщения».
- `/cabinet` в personal menu называется «Мой профиль».

## Дубли, которые устраняются из глобального меню

- аналитика клиентов — убирается из personal/Cabinet, остаётся в «Клиенты»;
- настройки ИИ — убираются из рабочего AI submenu и personal/Cabinet, остаются в «Управление»;
- филиалы, организации, интеграции и каналы — только в «Управление»;
- одна и та же приёмка/отгрузка не дублируется под разными labels.

## Routes

- Все существующие routes остаются доступными.
- Единственный новый route: `/management`, только агрегатор ссылок.
- Branch detail реализуется на `/cabinet/branches` через query `branch`/`tab`, без второго раздела филиалов.
- Personal tabs используют `/cabinet?tab=...`, без копий страниц.

## Проверка

- `scripts/test-navigation-ia.mjs`: 15 регрессионных условий из постановки, включая роли, разделение Telegram, старые routes и grouped mobile.
- TypeScript без emit.
- ESLint только изменённых файлов.
- Prisma schema checksum до/после; migrations directory не меняется.
- Локальный production build не запускается; единственный полный build — GitHub Actions после чистого commit.
