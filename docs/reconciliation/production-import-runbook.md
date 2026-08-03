# Production reconciliation import runbook

Статус документа: **PREPARED / DO NOT EXECUTE**. Текущий reconciliation status — NO-GO.

Этот runbook применяется только после отдельного явного разрешения владельца. Production platform — только Selectel. Railway используется исключительно как read-only legacy source до контролируемого decommission.

## Preconditions

1. Подтвердить, что публичный production traffic обслуживается Selectel.
2. Согласованно остановить старый Railway compute `vin-oil-mann`, не удаляя Railway database.
3. Зафиксировать `railwayWriteFreezeAt` и выполнить минимум два разнесённых read-only snapshots.
4. Counts, `max(created_at)`, `max(updated_at)` и queue/job counts не должны меняться.
5. Получить final narrow delta после freeze; полный Railway dump делать только при отдельной необходимости/авторизации.
6. Перегенерировать Railway-only, same-PK, resolution и approvals manifests. `UNKNOWN = 0`.
7. Все MANUAL_REVIEW и RECREATE_BUSINESS_EVENT должны иметь точное approved decision с `approvedBy` и `approvedAt`.
8. Unresolved critical conflicts = 0.
9. Повторить fresh local restore, merge, full diff, pg_amcheck, idempotency и rollback restore rehearsal.
10. Проверить legacy file/object availability для всех импортируемых attachments.
11. Отдельно проверить baseline fix для `crm_deals` только на изолированной копии; production не исправлять этим runbook без отдельного change approval.

## Provisional scope and estimate

Текущий, не финальный объём:

- 153 inserts;
- 32 mappings без target mutation;
- 14 field updates в 4 rows;
- 26 local deterministic recomputations;
- 4 business events ожидают решения/recreation;
- 11 Railway-only batches + отдельный same-PK resolution pass.

Локальный mutation pass занял около 16 секунд. Для production планировать maintenance window **30–45 минут**, включая guards, post-import checks и возможность немедленного rollback. Оценка не окончательная до freeze и owner approvals.

## Maintenance window

1. Объявить no-mutation window для затрагиваемых CRM/messenger/notification workflows.
2. Остановить только согласованные Selectel workers:
   - client notifications in-process worker;
   - messenger media/outbox processing;
   - notification cron routes/schedulers;
   - Yclients notification sync;
   - другие процессы, которые пишут в затрагиваемые таблицы.
3. Не останавливать Selectel application полностью без отдельного решения; read-only UI может оставаться доступным, если это проверено заранее.
4. Telegram, email, payment, Yclients, МойСклад, ROSSKO и webhooks не должны выполнять mutations во время import.

## Fresh Selectel backup

1. Выполнить fresh full custom-format backup Selectel production.
2. Зафиксировать start/end UTC, PostgreSQL version, table count, Prisma journal rows, size, SHA-256, exit code.
3. Проверить `pg_restore --list` и восстановить backup в новую isolated local database.
4. Выполнить counts, timestamps, FK/index checks и `pg_amcheck` на восстановленной копии.
5. Если backup/readability/restore check не PASS — import отменить.

## Final manifest regeneration

1. Повторить Railway freeze snapshots непосредственно перед maintenance.
2. Получить final narrow delta и checksum.
3. Пересобрать manifests и field allowlists.
4. Проверить запрет `REPLACE_ROW_FROM_RAILWAY`.
5. Проверить exact approved decisions; broad CLI-флаг owner approval запрещён.
6. Сформировать Selectel-only denylist и before checksums.
7. Выполнить dry run на fresh Selectel copy. Требуется 0 FK/unique/schema/orphan conflicts.

## Execution

1. Использовать только reviewed script revision и exact manifest checksums.
2. Установить `statement_timeout` и короткий `lock_timeout`; не ждать блокировки бесконечно.
3. Выполнять dependency batches по порядку:
   - skip/reject audit;
   - operational mappings;
   - identities/connections/conversations;
   - messages;
   - append-only history;
   - separately approved recreated events;
   - approved field-level resolutions;
   - deterministic recomputations.
4. Каждый batch — отдельная transaction и append-only audit entry.
5. INSERT — только manifest-listed missing PK.
6. MAP_TO_EXISTING не изменяет target row; меняются только declared child references при insert.
7. UPDATE — только перечисленные поля конкретного same-PK resolution.
8. Critical field update без matching approved decision или deterministic evidence rule должен быть отклонён.
9. DELETE, TRUNCATE, full Railway restore и full-row UPDATE запрещены.
10. Scheduled legacy job нельзя копировать; approved event воссоздаётся штатным Selectel workflow с новым idempotency guard.

## Post-import verification

1. Повторить table counts и timestamp ranges.
2. Проверить все FK и unique indexes.
3. Проверить orphan count = 0.
4. Выполнить `pg_amcheck --heapallindexed --checkunique`.
5. Выполнить full PK/row-hash diff с frozen Railway.
6. Unexplained durable Railway-only = 0.
7. Unexplained critical same-PK = 0.
8. Проверить Selectel-only before/after checksums; unexpected changes = 0.
9. Повторить import с тем же audit file; planned mutations должны быть 0.
10. Выполнить smoke tests без отправки реальных сообщений/платежей:
    - login и read-only CRM;
    - messenger history rendering;
    - notification history;
    - inventory/product reads;
    - attachment metadata/file availability;
    - отсутствие pending legacy jobs.

## Worker restart and monitoring

1. Запускать Selectel workers по одному.
2. После каждого запуска проверять error rate, queue growth и duplicate events.
3. Сначала notification worker, затем messenger/outbox/media только по согласованному порядку.
4. Railway compute остаётся остановленным; Railway database сохраняется read-only до завершения rollback window.
5. Мониторить минимум 30 минут:
   - application errors;
   - duplicate messages/notifications;
   - queue backlog;
   - unexpected Railway writes;
   - Selectel DB locks/latency;
   - integration retries.

## Rollback criteria

Немедленно остановить import/restart и перейти к rollback при любом из условий:

- FK/unique/orphan error;
- unexpected Selectel-only checksum change;
- duplicate customer message/notification;
- неверный CRM status/payment/inventory value;
- manifest checksum mismatch;
- Railway снова пишет после freeze;
- заметный рост production latency/errors;
- batch transaction не может завершиться в установленный timeout.

## Rollback procedure

1. До commit текущего batch — выполнить transaction rollback.
2. После одного или нескольких committed batches — оставить workers остановленными.
3. Использовать append-only import audit для точного списка изменений.
4. Если безопасен field-level compensating rollback, применять только reviewed обратные значения из pre-import snapshot.
5. При широком/неясном повреждении восстановить fresh verified Selectel backup по отдельному restore approval.
6. Не восстанавливать Railway dump поверх Selectel.
7. После rollback повторить counts, checksums, FK/index checks, pg_amcheck и smoke tests.
8. Максимальный provisional rollback decision window: 30 минут после первого production batch commit; окончательное значение утвердить после post-freeze rehearsal.

## Final authorization gate

Перед production execution владелец отдельно подтверждает:

- freeze и final delta;
- exact manifest version/checksums;
- все 20 текущих decisions либо их post-freeze replacement;
- maintenance window;
- worker stop/start order;
- rollback backup и restore rehearsal;
- разрешение именно на Selectel production import.

Без этого подтверждения выполнение runbook запрещено.
