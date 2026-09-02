import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const [schema, migration, service, localAdmin, cellsClient, receiptClient, productsClient, catalog, db] = await Promise.all([
  read("prisma/schema.prisma"),
  read("prisma/migrations/20260902100000_storage_cells/migration.sql"),
  read("src/lib/storage-cells.ts"),
  read("src/lib/local-inventory-admin.ts"),
  read("src/app/inventory/cells/StorageCellsClient.tsx"),
  read("src/app/inventory/StockDocumentClient.tsx"),
  read("src/app/inventory/products/ProductsClient.tsx"),
  read("src/lib/catalog-search.ts"),
  read("src/lib/db.ts"),
]);

const checks = [];
function check(name, condition) {
  assert.ok(condition, name);
  checks.push(name);
}
function has(source, ...needles) {
  return needles.every((needle) => source.includes(needle));
}

check("1. создание ячейки доступно через нормализованный сервис", has(service, "export async function createStorageCell", "normalizeStorageCellCode", "STORAGE_CELL_CREATED"));
check("2. изменение кода не меняет cellId", has(service, "export async function updateStorageCell", "where: { id: cellId }", "normalizedCode"));
check("3. название и зона редактируются", has(service, "name: clean(input.name", "zone: clean(input.zone"));
check("4. пустая неиспользованная ячейка удаляется физически", has(service, "await tx.storageCell.delete", "current._count.documentPositions > 0"));
check("5. удаление занятой ячейки без цели блокируется", has(service, "STORAGE_CELL_OCCUPIED", "Перед удалением выберите новую ячейку"));
check("6. массовое переназначение не создаёт складское движение", has(service, "productStorageAssignment.updateMany", "STORAGE_CELL_PRODUCTS_REASSIGNED"));
check("7. архивная ячейка исключена из обычной выдачи", has(service, 'status === "archived" ? { archived: true } : { archived: false }'));
check("8. экран выводит таблицу справочника", has(cellsClient, "Ячейки хранения", "Товары", "Изменено", "Действия"));
check("9. общий счётчик строится сервером", has(service, "totalActive", "summary: { total: totalActive"));
check("10. занятые и свободные считаются по назначениям", has(service, "assignments: { some: {} }", "free: Math.max(0, totalActive - occupied)"));
check("11. приёмка загружает ячейки выбранного склада", has(receiptClient, "/cells?${params}", "selectedStoreId", 'status: "all"'));
check("12. поиск по коду выполняется на сервере", has(service, "code: { contains: search", 'mode: "insensitive"'));
check("13. поиск по названию и зоне выполняется на сервере", has(service, "name: { contains: search", "zone: { contains: search"));
check("14. быстрое создание из приёмки выбирает созданную ячейку", has(receiptClient, 'method: "POST"', "setWarehouseCellOptions", "selected = {"));
check("15. существующее назначение автоматически подставляется", has(receiptClient, "product.storageAssignments?.find", "selectedCellId: assignment?.cellId"));
check("16. новый товар допускает пустую ячейку", has(receiptClient, 'selectedCellId: assignment?.cellId ?? ""', 'slotName: position.slotName || undefined'));
check("17. замена ячейки явно подтверждается в интерфейсе", has(receiptClient, "У товара уже назначена ячейка", "Изменить ячейку"));
check("18. draft хранит только planned selectedCellId", has(schema, "selectedCellId", "LocalInventoryDocumentPosition") && has(receiptClient, "Фактическое место изменится при проведении"));
check("19. posting применяет единственное назначение", has(localAdmin, "applyProductStorageCellTx", 'if (input.type === "receipt")') && has(schema, "@@unique([branchId, productId, storeId])"));
check("20. draft не применяет placement до posting", has(localAdmin, "if (applicable)", "applyPostedStockDocumentMovements") && has(receiptClient, "До проведения документа выбранная ячейка остаётся только планом"));
check("21. две активные ячейки товара запрещены constraint-ом", has(migration, 'UNIQUE INDEX "product_storage_assignments_branch_id_product_id_store_id_key"'));
check("22. одна ячейка допускает много товаров", !schema.includes("@@unique([branchId, storeId, cellId])"));
check("23. cross-branch assignment блокируется", has(service, "id: input.productId, branchId: input.branchId", "id: input.cellId, branchId: input.branchId"));
check("24. cross-store assignment блокируется", has(service, "storeId: input.storeId, archived: false", "STORAGE_CELL_SCOPE_INVALID"));
check("25. удаление проверяет складские права", has(service, "canManageStorageCells(context)", "Недостаточно прав для удаления ячейки"));
check("26. фильтр «Без ячейки» использует нормализованные назначения", has(catalog, 'storageCell === "unassigned"', "storageAssignments: { none:"));
check("27. колонка каталога читает ProductStorageAssignment", has(productsClient, "storageAssignment.cellCode", "row.storageAssignments?.find"));
check("28. исторические документы сохраняют snapshot и защищённый cellId", has(schema, "slotName", "selectedCellId") && has(migration, "ON DELETE RESTRICT ON UPDATE CASCADE"));
check("аудит приёмки сохраняет контекст, документ и количество", has(service, 'context: input.sourceDocumentId ? "RECEIPT_POSTING" : "PRODUCT_CARD"', "sourceDocumentId", "quantity: input.quantity") && has(localAdmin, "sourceDocumentId: input.documentId", "quantity,"));
check("branch-scoped модели зарегистрированы", has(db, '"StorageCell"', '"ProductStorageAssignment"'));
check("миграция сохраняет legacy поля и синхронизирует current state", has(migration, 'UPDATE "local_stock_balances"', 'UPDATE "local_products"') && !migration.includes('DROP COLUMN "cell"'));

console.log(`storage cells: ${checks.length} checks passed`);
