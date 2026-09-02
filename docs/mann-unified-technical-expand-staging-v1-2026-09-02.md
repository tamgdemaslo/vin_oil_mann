# MANN unified technical catalog — expand/staging v1

Дата: 2026-09-02  
Статус migration: **создана, проверена, не применялась**  
Статус staging import: **dry-run plan, не применялся**  
Runtime cutover: **NO-GO**

## Результат этапа

Создан expand-only фундамент единого каталога:

```text
MannVehicleVariant
  └── MannTechnicalAssociationRevision[]
        ├── MannTechnicalMaterializationRun
        └── MannTechnicalReviewDecision[]
```

`MannVehicleVariant.key` использует существующий MANN `vehicleVariantKey`; новый конкурирующий vehicle identity не создаётся.

Migration создаёт четыре пустые таблицы:

1. `mann_vehicle_variants` — канонический MANN vehicle identity;
2. `mann_technical_materialization_runs` — версия, snapshot и gates каждого запуска;
3. `mann_technical_association_revisions` — append-only технические ревизии;
4. `mann_technical_review_decisions` — append-only ручные решения.

Migration не содержит backfill и не изменяет:

- `mann_filter_applications`;
- `vehicle_fluid_requirements`;
- `fluid_source_rows`;
- `mann_fluid_requirement_links`;
- текущие runtime reads.

## Почему source requirement не имеет FK

`MannTechnicalAssociationRevision.sourceRequirementId` сохраняется как логический идентификатор вместе с immutable provenance JSON. Текущий fluid importer может заменять staging rows с каскадным удалением. FK на `VehicleFluidRequirement` сделал бы canonical audit history зависимой от жизненного цикла staging-источника.

FK присутствуют только там, где удаление запрещено:

- revision → canonical MANN vehicle;
- revision → materialization run;
- review decision → revision;
- superseding revision → предыдущая revision.

Все связи используют `ON DELETE RESTRICT`.

## Блокировки опасных состояний

SQL constraints не позволяют:

- создать `MATERIALIZED` run без `independent_human_signoff=true` и `production_apply_authorized=true`;
- разрешить production apply без независимой подписи;
- создать `ACTIVE` revision без `apply_eligible=true` и допустимого verification status;
- записать некорректный SHA-256 vehicle/fingerprint;
- создать обратный диапазон годов или времени;
- создать self-supersession;
- использовать неизвестные состояния run/revision/review decision.

## Staging plan

Источник:

`outputs/mann-technical-catalog-v9-timeweb-backup-20260823-190344/mann-primary-source-verified-preview-v1.json`

Результат:

`outputs/mann-unified-technical-staging-v1/mann-unified-technical-staging-plan-v1.json`

Состав:

| Объект | Количество |
|---|---:|
| Канонические MANN vehicles | 4 |
| Технические revisions | 5 |
| Review decisions | 0 |

Все пять revisions имеют:

- `state=STAGED`;
- `verificationStatus=PRIMARY_SOURCE_VERIFIED_FIELDS`;
- `applyEligible=false`;
- только проверенное поле `technicalData.capacity`;
- primary-source evidence и SHA-256 документа;
- fingerprint исходной v9-связи, matcher/parser versions, Git commit и SHA-256 backup в provenance.

Допуски, вязкость, интервалы и рекомендации вторичного источника в staging plan не включены.

## Файлы

- Prisma schema: `prisma/schema.prisma`;
- migration: `prisma/migrations/20260902400000_mann_unified_technical_catalog_expand/migration.sql`;
- staging builder: `scripts/build-mann-unified-technical-staging-plan.mjs`;
- migration/staging guard: `scripts/test-mann-unified-technical-expand.mjs`.

Команды:

```bash
npm run test:mann-unified-technical-expand
npm run preview:mann-unified-technical-staging
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/validation npx prisma validate
```

## Решение

- Schema expand: `READY_FOR_REVIEW_NOT_APPLIED`.
- Staging import: `READY_FOR_REVIEW_NOT_APPLIED`.
- Runtime cutover: `NO_GO`.
- Production apply: `NOT_AUTHORIZED`.

Перед применением migration нужна отдельная maintenance-операция на Timeweb после проверки актуальности backup. После DDL требуется отдельный staging import rehearsal и проверка row counts/FK/constraints. Этот этап не является разрешением на эти операции.
