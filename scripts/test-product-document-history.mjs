import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const serviceSource = read("src/lib/product-document-history.ts");
const routeSource = read("src/app/api/local-products/[productId]/history/route.ts");
const panelSource = read("src/components/products/ProductHistoryPanel.tsx");
const productsSource = read("src/app/inventory/products/ProductsClient.tsx");

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { effectiveHistoryDirection } = await jiti.import(path.join(root, "src/lib/product-document-history.ts"));

assert.equal(effectiveHistoryDirection("posted", "in"), "in", "posted receipt must show incoming movement");
assert.equal(effectiveHistoryDirection("posted", "out"), "out", "posted shipment must show outgoing movement");
assert.equal(effectiveHistoryDirection("draft", "in"), "none", "draft must not look like applied stock");
assert.equal(effectiveHistoryDirection("cancelled", "out"), "none", "cancelled document must not look like applied stock");
assert.equal(effectiveHistoryDirection("reversed", "out"), "none", "reversed document must not look like current movement");

assert.match(serviceSource, /id: productId,[\s\S]*branchId:/, "product lookup must bind id to an allowed branch");
assert.match(serviceSource, /laterDate\(input\.filters\?\.dateFrom, product\.createdAt\)/, "history must not predate this LocalProduct card");
assert.match(serviceSource, /positions: \{ some: \{ branchId, productId \} \}/, "shipment and stock documents must join exact document positions");
assert.match(serviceSource, /lines: \{ some: \{ branchId, productId \} \}/, "inventory must join exact inventory lines");
assert.match(serviceSource, /items: \{ some: \{ productId \} \}/, "branch transfers must join exact transfer items");
assert.doesNotMatch(serviceSource, /article:\s*product|name:\s*product/, "history joins must not use product article or name");
assert.match(serviceSource, /orderBy: \[\{ momentAt: "desc" \}, \{ id: "desc" \}\]/, "business documents need stable newest-first ordering");
assert.match(serviceSource, /encodeCursor\(page\[page\.length - 1\]!\)/, "history must expose a cursor for the next page");
assert.match(serviceSource, /take = limit \+ 1/, "history must not load an unbounded timeline");
assert.match(serviceSource, /isDeleted: false/, "soft-deleted stock documents must stay out of history");
assert.match(serviceSource, /documentTypeLabel: "Отгрузка"/, "shipments must be normalized into the shared timeline");
assert.match(serviceSource, /label: "Приёмка"/, "receipts must be normalized into the shared timeline");
assert.match(serviceSource, /label: "Списание"/, "write-offs must be normalized into the shared timeline");
assert.match(serviceSource, /label: "Корректировка"/, "technical adjustments must be normalized into the shared timeline");
assert.match(serviceSource, /documentTypeLabel: "Инвентаризация"/, "inventory sessions must be normalized into the shared timeline");
assert.match(serviceSource, /documentTypeLabel: "Перемещение между филиалами"/, "branch transfers must be normalized into the shared timeline");
assert.match(serviceSource, /href: `\/shipment\//, "shipments must link to the existing shipment page");
assert.match(serviceSource, /\/inventory\/receipts\?document=/, "receipts must link to the existing receipt page");
assert.match(serviceSource, /\/inventory\/writeoffs\?document=/, "writeoffs must link to the existing writeoff page");
assert.match(serviceSource, /\/warehouse\/inventory\//, "inventory sessions must link to the existing inventory page");
assert.match(serviceSource, /WITH applied_movements AS/, "the 30-day summary must be computed independently of timeline pagination");
assert.match(serviceSource, /document\.applicable = TRUE/, "the 30-day summary must exclude draft business documents");
assert.match(serviceSource, /document\.cancelled_at IS NULL/, "the 30-day summary must exclude cancelled stock documents");
assert.match(serviceSource, /COUNT\(\*\) FILTER \(WHERE quantity_delta <> 0\)/, "the 30-day document count must include only real movements");
assert.doesNotMatch(serviceSource, /buyPriceCentsPerUnit|unitCostSnapshot|margin/, "the history endpoint must not expose financial fields");

assert.match(routeSource, /requireBranchApi\(\{ allowAll: true, requireActive: false \}\)/, "route must support an allowed all-branches owner context");
assert.match(routeSource, /allowedBranchIds:/, "route must pass only server-resolved branch ids");
assert.doesNotMatch(routeSource, /search\.get\("branchId"\)/, "route must not trust a client branch id");
assert.match(routeSource, /Cache-Control": "private, no-store"/, "product history must not leak through shared caches");

assert.match(panelSource, /useState<HistoryPeriod>\("90"\)/, "UI must default to 90 days");
assert.match(panelSource, /Номер документа/, "UI must provide document-number search");
assert.match(panelSource, /Все склады/, "UI must provide a warehouse filter");
assert.match(panelSource, /Этот товар пока не участвовал ни в одном документе/, "UI must teach users in the empty state");
assert.match(panelSource, /HistorySkeleton/, "history must load independently with a skeleton");
assert.match(panelSource, /За 30 дней/, "UI must render the fixed 30-day movement summary");
assert.match(panelSource, /incomingQuantity30Days/, "UI must show applied incoming quantity");
assert.match(panelSource, /outgoingQuantity30Days/, "UI must show applied outgoing quantity");
assert.match(productsSource, /ProductHistoryPanel productId=\{editingId\}/, "saved products must render their history panel");
assert.match(productsSource, /product-history-mobile-tabs/, "mobile editor must expose history as a separate tab");

console.log("Product document history tests: PASS");
