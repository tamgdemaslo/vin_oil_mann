import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const migration = [
  "prisma/migrations/20260728170000_critical_composite_branch_fks/migration.sql",
  "prisma/migrations/20260728180000_file_and_stock_composite_branch_fks/migration.sql",
].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const reportPath = path.join(root, "docs/branch-composite-relations.md");

const critical = [
  ["PayrollPeriodEmployee", "period", "period_id", "Restrict"], ["PayrollAccrualLine", "period", "period_id", "Restrict"],
  ["LocalDemand", "counterparty", "counterparty_id", "Restrict"], ["LocalDemand", "store", "store_id", "Restrict"],
  ["ShipmentRevision", "shipment", "shipment_id", "Cascade"], ["LocalDemandPosition", "demand", "demand_id", "Cascade"],
  ["LocalDemandPosition", "product", "product_id", "Restrict"], ["InventoryLedgerEntry", "shipment", "shipment_id", "Restrict"],
  ["InventoryLedgerEntry", "product", "product_id", "Restrict"], ["InventoryLedgerEntry", "store", "store_id", "Restrict"],
  ["MessengerMessage", "conversation", "conversation_id", "Cascade"], ["MessengerOutbox", "conversation", "conversation_id", "Restrict"],
  ["MessengerAttachment", "message", "message_id", "Cascade"], ["DiagnosticPosition", "diagnostic", "diagnostic_id", "Cascade"],
  ["DiagnosticPhoto", "position", "position_id", "Cascade"], ["DiagnosticOffer", "diagnostic", "diagnostic_id", "Cascade"],
  ["DiagnosticMapSession", "demand", "demand_id", "Restrict"], ["DiagnosticMapItem", "session", "session_id", "Cascade"],
  ["DiagnosticMapPhoto", "item", "item_id", "Cascade"], ["InventorySession", "warehouse", "warehouse_id", "Restrict"],
  ["InventoryLine", "session", "inventory_session_id", "Cascade"], ["InventoryLine", "product", "product_id", "Restrict"],
  ["InventoryLine", "warehouse", "warehouse_id", "Restrict"], ["InventoryCountEntry", "line", "inventory_line_id", "Cascade"],
  ["TelegramUserSession", "messengerAccount", "messenger_account_id", "Cascade"],
  ["MessengerConversation", "connection", "connection_id", "Restrict"],
  ["MessengerConversation", "messengerAccount", "messenger_account_id", "Restrict"],
  ["MessengerMessage", "messengerAccount", "messenger_account_id", "Restrict"],
  ["MessengerOutbox", "message", "message_id", "Restrict"],
  ["MessengerOutbox", "connection", "connection_id", "Restrict"],
  ["MessengerOutbox", "messengerAccount", "messenger_account_id", "Restrict"],
  ["MessengerMediaJob", "attachment", "attachment_id", "Cascade"],
  ["MessengerDeliveryEvent", "message", "message_id", "Cascade"],
  ["MessengerSyncCursor", "messengerAccount", "messenger_account_id", "Cascade"],
  ["DiagnosticOffer", "diagnostic", "diagnostic_id", "Cascade"],
  ["DiagnosticMapVehiclePhoto", "session", "session_id", "Cascade"],
  ["InventoryAttachment", "line", "inventory_line_id", "Cascade"],
  ["LocalProductPhoto", "product", "product_id", "Cascade"],
  ["LocalStockBalance", "product", "product_id", "Cascade"],
  ["LocalStockBalance", "store", "store_id", "Cascade"],
];

function modelBody(name) {
  return schema.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
}

const rows = critical.map(([model, relation, column, deletePolicy]) => {
  const body = modelBody(model);
  const line = body.split("\n").find((candidate) => new RegExp(`^\\s*${relation}\\s+`).test(candidate)) ?? "";
  const composite = /fields:\s*\[\s*branchId\s*,/.test(line) && /references:\s*\[\s*branchId\s*,\s*id\s*\]/.test(line);
  const migrationCovered = migration.includes(column) && migration.includes("FOREIGN KEY (branch_id");
  return {
    model,
    relation,
    column,
    deletePolicy,
    composite,
    migrationCovered,
    status: composite && migrationCovered ? "ENFORCED" : "BLOCKER",
  };
});

const blockers = rows.filter((row) => row.status === "BLOCKER");
const markdown = `# Critical composite branch relations\n\n` +
  `Generated from Prisma schema and migrations 20260728170000/20260728180000. Critical relations: **${rows.length}**; blockers: **${blockers.length}**. ` +
  `Optional durable business references use RESTRICT; owned child records use CASCADE.\n\n` +
  `| model | relation | FK column | Prisma composite | migration | onDelete | status |\n|---|---|---|---:|---:|---|---|\n` +
  rows.map((row) => `| ${row.model} | ${row.relation} | ${row.column} | ${row.composite ? "yes" : "no"} | ${row.migrationCovered ? "yes" : "no"} | ${row.deletePolicy} | ${row.status} |`).join("\n") + "\n\n" +
  `Polymorphic fields such as \`sourceType/sourceId\`, AI snapshot references, and messenger context entity links cannot have a static FK. ` +
  `They remain protected by server-side branch invariants and are tracked as integration-test obligations.\n`;

if (process.argv.includes("--write")) {
  fs.writeFileSync(reportPath, markdown);
  console.log(`Composite relation audit written: ${rows.length} relations, ${blockers.length} blockers.`);
} else {
  const current = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
  if (current !== markdown) {
    console.error("Composite relation audit is stale. Run with --write.");
    process.exitCode = 1;
  }
}
if (blockers.length) {
  blockers.forEach((row) => console.error(`BLOCKER ${row.model}.${row.relation}`));
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log(`Branch relation audit passed (${rows.length} critical relations).`);
}
