# Manifest объединения MANN и каталога технических жидкостей

Дата аудита: 2026-08-23
Репозиторий: `vin_oil_mann`, `main`, commit `c2400c0aa43b6cbd8ce77a7fffa9b68c0409f328`
Решение этапа: **NO-GO для migration/materialization; GO для подготовки отдельной migration и dry-run job после устранения блокеров ниже.**

## Границы и источник данных

На этом этапе не создавались и не применялись Prisma migrations, не выполнялись materialization, deploy или изменения production. `npm run check:timeweb-only` прошёл.

Количественные результаты рассчитаны на локально восстановленном проверенном offline-срезе:

- архив: `railway-final-frozen-backup-2026-08-02-codex-019fb41a`;
- статус архива: `VERIFIED`;
- режим источника: `REPEATABLE_READ_READ_ONLY_FROZEN`;
- изменений таблиц во время backup: 0;
- последняя запись MANN: 2026-07-16;
- последние fluid requirements/links: 2026-07-24.

Локальная dev-БД остановлена, production credentials в рабочей копии отсутствуют. Поэтому counts ниже являются воспроизводимым frozen baseline, а не подтверждением текущего Timeweb production на 2026-08-23. Перед одобрением migration тот же read-only audit нужно повторить на backup актуальной Timeweb-БД.

Активный fluid source:

- batch `cmryyy7ly00008z4najy93156`;
- source hash `e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae`;
- imported at `2026-07-24 13:21:26.278`.

Активный MANN source:

- batch `cmrn5354i00008zdpljq1ybxw`;
- applications hash `7fbb2e3cc1e1b3fdd77eed334eba69295752592aa1c69f2d563852b29e128318`;
- filters hash `57c37e41b763df33f835cc21feb0449cb37b84205c2817e06d831fd8a769c39e`;
- imported at `2026-07-16 06:39:59.922`.

Текущая схема не сохраняет версию matching algorithm в БД. Для воспроизводимости текущего кода зафиксированы SHA-256:

- `src/lib/fluid-catalog.ts`: `2319f453a007bdbb882ba23eea0d67a7e1890ac44f404e0b4c8a783688806b1d`;
- `src/lib/mann-vehicle-resolver.ts`: `27bc28d8dc47e09671b8cafb1a3074bf39b936a616398becf68d3273c3062e5e`;
- `prisma/schema.prisma`: `507009000fb357fea4a5be69b80f4edfedaa20a7e2e76b8b58daffbc1edf68ed`.

## 1. Фактическая каноническая модель MANN

Отдельной Prisma-модели `MannVehicleVariant` сейчас **нет**.

Логическая MANN-модификация хранится как повторяющийся `MannFilterApplication.vehicleVariantKey`. Ключ — SHA-256 от нормализованных make/model/vehicle text/engine/power/years/condition. Внешнего FK на автомобиль нет.

Факты:

- `MannFilterApplication`: 37 600 строк применяемости фильтров;
- уникальных `vehicleVariantKey`: 16 349;
- все 16 349 ключей имеют ровно один согласованный vehicle context в повторяющихся filter rows;
- конфликтующих vehicle contexts внутри одного key: 0.

Следовательно, `vehicleVariantKey` уже является правильным canonical ID, но его нужно формализовать отдельной родительской таблицей с тем же ключом. Это не новый vehicle ID и не копия второго каталога.

## 2. Текущая fluid schema

Текущие модели уже хорошо разделяют raw и normalized data:

- `FluidCatalogImportBatch` — import metadata и source hash;
- `FluidSourceRow` — raw row, URL, raw/parsed JSON;
- `VehicleFluidRequirement` — нормализованное требование и structured payload;
- `MannFluidRequirementLink` — candidate/match provenance к строковому `mannVariantKey`.

Проблемы:

1. `MannFluidRequirementLink.mannVariantKey` не имеет FK, потому что `MannFilterApplication.vehicleVariantKey` не уникален.
2. Runtime helper `listFluidRequirementsForMannVariant()` читает import-link table напрямую; unified canonical materialization отсутствует.
3. Helper моторного масла выполняет повторный runtime matching по make/model/year/engine из `VehicleFluidRequirement`, то есть сейчас существует именно запрещённый второй runtime matcher.
4. VIN/MANN resolver возвращает `filters` и `localMatches`, но не `technicalProfile`.
5. Fluid importer при `replaceExisting` удаляет source rows старых batches каскадно. Это противоречит требованию append-only provenance и должно быть исправлено до следующего импорта.

## 3. Инвентаризация данных

### Общие counts

| Метрика | Значение |
|---|---:|
| MANN filter applications | 37 600 |
| Уникальные MANN variants | 16 349 |
| Fluid source rows | 13 287 |
| Vehicle fluid requirements | 13 296 |
| MANN-fluid links | 5 723 |
| Requirements с хотя бы одним persisted link | 2 504 |
| MANN variants с хотя бы одним persisted link | 704 |
| Orphan links на отсутствующий MANN key | 0 |
| Orphan links на отсутствующий requirement | 0 |

### Requirements по `systemCode`

| System | Requirements | System | Requirements |
|---|---:|---|---:|
| ENGINE_OIL | 2 204 | ENGINE_COOLANT | 1 824 |
| BRAKE_FLUID | 1 739 | AUTOMATIC_TRANSMISSION | 1 243 |
| REAR_DIFFERENTIAL | 1 121 | MANUAL_TRANSMISSION | 1 038 |
| POWER_STEERING | 1 016 | TRANSFER_CASE | 717 |
| CVT_TRANSMISSION | 417 | FRONT_DIFFERENTIAL | 393 |
| FUEL_TANK | 254 | ROBOT_TRANSMISSION | 230 |
| TIRES_WHEELS | 152 | DIFFERENTIAL_GENERIC | 123 |
| BATTERY | 113 | AC_REFRIGERANT | 110 |
| GREASE | 106 | CLUTCH_FLUID | 86 |
| SPARK_PLUG | 82 | AWD_COUPLING | 76 |
| INVERTER_COOLANT | 46 | SUSPENSION_HYDRAULIC | 38 |
| TRANSMISSION_GENERIC | 35 | HYDRAULIC_SYSTEM | 29 |
| INTERCOOLER_COOLANT | 19 | AIR_FILTER | 18 |
| ADBLUE | 17 | OIL_FILTER | 17 |
| CABIN_FILTER | 12 | PTO | 7 |
| FUEL_FILTER | 5 | GENERATOR_OIL | 4 |
| FUEL | 3 | RETARDER | 2 |

### Текущие статусы links

| Класс | Requirements | Links | Комментарий |
|---|---:|---:|---|
| CONFIRMED | 0 | 0 | Человеческих подтверждений нет |
| HIGH_AUTO | 2 502 | 5 717 | Все имеют status `auto_matched`, confidence `high` |
| REVIEW_REQUIRED | 2 | 6 | По 3 candidates на requirement |
| UNMATCHED | 10 792 | 0 | Точнее: нет persisted candidate; broad candidates не сохранялись |

Только 18,82% requirements помечены `HIGH_AUTO`; 81,17% не имеют persisted link.

### Coverage по основным системам

| Система | Requirements | Есть link | High/confirmed | Review | Unmatched |
|---|---:|---:|---:|---:|---:|
| Engine oil | 2 204 | 433 | 431 | 2 | 1 771 |
| Automatic transmission | 1 243 | 265 | 265 | 0 | 978 |
| CVT | 417 | 84 | 84 | 0 | 333 |
| DSG/robot | 230 | 40 | 40 | 0 | 190 |
| Manual | 1 038 | 250 | 250 | 0 | 788 |
| Transfer case | 717 | 143 | 143 | 0 | 574 |
| Front differential | 393 | 78 | 78 | 0 | 315 |
| Rear differential | 1 121 | 219 | 219 | 0 | 902 |
| AWD coupling | 76 | 14 | 14 | 0 | 62 |
| Coolant | 1 824 | 341 | 341 | 0 | 1 483 |
| Brake fluid | 1 739 | 333 | 333 | 0 | 1 406 |
| Power steering | 1 016 | 232 | 232 | 0 | 784 |

### Vehicle coverage

Текущие `HIGH_AUTO` нельзя считать готовыми к materialization: 1 028 requirements автоматически привязаны сразу к нескольким MANN variants. Поэтому показаны оба значения.

| Метрика | По текущим HIGH_AUTO | Только unique-target baseline |
|---|---:|---:|
| MANN variants с любыми technical data | 701 (4,29%) | 279 (1,71%) |
| С engine oil | 657 | 278 |
| С transmission | 664 | 195 |
| С transfer/differential/AWD | 424 | 108 |
| С coolant | 666 | 195 |
| С brake fluid | 665 | 194 |
| Core: oil + transmission + coolant + brake | 619 | 193 |
| Expanded: core + drivetrain | 391 | 106 |

`Full profile` здесь не означает наличие каждой возможной системы: core и expanded — только диагностические определения coverage.

## 4. Качество связей и блокеры

### 4.1. Автоматическое размножение одного requirement

Распределение trusted targets на requirement:

| MANN variants на requirement | Requirements |
|---|---:|
| 0 | 10 794 |
| 1 | 1 474 |
| 2–3 | 710 |
| 4–10 | 257 |
| 11+ | 61 |

Итого 1 028 `HIGH_AUTO` requirements связаны с 2–28 MANN variants. Это 4 243 link rows. Они должны быть понижены как минимум до `REVIEW_REQUIRED`, пока новый shared matcher не докажет однозначность или человек не подтвердит осознанную multi-applicability.

Причина видна в старом fluid matcher: он выбирает **все** exact/broad auto candidates, затем создаёт link для каждого. Новый `mann-vehicle-resolver` в этом pipeline не используется.

Минимальная review queue уже сейчас:

| Причина | Requirements |
|---|---:|
| AMBIGUOUS_MULTI_TARGET | 1 028 |
| CAPACITY_CONFLICT | 12 |
| TRANSMISSION_MODEL_CONFLICT / alternatives | 72 |
| EXISTING_REVIEW | 2 |
| Уникальных requirements в объединённой очереди | 1 112 |

### 4.2. Structured volume parser

Raw text сохранён, но structured volumes нельзя переносить без повторного parsing:

- 336 requirements с текстом вида `4.0 ± 0.1 л.` получили structured volume `0.1`, то есть tolerance принят за capacity;
- из них 23 находятся даже в unique-target baseline;
- 4 requirements приняли `л.с.` за литры; пример Mazda 626: `136 л.с.` превратилось в `136 L`;
- отрицательных/нулевых объёмов и перевёрнутых ranges не найдено.

До исправления parser materializer должен считать raw `fillVolumeText` источником истины и блокировать подозрительные structured значения.

### 4.3. Dedupe preview

На 1 474 unique-target associations:

- 1 472 уникальных canonical payload fingerprints;
- 2 точных дубля;
- 279 покрытых MANN variants.

Dedupe должен объединять только одинаковый semantic payload в одинаковом vehicle/system/context. Разные engine/year/component/spec/capacity не объединяются.

### 4.4. Conflict preview

Автоматический preview на unique-target baseline нашёл:

- 6 `CAPACITY_CONFLICT` groups, 12 associations, 6 variants;
- 33 groups с несколькими transmission/component models, 72 associations, 28 variants;
- 11 groups с разными specification sets, 22 associations;
- 2 groups с разными viscosity sets, 4 associations.

Top capacity candidates:

| MANN variant | System | Значения |
|---|---|---|
| Audi A4 B8 3.2 FSI CALA | AT | service 0.5 / 1.1 L |
| Audi Q5 3.2 FSI CALB, DL501 | Robot | service 4.5 / 7.5 L |
| Audi Q7 3.0 TFSI CREC | AT | service 1.0 / 1.1 L |
| Subaru Forester SH 2.5 XT EJ25 | AT | service 9.3 / 10.0 L |
| Suzuki SX4 1.6 M16A | MT | service 2.1 / 2.5 L |
| Toyota Corolla E210 | Coolant | service 2.1 / 6.5 L |

Несколько component models не всегда являются ошибкой. Например один MANN engine variant может иметь ZF 6HP, ZF 8HP или другую коробку. Такие строки нужно сохранить как conditional alternatives и вернуть `technicalDataStatus = ambiguous`, пока VIN decode или пользователь не определит transmission/component model.

Multi-spec и несколько SAE также не являются конфликтом автоматически. Их можно объединять как допустимое множество только после semantic normalization; различие `RAW` строк само по себе недостаточно для `SPECIFICATION_CONFLICT`.

## 5. Возможность direct FK

**Без новой модели — нет.**

Причины:

1. `MannFilterApplication.vehicleVariantKey` не уникален и не может быть FK target.
2. Простой nullable `VehicleFluidRequirement.mannVariantKey` не поддерживает легитимную multi-applicability и смешивает source-normalized data с canonical runtime state.
3. Строковый FK без родительской vehicle table повторит текущую слабую гарантию.

Нужна migration, но её нельзя применять до отдельного approval и актуального Timeweb backup.

## 6. Предлагаемая конечная схема

```text
MannVehicleVariant                         canonical identity
  PK variantKey = текущий vehicleVariantKey
  make/model/generation/engine/power/years/condition
  sourceHash / catalog batch
  |
  +-- MannFilterApplication[]              MANN filter applicability
  |
  +-- MannVehicleTechnicalRequirement[]    materialized canonical association
        FK mannVariantKey
        FK sourceRequirementId
        FK materializationId
        systemCode
        applicability/context
        canonicalFingerprint
        matchClass: CONFIRMED | HIGH_AUTO
        status: ACTIVE | CONFLICT_REVIEW_REQUIRED
        conflictTypes[]
        provenance/evidence

MannTechnicalCatalogMaterialization
  sourceHash
  mannCatalogHash
  algorithmVersion
  status: PREVIEW | APPLIED | SUPERSEDED
  createdAt / appliedAt

VehicleFluidRequirement                    normalized source fact
  -> FluidSourceRow                        raw evidence
  -> FluidCatalogImportBatch               source snapshot

MannFluidRequirementLink                   import/matching provenance only
```

`MannVehicleVariant.variantKey` должен быть единственным ID автомобиля. У новой таблицы не должно быть второго numeric/cuid vehicle ID.

`MannVehicleTechnicalRequirement` не создаёт второй vehicle catalog: это дочерняя materialized association. Technical payload остаётся нормализованным, а разные systems/components остаются отдельными rows.

Рекомендуемые индексы, основанные на фактическом unified lookup:

- PK `MannVehicleVariant(variantKey)`;
- FK/index `MannFilterApplication(vehicleVariantKey)` — уже есть индекс;
- `MannVehicleTechnicalRequirement(mannVariantKey, status, systemCode)`;
- unique `(materializationId, mannVariantKey, sourceRequirementId)`;
- `MannVehicleTechnicalRequirement(materializationId, status)` для activation/audit.

## 7. Source/staging и runtime source of truth

Остаются source/staging:

- `fluid_catalog_import_batches`;
- `fluid_source_rows`;
- `vehicle_fluid_requirements`;
- `mann_fluid_requirement_links` как candidate/evidence table;
- raw JSON, URL, batch/hash, match evidence, reviewer data.

Дополнительно importer нужно сделать snapshot-safe: не удалять исторический raw source без архивного replacement. Варианты: versioned row IDs по batch или отдельная batch-row association. Это должно быть решено в migration design.

Runtime source of truth:

```text
MannVehicleVariant
  -> MannFilterApplication
  -> ACTIVE MannVehicleTechnicalRequirement
       -> VehicleFluidRequirement
            -> source provenance
```

Runtime не должен читать `MannFluidRequirementLink` и не должен заново match-ить `VehicleFluidRequirement` по make/model.

## 8. Materialization plan

Предлагаемый command: `npm run materialize:mann-technical-catalog -- [--apply]`.

Без `--apply` job обязан:

1. открыть read-only transaction;
2. зафиксировать source/MANN/schema/algorithm hashes;
3. построить registry 16 349 variants и проверить единственность context;
4. перечитать existing links как evidence, не как готовые facts;
5. переоценить links общими normalization/scoring/negative-evidence компонентами нового MANN resolver;
6. принять `CONFIRMED` и только доказанный unique `HIGH_AUTO`;
7. отправить multi-target, low/review и semantic conflicts в review queue;
8. повторно распарсить capacities из raw text исправленным parser;
9. выполнить semantic dedupe;
10. классифицировать conflicts;
11. сформировать JSON manifest, system/vehicle coverage TSV и review CSV;
12. не выполнять writes.

`--apply` допускается только после:

- отдельной approved Prisma migration;
- актуального Timeweb backup;
- чистого dry run на той же snapshot версии;
- `conflicts = 0` для ACTIVE rows либо явных reviewed decisions;
- activation новой materialization одной транзакцией.

Review CSV:

```text
sourceRequirementId, sourceVehicle, engine, years, systemCode, requirement,
candidateVariantKey, candidateVehicle, candidateEngine, score, evidence,
conflictTypes, decision, decidedBy, decidedAt
```

## 9. Unified service/API contract

После materialization нужен один service:

```ts
getVehicleTechnicalProfile(mannVariantKey, optionalDecodedContext)
```

Логический ответ:

```ts
{
  vehicle,
  filters,
  technicalProfile: {
    status: "available" | "partial" | "missing" | "ambiguous",
    fluids: {
      engineOil,
      automaticTransmission,
      cvt,
      robotTransmission,
      manualTransmission,
      transferCase,
      frontDifferential,
      rearDifferential,
      awdCoupling,
      powerSteering,
      coolant,
      brakeFluid,
      other
    }
  }
}
```

Один MANN variant может иметь несколько conditional requirements для одной системы. Service выбирает точный вариант только по transmission/component/engine/year evidence; иначе возвращает alternatives со статусом `ambiguous`, не случайное первое значение.

API можно встроить в существующий resolver response или добавить `GET /api/vehicle-catalog/mann/{variantKey}` согласно conventions проекта. Отдельные текущие filters routes можно оставить как compatibility layer.

## 10. Runtime/UI/AI cutover

Порядок cutover после верификации:

1. VIN/plate -> TRONK/vehicle identity -> MANN resolver;
2. подтверждённый `mannVariantKey` -> `getVehicleTechnicalProfile()`;
3. UI показывает vehicle + filters + только известные technical systems;
4. missing system возвращает `technicalDataStatus = missing`;
5. ambiguous transmission показывает необходимость уточнения, а не ложную рекомендацию;
6. oil recommendation прекращает второй make/model runtime matching;
7. AI использует unified profile первым, затем local products, ROSSKO и только потом verified external research;
8. AI/web facts не записываются в canonical catalog автоматически.

## 11. Verification gates

До production cutover обязательны:

- parser tests для `±`, `л.с.`, with/without filter, partial/total;
- single-target invariant или explicit confirmed multi-applicability;
- engine/fuel/year/transmission negative-evidence tests;
- FK/orphan checks;
- conflict and dedupe snapshot tests;
- random source-to-canonical audit минимум 100 variants;
- mixed-brand dataset: BMW, Mercedes, VAG, Toyota, Kia/Hyundai, Renault, Ford, Chinese brands; petrol/diesel/hybrid/CVT/DSG/AT/AWD;
- unseen VIN/plate end-to-end set;
- query-count and p50/p95 benchmark до/после;
- production shadow-read comparison до переключения UI/AI.

## 12. Итоговое архитектурное решение

1. Канонический ID: существующий MANN `vehicleVariantKey`.
2. Требуется формализовать его моделью `MannVehicleVariant` с тем же PK.
3. Требуется materialized child association, а не direct string field в source requirement.
4. `MannFluidRequirementLink` остаётся import/provenance layer.
5. Runtime должен читать только active canonical materialization.
6. Prisma migration требуется, но на этом этапе не создана и не применена.
7. Текущие links нельзя переносить wholesale: минимум 1 112 requirements уже требуют review, а structured capacity parser должен быть исправлен до materialization.
8. Первый безопасный baseline после блокировки multi-target links покрывает 279 из 16 349 MANN variants; coverage нужно показывать честно и расширять новыми verified imports.
