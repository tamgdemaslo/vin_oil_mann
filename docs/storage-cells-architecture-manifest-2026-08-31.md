# Складские ячейки — architecture manifest и migration proposal

Дата аудита: 2026-08-31

Статус: **schema migration required / production NO-GO до отдельного approval и проверенного backup Timeweb**.

Этот документ фиксирует состояние до реализации. В рамках аудита production, Prisma schema и данные не изменялись.

## 1. Текущая модель ячейки

Отдельной модели ячейки нет. Нет таблиц `StorageCell`, `ProductCell` или `ProductStorageAssignment`.

Слово «ячейка» сейчас хранится в нескольких независимых текстовых полях:

- `LocalProduct.cell` — branch-scoped, но не store-scoped строка;
- `LocalStockBalance.slotName` — строка для пары `productId + storeId`;
- `LocalInventoryDocumentPosition.slotName` — исторический/планируемый строковый снимок позиции документа;
- `InventoryLine.cellId`, `InventoryLedgerEntry.cellId`, `InventoryLock.cellId` — несмотря на имя, это строки без foreign key на справочник ячеек.

Следствие: код ячейки нельзя безопасно переименовать, архивировать или валидировать по `branchId/storeId`, а свободные ячейки в принципе не представлены в данных.

## 2. Текущая связь с `LocalProduct`

`LocalProduct.cell` — свободный текст. Relation и `cellId` у товара отсутствуют.

`LocalStockBalance` уже гарантирует не более одной строки остатка для `branchId + productId + storeId`, но `slotName` внутри этой строки не является объектом и не обеспечивает существование/активность ячейки.

`LocalProduct.cell` нельзя считать корректным store-scoped назначением: в филиале может быть несколько `LocalStore`.

## 3. Где используется `isPrimary`

В cell-архитектуре `isPrimary` отсутствует. Найденные в схеме одноимённые признаки относятся к другим сущностям.

Понятие «Основная ячейка товара» создано UI поверх `LocalProduct.cell`. В приёмке `makeDefaultCell` хранится в `raw` позиции и при проведении копирует `slotName` в `LocalProduct.cell`. Отдельной primary/secondary relation нет.

## 4. Может ли один товар сейчас иметь несколько ячеек

В рамках одной строки `LocalStockBalance` — нет: пара `productId + storeId` уникальна.

Фактически неоднозначность возможна:

- `LocalProduct.cell` и `LocalStockBalance.slotName` могут содержать разные значения;
- один товар может иметь разные `slotName` в разных складах, что допустимо целевой семантикой;
- старые документы могут содержать другие `slotName`; это история, а не текущее назначение;
- UI приёмки собирает «известные ячейки» из строк остатков и текущего документа и визуально называет значения дополнительными, хотя relation нет.

Поэтому A–E классификация primary/secondary relations неприменима буквально. Нельзя создавать фиктивные secondary relations только ради отчёта. Реальный `MANUAL_REVIEW` — конфликт двух текущих текстовых источников внутри одной пары `branchId + storeId + productId` или `LocalProduct.cell`, который нельзя однозначно привязать к единственному активному складу.

## 5. Количество ячеек по Branch/Store

Подтверждённые production counts пока отсутствуют:

- `.env.local` указывает на остановленную локальную PostgreSQL `127.0.0.1:5432/vin_oil_dev`;
- production credentials в рабочей копии отсутствуют;
- актуальный на 2026-08-31 проверенный Timeweb backup в workspace не найден;
- более старые архивы выведенной инфраструктуры не используются как runtime или основание production migration.

Добавлен read-only аудит:

```bash
STORAGE_CELL_AUDIT_DATABASE_URL='postgresql://…' npm run audit:storage-cells
```

Он возвращает по каждому Branch/Store:

- количество distinct нормализованных `LocalStockBalance.slotName` (только занятые inferred cells);
- число закреплённых карточек;
- case/whitespace collisions;
- branch-level legacy `LocalProduct.cell` без store placement;
- конфликты и число строк `MANUAL_REVIEW`;
- объём исторических document snapshots.

Скрипт начинает транзакцию `READ ONLY` и разрешает только локально восстановленный актуальный backup Timeweb, без прямого сетевого доступа к production. Свободные ячейки до миграции посчитать невозможно: их не существует как записей.

## 6. Сколько товаров имеют несколько назначений

Database constraint `LocalStockBalance(productId, storeId)` не позволяет несколько balance rows для одной пары. Read-only аудит всё равно проверяет нарушение constraint на фактической БД.

Отдельно считаются:

- несовпадающие `LocalProduct.cell` и `LocalStockBalance.slotName` для той же product/store пары;
- legacy cell без единственного однозначного склада;
- товары, размещённые в нескольких разных складах (это не ошибка целевой модели).

Числа должны быть зафиксированы из актуального Timeweb backup до backfill. До этого `manualReviewCount` считается неизвестным, а migration остаётся `NO-GO`.

## 7. Где приёмка сохраняет ячейку

`LocalInventoryDocumentPosition.slotName` сохраняет только код строкой. `selectedCellId` отсутствует.

Потоки `createLocalStockDocument` и `updateLocalStockDocument` записывают `slotName`; update пересоздаёт позиции. ROSSKO source metadata сохраняется отдельно, но relation на ячейку сохранять нечего.

При posting `postDraftReceiptStock` записывает `position.slotName` в `LocalStockBalance.slotName`, а при `makeDefaultCell` ещё и в `LocalProduct.cell`.

Draft сам по себе placement не меняет, пока документ не применяется. Этот принцип следует сохранить. Целевая draft-позиция должна хранить и `selectedCellId`, и неизменяемый `slotName` snapshot.

## 8. Почему dropdown не загружается

Справочника и list API нет.

Текущий `StockDocumentClient` строит `warehouseCellOptions` только из:

- остатков уже загруженных товаров;
- значений текущих позиций;
- `LocalProduct.cell` как fallback.

Это не список ячеек склада, не показывает пустые ячейки и допускает ручной ввод. Endpoint `/api/local-inventory/product-cells` возвращает лишь `product href -> text cell` и не управляет ячейками.

## 9. Существующие маршруты управления

Маршрутов CRUD ячеек нет.

Есть:

- `/api/local-inventory/stores` — read-only список складов для inventory admin;
- `/api/local-inventory/store-options` — активные склады текущего филиала;
- `/api/local-inventory/product-cells` — legacy text lookup для товаров;
- `/api/local-inventory/products/[id]` — карточка товара с legacy полем `cell`.

Новые endpoints следует разместить в существующем namespace, без параллельного `/api/local-stores`:

- `GET/POST /api/local-inventory/stores/[storeId]/cells`;
- `GET/PATCH/DELETE /api/local-inventory/stores/[storeId]/cells/[cellId]`;
- `GET /api/local-inventory/stores/[storeId]/cells/[cellId]/products`;
- `PATCH /api/local-inventory/products/[productId]/storage-cell`.

## 10. Нужна ли Prisma migration

**Да, обязательна.** Без неё нельзя обеспечить:

- справочник существующих, свободных и архивных ячеек;
- уникальность нормализованного кода внутри склада;
- связь по стабильному `cellId` при переименовании;
- database constraint «один товар + один склад = не более одной ячейки»;
- безопасный searchable dropdown только активных ячеек;
- `selectedCellId` в draft при сохранении строкового исторического snapshot.

Frontend-only или хранение нового JSON в `raw` отклонены: это не даёт FK/unique и создаёт второй источник истины.

## 11. Предлагаемая конечная схема

### `StorageCell`

- `id` — CUID;
- `branchId`;
- `storeId`;
- `code` — отображаемый код;
- `normalizedCode` — NFKC + trim/collapse whitespace + uppercase;
- `name` — необязательное название;
- `zone` — необязательная зона;
- `comment` — необязательный комментарий;
- `archived`, `archivedAt`, `archivedById`;
- `createdById`, `createdAt`, `updatedAt`.

Constraints:

- FK `(branchId, storeId) -> LocalStore(branchId, id)`;
- unique `(branchId, storeId, normalizedCode)`;
- composite unique `(branchId, storeId, id)` для branch/store-safe assignment FK.

### `ProductStorageAssignment`

- `id`;
- `branchId`;
- `productId`;
- `storeId`;
- `cellId`;
- `assignedAt`;
- `assignedById`.

Constraints:

- unique `(branchId, productId, storeId)`;
- FK product `(branchId, productId)`;
- FK store `(branchId, storeId)`;
- FK cell `(branchId, storeId, cellId)`.

`cellId` не уникален: одна ячейка содержит много товаров.

### `LocalInventoryDocumentPosition`

Добавить nullable `selectedCellId`, сохранить существующий `slotName` как snapshot. FK должен блокировать physical delete использованной ячейки; такая ячейка архивируется. Это сохраняет историческую целостность при rename.

### Branch query policy

`StorageCell` и `ProductStorageAssignment` должны быть добавлены в `BRANCH_SCOPED_MODELS` в `src/lib/db.ts`. Любой write выполняется только в server-resolved branch context. `storeId`, `productId` и `cellId` повторно сверяются в одной транзакции.

## 12. План безопасного backfill

Backfill только additive и только после актуального read-only отчёта:

1. Создать `StorageCell` из distinct нормализованных непустых `LocalStockBalance.slotName` в каждой паре branch/store.
2. Схлопнуть только case/whitespace variants одного normalized code; сохранить варианты в migration report. Не объединять разные normalized codes эвристически.
3. Создать assignment из каждого непустого store-scoped `LocalStockBalance.slotName`.
4. Если `LocalProduct.cell` совпадает с store-scoped кодом — считать подтверждением, не создавать дубль.
5. Если у товара нет store-scoped placement, но в Branch ровно один активный Store — создать cell/assignment из `LocalProduct.cell`.
6. Если `LocalProduct.cell` конфликтует с `LocalStockBalance.slotName` в той же product/store паре — `MANUAL_REVIEW`, без автоматического выбора.
7. Если legacy `LocalProduct.cell` нельзя привязать к единственному активному складу — `MANUAL_REVIEW`.
8. Не переносить `slotName` старых документов в текущее assignment. Они используются только для создания/привязки historical cells и snapshot integrity, без изменения текущего размещения.
9. Проверить нулевые нарушения branch/store FK, нулевые duplicate assignments и совпадение safe-row counts.
10. Только после разрешения всех `MANUAL_REVIEW` включать новые API/UI.

Не выбирать ячейку по `createdAt`, ID, последнему документу или первой найденной строке.

## 13. Cutover без потери истории

Рекомендуемые фазы:

1. **Backup + dry-run:** актуальный Timeweb backup, restore verification, `npm run audit:storage-cells`, зафиксированный JSON report.
2. **Additive migration:** новые таблицы/колонка/FK/index, legacy поля не удалять.
3. **Backfill transaction:** только подтверждённые строки; `MANUAL_REVIEW = 0` для автоматического cutover либо отдельный утверждённый mapping.
4. **Application release:** API/UI читают assignment, draft пишет `selectedCellId + slotName snapshot`, posting атомарно применяет assignment и обычный приход.
5. **Verification:** counts, branch/store isolation, posting/cancel, audit actions, health checks.
6. **Поздняя cleanup migration:** `LocalProduct.cell` и operational use `LocalStockBalance.slotName` удаляются только отдельной задачей после периода dual-read. Historical `LocalInventoryDocumentPosition.slotName` остаётся.

## 14. Права и audit

Новые permission rows не нужны. Для CRUD ячеек используется существующее складское право `warehouses.manage`/`branches.manage` и роли owner/admin. Сотрудник, имеющий право проводить приёмку, может выбрать существующую активную ячейку. Изменение placement из карточки требует существующего права редактировать товары.

`BranchAuditLog` используется с actions:

- `STORAGE_CELL_CREATED`;
- `STORAGE_CELL_UPDATED`;
- `STORAGE_CELL_ARCHIVED`;
- `STORAGE_CELL_DELETED`;
- `PRODUCT_STORAGE_CELL_CHANGED`;
- `PRODUCT_STORAGE_CELL_CLEARED`;
- `STORAGE_CELL_PRODUCTS_REASSIGNED`.

Audit metadata хранит store/product/cell IDs, старый и новый коды, количество переназначенных карточек и документ-источник. Изменение placement не создаёт quantity movement.

## 15. Планируемые файлы реализации после approval

Schema и migration:

- `prisma/schema.prisma`;
- `prisma/migrations/<timestamp>_storage_cells/migration.sql`;
- `src/lib/db.ts`.

Backend:

- новый `src/lib/storage-cells.ts`;
- новые route handlers под `src/app/api/local-inventory/stores/[storeId]/cells/`;
- новый `src/app/api/local-inventory/products/[productId]/storage-cell/route.ts`;
- `src/lib/local-inventory-admin.ts`;
- `src/lib/local-inventory-read.ts`;
- при необходимости `src/lib/warehouse-inventory.ts` для перехода с текстового current placement на assignment.

UI:

- новые `src/app/inventory/cells/page.tsx` и client component;
- `src/app/inventory/InventoryNav.tsx`;
- `src/lib/navigation-policy.mjs`;
- `src/components/AppHeader.tsx`;
- `src/components/platform/RouteTitle.tsx`;
- `src/app/inventory/StockDocumentClient.tsx`;
- `src/app/inventory/products/ProductsClient.tsx`;
- `src/app/globals.css` (с сохранением уже находящихся там изменений ROSSKO).

Проверки:

- новый targeted test `scripts/test-storage-cells.mjs` на 30 acceptance cases;
- `package.json`;
- обновление branch-isolation/static audit scripts для новых моделей и routes.

## 16. Gate для продолжения

До реализации schema/API/UI нужны одновременно:

1. ID и timestamp актуального backup PostgreSQL Timeweb;
2. подтверждение restore/read verification;
3. JSON от `npm run audit:storage-cells` на этом backup;
4. разрешённые `MANUAL_REVIEW` или утверждённый mapping;
5. отдельное одобрение additive migration.

До выполнения gate production автоматически не изменяется, migration не создаётся и не применяется.
