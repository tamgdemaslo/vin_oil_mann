# Proposal: append-only MANN technical materialization

Статус: **proposal only; NO-GO, migration не создана и не применялась**.
Основание: frozen dry-run `mann-fluid-matcher-v2` + `capacity-parser-v2` завершён, но current Timeweb backup/audit и обязательный independent review отсутствуют.

## Цель будущей migration

Материализовать только независимо подтверждённые technical associations на canonical `vehicleVariantKey`, не изменяя исходный каталог жидкостей, MANN filter applications и исторические links. Любая новая версия алгоритма создаёт новый materialization run/revision; старые результаты остаются для аудита.

## Предлагаемые сущности

### `MannVehicleVariant`

Одна canonical строка на `vehicleVariantKey`, которой сейчас нет в Prisma schema.

Ключевые поля:

- `key` — существующий SHA-256 `vehicleVariantKey`, primary key;
- normalized make/model, representative vehicle/engine/year fields;
- `sourceHashesJson`, `firstSeenAt`, `lastSeenAt`;
- `createdAt`, без каскадного удаления technical history.

Формируется детерминированно из `MannFilterApplication`; filter rows продолжают ссылаться логически на тот же key. Добавление реального FK к существующей большой таблице — отдельная поздняя операция после orphan audit, не часть первого expand step.

### `MannTechnicalMaterializationRun`

Append-only запуск алгоритма:

- `id`, `matcherVersion`, `parserVersion`, `gitCommit`;
- source catalog batch hashes и MANN source hashes;
- snapshot/backup ID и timestamp;
- `mode=DRY_RUN|MATERIALIZED`;
- counts/gates JSON;
- actor/approval references;
- `createdAt`, `completedAt`.

Run со статусом `MATERIALIZED` разрешён только при verified current Timeweb backup и отдельном approval token.

### `MannTechnicalAssociationRevision`

Append-only revision будущей association:

- `id`, `runId`, `vehicleVariantKey`, `sourceRequirementId`;
- `systemCode`, normalized `componentModel`/condition JSON;
- raw + structured capacity JSON;
- raw + structured specifications/viscosity;
- recommendations/intervals;
- `fieldConfidenceJson`;
- `matchClass`, `matchScore`, evidence/top diagnostics JSON;
- `semanticFingerprint`;
- `state=ACTIVE|REVIEW|REJECTED|SUPERSEDED`;
- source row/page/batch hashes, algorithm versions, git commit;
- `supersedesRevisionId`, `createdAt`.

Не обновлять revision in place. Новое решение создаёт новую revision и, если необходимо, отдельную запись state transition/supersession.

Рекомендуемые ограничения/индексы:

- unique `(runId, semanticFingerprint)`;
- index `(vehicleVariantKey, state, systemCode)`;
- index `(sourceRequirementId, createdAt)`;
- index `(semanticFingerprint, createdAt)`;
- check: ACTIVE требует `vehicleApplicability=HIGH`, independently validated target и пустые hard/review blockers;
- check: algorithm/source/provenance fields обязательны для ACTIVE.

### `MannTechnicalReviewDecision`

Append-only ручные решения:

- association/revision или grouped review key;
- decision `CONFIRM|REJECT|SPLIT_CONDITION|CATALOG_GAP|SOURCE_GAP`;
- actor, reason, evidence JSON;
- optional structured condition/capacity correction;
- timestamp.

Ручное решение не переписывает source requirement; оно создаёт новую revision в следующем approved run.

## Source preservation

Следующие таблицы остаются источниками истины и не очищаются migration:

- `fluid_catalog_import_batches`;
- `fluid_source_rows`;
- `vehicle_fluid_requirements`;
- `mann_pdf_import_batches`;
- `mann_filter_applications`;
- `mann_fluid_requirement_links` как legacy evidence.

Текущий importer использует replace semantics для актуальных source rows. До production materialization его нужно перевести на append-only import batches или гарантировать, что association revisions сохраняют immutable snapshot payload/hash и не каскадно удаляются вместе с source row. Это отдельный обязательный design gate.

## Предлагаемая последовательность, только после GO

1. Получить и верифицировать backup актуальной Timeweb PostgreSQL.
2. Повторить read-only manifest + parser/matcher dry-run на этом snapshot.
3. Создать независимый golden/manual matcher truth set и подтвердить Top-1/3/20.
4. Завершить review 200 ACTIVE и 200 dangerous-system samples с заранее зафиксированными критериями.
5. Устранить или принять P0/P1 groups; пересчитать preview.
6. Получить отдельный migration approval.
7. Expand-only migration: создать новые таблицы/индексы без изменения runtime reads.
8. В read-only input transaction пересчитать approved run; в отдельной bounded write transaction вставить только ACTIVE revisions по fingerprint.
9. Сверить counts, duplicate/conflict invariants, orphan count и provenance hashes.
10. Runtime cutover проводить отдельной задачей и feature flag; старый путь остаётся fallback до приёмки.

## Rollback

Rollback materialization — выключить новый read feature flag и пометить run/revisions superseded отдельными append-only событиями. Не удалять новые таблицы и не удалять source/legacy rows. DDL rollback или восстановление backup допустимы только при подтверждённом повреждении данных и отдельном решении оператора.

## Обязательные GO gates

- current Timeweb backup ID/timestamp/restore verification;
- read-only audit на том же snapshot;
- 0 parser horsepower collisions;
- 0 ACTIVE с parser review/hard conflict/review blocker;
- 100% independently validated multi targets;
- independent golden/manual matcher metrics согласованы;
- 200 ACTIVE sample reviewed;
- 200 dangerous-system sample reviewed;
- P0/P1 acceptance signed off;
- migration SQL/Prisma diff reviewed;
- rollback/feature-flag plan approved.

Пока хотя бы один пункт не выполнен, решение остаётся **NO-GO**.
