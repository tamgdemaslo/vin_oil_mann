# Final reconciliation readiness

Дата проверки: 2026-07-31. Текущий статус:
**`RAILWAY_FROZEN_PENDING_OWNER_REVIEW`**.

Railway application compute остановлен, T+60 write freeze подтверждён и final
narrow delta построена. Reconciliation ещё не `VERIFIED`: production import,
fresh Selectel rehearsal, file rehearsal, rollback rehearsal и owner decisions
не выполнены.

## Railway freeze

- Production traffic обслуживает Selectel IP `161.104.45.31`.
- Selectel Next.js, PostgreSQL, Caddy и WireGuard proxy работают; публичные `/`,
  `/login`, `/api/public/stats` отвечают HTTP `200`.
- GitHub deployment trigger Railway удалён; repository source отсоединён.
- Единственный Railway application writer `vin-oil-mann` остановлен в
  `2026-07-31T19:20:08Z`; active deployments после остановки: 0.
- `railwayWriteFreezeAt`: **`2026-07-31T19:20:08Z`**.
- Immediate snapshot `2026-07-31T19:20:12.042956Z` и 15-minute snapshot
  `2026-07-31T19:36:49.724858Z` совпадают по всем 137 таблицам.
- Canonical aggregate hash:
  `e6a70fcfd2210fef08bca1c315d51657a4e070cb9f54f732b0932bb0eb6ee5d9`.
- T+60 snapshot `2026-07-31T20:23:28.757553Z` выполнен в PostgreSQL
  `REPEATABLE READ READ ONLY`: 137/137 таблиц, changed tables 0, new rows 0,
  hash совпал с immediate и 15-minute snapshots.
- `railwayWriteFreezeConfirmedAt`:
  **`2026-07-31T20:23:28.757553Z`**;
  `freezeVerificationStatus = CONFIRMED`.
- Railway app: deployment stopped, active deployments 0, running replicas 0,
  source `null`, deployment triggers 0, post-freeze app logs 0 строк.
- Railway PostgreSQL и volumes не удалялись и не изменялись.

## Final narrow delta

Private supplement хранится только на KINGSTON вне Git. Он содержит 190 current
Railway rows в 10 таблицах, включая 6 Prisma journal rows. SHA-256:
`3b79f63aeabb0508ef6821d323bdc267f2880c537e386a2351e49fc5bfcf61cc`.

После provisional cut `2026-07-30T17:23:33.382534Z` обнаружены 102 changed
rows: 99 новых и 3 existing-PK updates. Дополнительный PK+row-hash audit нашёл
ещё 8 пропущенных provisional supplement rows: 2 `notification_jobs` и
6 `notification_logs`.

После применения supplement только к изолированной локальной Railway DB её
aggregate hash всех 137 таблиц точно совпал с frozen remote snapshot.
Новый full `pg_dump` не выполнялся.

Railway содержит 57-ю journal row
`20260728120000_branch_architecture_foundation`, но `finished_at` отсутствует и
`applied_steps_count = 0`. Миграция не считается применённой; production repair
не выполнялся.

## Railway-only

| Решение | Количество |
|---|---:|
| INSERT_MISSING | 234 |
| MAP_TO_EXISTING | 32 |
| SKIP_DUPLICATE | 45 |
| SKIP_EPHEMERAL | 145 |
| SKIP_OBSOLETE | 33 |
| RECREATE_BUSINESS_EVENT | 10 |
| MANUAL_REVIEW | 10 |
| REJECT_INVALID | 0 |
| UNKNOWN | 0 |
| Всего | 509 |

Исходный baseline: 342 records. Final delta additions: 167; текущим freeze cut
добавлено 99 manifest records.

## Same-PK

Итоговый manifest содержит 284 conflicts: исходные 282 и 2 supplemental.
`UNKNOWN = 0`.

| Resolution action | Количество |
|---|---:|
| KEEP_SELECTEL | 134 |
| APPLY_RAILWAY_FIELD | 4 |
| RECOMPUTE | 29 |
| SKIP_EPHEMERAL | 107 |
| REJECT_RAILWAY | 10 |
| MANUAL_REVIEW | 0 |
| Всего | 284 |

Critical review содержит 77 conflicts. Владелец утвердил **A / KEEP_SELECTEL**
для 6 конфликтов: 4 CRM deal transitions и 2 attachment-to-message ownership
conflicts. Все шесть не требуют записи в target; полная Railway row replacement
запрещена. Same-PK owner approval осталось: **0**.

## Owner review

Утверждено: **6**. Явно отложено до следующих пакетов: **20**.

- 6 критичных бизнес-конфликтов: 4 CRM-карточки и 2 связи вложений;
- 3 связанные Telegram-записи без подтверждённого клиента/объекта;
- 7 отсутствующих вложений, требующих проверки файла и родительского сообщения;
- 10 напоминаний о записи: 2 уже завершились без доставки, 8 были будущими
  на момент проверки.

`DEC-001…006` имеют `status = APPROVED`, `selectedOption = A` и сохранённое
`decidedAt`. `DEC-007…026` остаются `PENDING` и перечислены как явно отложенные
до следующих пакетов; production-действия для них запрещены. Основные migration
и same-PK manifests обновлены только как реестр решений. Данные Selectel и
Railway не изменялись.

## Открытый security blocker

**`REMOTE_GITHUB_SECRET_INVENTORY_NOT_VERIFIED`**.

Локальный repository не содержит Railway deploy workflow или Railway token
reference, а Railway repository source и autodeploy trigger отключены. Но `gh`
не установлен, поэтому список имён remote GitHub Actions secrets не проверен.
Это не блокирует owner review, но должно быть закрыто до окончательного вывода
Railway из эксплуатации.

Безопасные варианты:

1. Установить и авторизовать `gh` с минимально необходимыми read permissions и
   проверить только наличие имён secrets.
2. Владелец вручную открывает GitHub → Settings → Secrets and variables →
   Actions и ищет `RAILWAY_TOKEN`, `RAILWAY_API_TOKEN`, `RAILWAY_PROJECT_ID`,
   `RAILWAY_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID` и другие Railway credentials.

Значения секретов присылать не нужно. Достаточно отметить: найдено/не найдено,
удалено/оставлено и где использовалось. Изменять GitHub secrets без отдельного
подтверждения запрещено.

## Post-owner-decision local-only dry run

- Dry run: **PASS**.
- Local PostgreSQL 18.4, Unix socket only; TCP disabled.
- Manifest rows: 509.
- Planned inserts: 234.
- Mappings: 32.
- Skips: 223.
- Workflow recreations: 10; не выполнялись.
- Railway-only manual review: 10; это явно отложенные owner decisions, они не
  применялись. Same-PK manual review: 0.
- FK/unique/schema/orphan/manifest conflicts: 0.
- Field allowlist: PASS; 55 потенциально записываемых полей проверено,
  violations 0.
- Protected Selectel-only checksum до/после совпал:
  `77f187d51a0839fe1d070b04349a138e0b1949a755b428530497e4fae02a937c`;
  проверено 3 674 explicit PK из contract total 3 709, legacy audit gap 35.
- Idempotency: PASS; повторное применение решений дало `changed = false`,
  хеши четырёх manifests и checksum target не изменились, duplicates 0.
- Production mutation attempted: false.
- APFS image проверен после clean shutdown и read-only remount: PostgreSQL 18,
  cluster state `shut down`, local `pgdata` сохранён (3.4 GB).

## Provisional rehearsal evidence

Предыдущие merge/full-diff/pg_amcheck/idempotency результаты остаются
**PROVISIONAL_PASS**, потому что были выполнены до final freeze. Их нельзя считать
финальной production rehearsal. Для следующего этапа нужны отдельное разрешение
fresh Selectel dump и повторные restore/import/full diff/pg_amcheck/idempotency/
rollback restore проверки.

## Selectel-only protection

- Исторический live audit: 3 709 Selectel-only business rows.
- Explicit denylist: 3 674 rows; 35-row gap защищён глобальным запретом
  UPDATE/DELETE вне exact same-PK manifest.
- Последний provisional before/after checksum совпадал:
  `77f187d51a0839fe1d070b04349a138e0b1949a755b428530497e4fae02a937c`.
- В текущем этапе Selectel production DB не изменялась.

## Оставшиеся блокеры `VERIFIED`

1. Owner decisions: 26.
2. `REMOTE_GITHUB_SECRET_INVENTORY_NOT_VERIFIED`.
3. Fresh Selectel dump требует отдельного разрешения.
4. Fresh post-freeze restore/import/full-diff/pg_amcheck/idempotency rehearsal не
   выполнена.
5. Legacy attachment file/object rehearsal не выполнена.
6. Rollback restore rehearsal не выполнена.
7. Два provider-dependent cache recomputations остаются отложенными.
8. Baseline defect `crm_deals` требует отдельного isolated-copy test/change
   approval.
9. Production import и branch migration требуют отдельных разрешений.

**Итог:** Railway compute остановлен, отсутствие новых записей подтверждено на
T+60. Текущий этап находится на owner review; production execution остаётся
**NO-GO** до закрытия перечисленных блокеров.
