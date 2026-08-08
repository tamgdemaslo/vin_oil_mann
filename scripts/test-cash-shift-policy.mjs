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

expect("src/lib/cashbox.ts", [
  /const canRepeatCashShiftToday = user\.role === "owner"/,
  /const existingForServiceDate = canRepeatCashShiftToday\s*\? null\s*:\s*await prisma\.cashShift\.findFirst/,
  /where:\s*\{\s*branchId,\s*status:\s*"open"\s*\}/,
  /canRepeatCashShiftToday[\s\S]*\? "Кассовая смена уже открыта"/,
]);
reject("src/lib/cashbox.ts", [/branchId_serviceDate/]);

expect("prisma/schema.prisma", [
  /model CashShift\s*\{[\s\S]*?@@index\(\[branchId, serviceDate\], map: "cash_shifts_branch_id_service_date_idx"\)[\s\S]*?\n\}/,
]);
reject("prisma/schema.prisma", [
  /model CashShift\s*\{[\s\S]*?@@unique\(\[branchId, serviceDate\]\)[\s\S]*?\n\}/,
]);

expect("prisma/migrations/20260808130000_owner_repeat_cash_shifts/migration.sql", [
  /DROP INDEX IF EXISTS "cash_shifts_branch_id_service_date_key"/,
  /CREATE INDEX "cash_shifts_branch_id_service_date_idx"/,
  /CREATE UNIQUE INDEX "cash_shifts_non_owner_service_date_key"/,
  /COALESCE\("opened_by_role", ''\) <> 'owner'/,
  /cash_shifts_branch_single_open_idx/,
]);

if (failures.length) {
  console.error(`Cash shift policy checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Cash shift policy checks passed (owner repeat opening, single active shift, non-owner daily limit).");
