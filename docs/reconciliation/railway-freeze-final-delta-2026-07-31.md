# Railway freeze and final delta — 2026-07-31

Текущий статус после завершения owner review 2026-08-01:
**`RAILWAY_FROZEN_OWNER_REVIEW_COMPLETE_LOCAL_REHEARSAL_REQUIRED`**.

Production import, Selectel deploy, Selectel database migration, Branch 2, DNS,
webhooks и production env не изменялись.

## Граница freeze

- Selectel preflight: `2026-07-31T19:11:31Z`.
- Pre-freeze snapshot фактической legacy application DB: `2026-07-31T19:16:20.620105Z`.
- `railwayComputeStoppedAt`: `2026-07-31T19:20:08Z`.
- `railwayWriteFreezeAt`: `2026-07-31T19:20:08Z`.
- Immediate post-freeze snapshot: `2026-07-31T19:20:12.042956Z`.
- Второй post-freeze snapshot: `2026-07-31T19:36:49.724858Z`.
- T+60 snapshot: `2026-07-31T20:23:28.757553Z`.
- `railwayWriteFreezeConfirmedAt`: `2026-07-31T20:23:28.757553Z`.
- `freezeVerificationStatus`: `CONFIRMED`.
- Canonical aggregate hash 137 таблиц во всех трёх post-freeze snapshots:
  `e6a70fcfd2210fef08bca1c315d51657a4e070cb9f54f732b0932bb0eb6ee5d9`.
- Counts и максимальные `created_at`/`updated_at`/`scheduled_at`/`sent_at`
  не изменились. Новые notification jobs/logs и messenger rows не появились.

## Selectel production preflight

- `www.tamgdemaslocrm.ru` обслуживается IP `161.104.45.31`.
- `/`, `/login`, `/api/public/stats`: HTTP `200` до и после freeze.
- Next.js: `tgm-app-rollback`, image `tgm-app:rollback-eb71`, restart count `0`.
- PostgreSQL: `tgm-postgres-1`, PostgreSQL 18, status `healthy`.
- Caddy: `active`, config `valid`.
- WireGuard proxy: `tgm-wireguard-proxy-1`, status `running`, restart count `0`.
- `DATABASE_URL` Selectel application классифицирован как local Compose PostgreSQL,
  не Railway.
- Telegram user-session работает через Selectel: в Selectel app logs есть свежие
  `messenger.telegram_user.sync` events; необходимые Telegram credentials/proxy
  variables присутствуют без раскрытия значений.
- In-process client notification worker включён в Selectel rollback-контейнере
  сохранёнными runtime-маркерами. Отдельного Railway worker/cron service нет.
- Railway-generated domain после остановки отвечает HTTP `404` и production DNS
  на него не указывает.

## Railway services и writers

| Service | Role | До freeze | Пишет в legacy DB | Последняя активность | Действие |
|---|---|---|---|---|---|
| `vin-oil-mann` | Web + in-process notification/Yclients worker; Telegram/messenger runtime | 1 RUNNING instance | Да | Последняя DB mutation `2026-07-31T16:20:15.341103Z`; последний клиентский request Railway не является production traffic и отдельно не доказан | GitHub trigger удалён, repo source отсоединён, successful deployment остановлен |
| `Postgres-BmbT` | Railway PostgreSQL 18.4, 34-table отдельная DB | 1 RUNNING instance | Нет: фактический app `DATABASE_URL` не совпадает с endpoint этого service | Read-only inventory `2026-07-31` | Оставлен запущенным; data/volume не изменялись |
| `Postgres` | Исторический Railway PostgreSQL service metadata/volume | 0 deployments | Текущий service proxy не совпадает с сохранённым legacy app endpoint | Direct service proxy недоступен; фактическая 137-table DB доступна через resolved app `DATABASE_URL` | Не удалялся и не изменялся |

Дополнительных Railway services/environments, replicas, cron schedules, queue
consumers, Redis services или отдельных web/worker/scheduler deployments не найдено.
Единственный неизвестный активный writer перед freeze отсутствовал: вся наблюдаемая
запись шла из одного `vin-oil-mann` instance.

## Autodeploy и compute stop

- Удалён GitHub deployment trigger `codex-local-work`.
- Railway service отсоединён от GitHub repository; `source.repo = null`.
- После disconnect `activeDeployments = 0`; новые replicas не появились.
- Railway PostgreSQL services, volumes, data, backups, domains и credentials не
  удалялись и не ротировались.
- В repository workflows и scripts нет `RAILWAY_TOKEN`, Railway deploy commands
  или Railway deploy workflow. `gh` отсутствует, поэтому remote Actions secret
  inventory не был доступен; активной CI-ссылки после `serviceDisconnect` нет.
- Оба local project link для project `vin-oil-mann` удалены.
- Выполнен `railway logout`; CLI отвечает `Unauthorized`, token/access/refresh
  fields в локальном Railway config равны `null`.

## Final narrow delta

Private artifacts находятся вне Git:

`/Volumes/KINGSTON/ТГМ/Эко-платформа/reconciliation-freeze-2026-07-31-codex-019fb41a`

- Combined supplement: 190 current Railway rows в 10 таблицах, включая 6 Prisma
  journal rows.
- Final supplement SHA-256:
  `3b79f63aeabb0508ef6821d323bdc267f2880c537e386a2351e49fc5bfcf61cc`.
- После cut `2026-07-30T17:23:33.382534Z`: 102 changed rows — 99 новых и
  3 обновлённые existing-PK rows.
- Дополнительный PK+row-hash audit обнаружил 8 отсутствовавших в provisional
  supplement rows: 2 `notification_jobs`, 6 `notification_logs`.
- После применения supplement к восстановленному локальному Railway dump
  aggregate hash всех 137 таблиц точно совпал с frozen remote snapshot;
  `mismatchCount = 0`.
- Новый full `pg_dump` не выполнялся.

## Обновлённые manifests

- Railway-only records: **509**.
- Railway-only additions относительно исходного baseline 342: **167**.
- Добавлено текущим freeze cut: **99**.
- Actions: 234 `INSERT_MISSING`, 32 `MAP_TO_EXISTING`, 45 `SKIP_DUPLICATE`,
  145 `SKIP_EPHEMERAL`, 53 `SKIP_OBSOLETE`, 0 `RECREATE_BUSINESS_EVENT`,
  0 `MANUAL_REVIEW`.
- Same-PK conflicts: **284** — исходные 282 + 2 supplemental.
- Critical same-PK review: **77**; требуют owner approval: **0**.
- `UNKNOWN = 0`.
- Owner decisions: **26** — 6 same-PK, 10 Railway-only manual review,
  10 scheduled events.
- Owner review завершён: 16 `APPROVED`, 10 `REJECTED`, 0 `PENDING`,
  0 `NEEDS_MORE_INFO`. Production-применения решений не было.

## Post-freeze local dry run

- PostgreSQL 18.4, Unix socket only, TCP disabled.
- Existing Railway и Selectel dumps восстановлены в
  `reconciliation_railway` / `reconciliation_selectel`.
- Manifest rows: 509.
- Planned inserts: 234; mappings: 32; skips: 243; workflow recreations: 0;
  manual review: 0.
- FK/unique/schema/orphan/manifest conflicts: **0**.
- Dry run: **PASS**.
- Production mutation attempted: **false**.
- Локальный cluster корректно остановлен. APFS image повторно смонтирован
  read-only: PostgreSQL `18`, cluster state `shut down`, `pgdata` сохранён
  (3.4 GB), после проверки image отключён.
- Full post-freeze import rehearsal не выполнялся: для него требуется отдельное
  разрешение fresh Selectel dump. Owner decisions закрыты.

## T+60 read-only verification

Контрольное время `2026-07-31T20:20:08Z` выдержано. Финальный remote snapshot
выполнен в `2026-07-31T20:23:28.757553Z` — через 63 минуты 20 секунд после
остановки compute.

- Транзакция: PostgreSQL `REPEATABLE READ READ ONLY`;
  `transactionReadOnly = on`.
- Сравнено: **137 из 137 таблиц**.
- Изменившихся таблиц: **0**.
- Новых строк после freeze: **0**.
- T+60 canonical aggregate hash:
  `e6a70fcfd2210fef08bca1c315d51657a4e070cb9f54f732b0932bb0eb6ee5d9`.
- Hash совпадает с immediate и 15-minute snapshots.
- Финальный глобальный `max(created_at)`:
  `2026-07-31T16:20:15.341103Z`.
- Финальный глобальный `max(updated_at)`:
  `2026-07-31T16:20:15.323316Z`.
- `notification_jobs`, `notification_logs`, messenger messages/outbox/media
  jobs, integration audit, shipments/revisions и остальные watched tables не
  изменились.
- Во время snapshot активных сторонних backend sessions: **0**.

Infrastructure verification:

- Railway app service: `deploymentStopped = true`;
  active deployments **0**, running replicas **0**.
- Новых deployments после freeze нет.
- Repository source: `null`.
- GitHub deployment triggers: **0**.
- App logs за интервал freeze → T+60: **0 строк**; новых mutation events нет.
- Selectel `/`, `/login`, `/api/public/stats`: HTTP `200`.
- Railway-generated app domain: HTTP `404`.
- Railway PostgreSQL и volumes не изменялись.

`railwayWriteFreezeConfirmedAt`:
**`2026-07-31T20:23:28.757553Z`**.

`freezeVerificationStatus`: **`CONFIRMED`**.

Текущий статус после owner review:
**`RAILWAY_FROZEN_OWNER_REVIEW_COMPLETE_LOCAL_REHEARSAL_REQUIRED`**.

Snapshot, verification JSON и пустой post-freeze application log сохранены в
приватном reconciliation-каталоге вне Git. Новый full `pg_dump` не выполнялся.
После проверки временная project link удалена, выполнен `railway logout`;
`railway whoami` отвечает `Unauthorized`, credentials и links отсутствуют.

## Что не выполнялось

- Railway/Selectel deploy или migration;
- production import или изменение production rows;
- новый full dump;
- Selectel env/worker/DNS/webhook changes;
- Branch 2 или branch migration;
- Railway project/database/volume/domain deletion;
- credential rotation;
- legacy file rehearsal и rollback restore rehearsal.

Следующий этап требует отдельного разрешения fresh Selectel dump и повторной
финальной rehearsal/restore/pg_amcheck проверки. Production import всё ещё
запрещён.
