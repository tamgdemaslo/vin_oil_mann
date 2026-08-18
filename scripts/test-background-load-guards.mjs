#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

function expect(file, patterns) {
  const source = read(file);
  for (const pattern of patterns) {
    if (!pattern.test(source)) failures.push(`${file}: отсутствует ${pattern}`);
  }
}

function reject(file, patterns) {
  const source = read(file);
  for (const pattern of patterns) {
    if (pattern.test(source)) failures.push(`${file}: запрещено ${pattern}`);
  }
}

expect("src/app/api/crm/deadline-notifications/route.ts", [
  /__crmDeadlineProcessingByBranch/,
  /current\.inFlight\s*\|\|\s*now\s*<\s*\(current\.nextAllowedAt/,
  /scheduleDeadlineProcessing\(branchId\)/,
]);
reject("src/app/api/crm/deadline-notifications/route.ts", [
  /await\s+processClientCaseDeadlineNotifications\(\)/,
]);

expect("src/components/platform/PlatformShell.tsx", [
  /document\.visibilityState\s*!==\s*"visible"/,
  /deadlineLoadInFlightRef\.current/,
  /document\.addEventListener\("visibilitychange", refresh\)/,
]);

expect("src/lib/product-oem-worker.ts", [
  /PRODUCT_OEM_WORKER_IDLE_INTERVAL_MS/,
  /PRODUCT_OEM_WORKER_ERROR_BACKOFF_MS/,
  /consecutiveFailures/,
  /scheduleNext\(processedItemCount\(results\)\s*>\s*0\s*\?\s*activeIntervalMs\(\)\s*:\s*idleIntervalMs\(\)\)/,
]);
reject("src/lib/product-oem-worker.ts", [/setInterval\(/]);

for (const file of [
  "src/app/ai-assistant/AIAssistantClient.tsx",
  "src/app/salary/SalaryDashboard.tsx",
  "src/components/messenger/AIAgentPanel.tsx",
  "src/components/messenger/MessengerUi.tsx",
  "src/components/products/ProductOemBatchPanel.tsx",
]) {
  expect(file, [/document\.visibilityState/]);
}

if (failures.length) {
  console.error(`Background load guard checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Background load guard checks passed (single-flight CRM, visible-tab polling, adaptive OEM backoff). ");
