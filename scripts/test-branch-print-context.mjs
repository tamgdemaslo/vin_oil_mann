#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import createJiti from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": path.join(root, "src") } });

const { branchPrintContextFromRecord } = await jiti.import(path.join(root, "src/lib/branch-print-context.ts"));
const { formatPhoneForDisplay } = await jiti.import(path.join(root, "src/lib/phone-normalize.ts"));

function branchRecord(id, primaryPhone, legacyPhone = null) {
  return {
    id,
    name: `Филиал ${id}`,
    shortName: id,
    address: `Адрес ${id}`,
    phone: legacyPhone,
    email: null,
    legalEntityName: null,
    inn: null,
    ogrn: null,
    communication: primaryPhone == null
      ? null
      : { primaryPhone, email: null, telegram: null, callbackSettingsJson: null },
    legalEntities: [],
  };
}

const branchA = branchPrintContextFromRecord(branchRecord("branch-a", "79506764616", "+7 (999) 000-00-00"));
const branchB = branchPrintContextFromRecord(branchRecord("branch-b", "+7 921 555 33 44"));
assert.equal(branchA.phone, "+7 (950) 676-46-16", "Branch A must use communication.primaryPhone, not its legacy mirror");
assert.equal(branchB.phone, "+7 (921) 555-33-44", "Branch B must keep its own phone");
assert.notEqual(branchA.phone, branchB.phone, "Different branches must not share a print phone");
assert.equal(branchPrintContextFromRecord(branchRecord("legacy", null, "89991234567")).phone, "+7 (999) 123-45-67", "Legacy fallback must stay inside the same branch");
assert.equal(branchPrintContextFromRecord(branchRecord("missing", null, null)).phone, "", "Missing phone must stay empty");
assert.equal(formatPhoneForDisplay("+49 30 123456"), "+49 30 123456", "International formatting must be preserved");
assert.equal(formatPhoneForDisplay("9506764616"), "+7 (950) 676-46-16", "A ten-digit Russian mobile number must be formatted with +7");
assert.equal(branchPrintContextFromRecord(branchRecord("branch-a", "+7 401 234 56 78")).phone, "+7 (401) 234-56-78", "The next print must see the updated canonical phone");

const failures = [];
function expect(file, patterns) {
  const source = read(file);
  for (const pattern of patterns) if (!pattern.test(source)) failures.push(`${file}: отсутствует ${pattern}`);
}
function reject(file, patterns) {
  const source = read(file);
  for (const pattern of patterns) if (pattern.test(source)) failures.push(`${file}: запрещено ${pattern}`);
}

expect("src/lib/branch-print-context.ts", [
  /branch\.communication\?\.primaryPhone \|\| branch\.phone/,
  /resolveBranchPrintContext\(branchId/,
]);
expect("src/lib/document-print-access.ts", [
  /where: \{ id: shipmentId, branchId: \{ in: ids \} \}/,
  /mode: "branch"/,
  /branchId: access\.branchId/,
  /allowedBranchIds: \[access\.branchId\]/,
]);
expect("src/lib/job-order-poster-data.ts", [
  /resolveBranchPrintContext\(loaded\.data\.branchId\)/,
  /phone: branchPrint\?\.phone \|\| ""/,
]);
expect("src/lib/job-order-xls.ts", [
  /resolveBranchPrintContext\(payload\.branchId\)/,
  /phones: branchPrint\?\.phone \|\| ""/,
]);
expect("src/components/print/UnderHoodTags.tsx", [/o\.ip\.phone/, /\{o\.ip\.phone\}/]);
expect("src/lib/diagnostic-map-service.ts", [
  /publicReportContactSettings\(row\.branchId\)/,
  /publicPhone: branchPrint\?\.phone \|\| null/,
]);
expect("src/lib/closing-documents.ts", [
  /resolveBranchPrintContext\(demand\.branchId\)/,
  /resolveBranchPrintContext\(row\.branchId\)/,
  /phone: branchPrint\?\.phone \|\| ""/,
]);
for (const file of [
  "src/app/shipment/[id]/poster/page.tsx",
  "src/app/shipment/[id]/tags/page.tsx",
  "src/app/api/demands/[id]/job-order/route.ts",
  "src/app/api/demands/[id]/closing-documents/route.ts",
]) {
  expect(file, [/resolveShipmentPrintAccess/, /runWithDocumentPrintAccess/]);
}
expect("src/lib/branches.ts", [
  /if \(!context\.canManageBranches\)/,
  /branchCommunicationSettings\.upsert/,
  /action: "BRANCH_CONTACT_PHONE_UPDATED"/,
  /data\.phone = canonicalPhone \|\| null/,
]);
expect("src/app/cabinet/branches/page.tsx", [
  /Используется в заказ-нарядах, бирках и других документах этого филиала/,
  /Не указан основной телефон/,
  /Используется в документах/,
]);

for (const file of [
  "src/components/print/UnderHoodTags.tsx",
  "src/components/diagnostic/DiagnosticPublicReport.tsx",
  "src/lib/job-order-poster-data.ts",
  "src/lib/job-order-xls.ts",
  "src/lib/closing-documents.ts",
]) {
  reject(file, [
    /8 \(995\) 054-58-59/,
    /\+7 \(995\) 054-58-59/,
    /process\.env\.(?:POSTER_PHONE|POSTER_CONTACT_PHONE|COMPANY_PHONE|NEXT_PUBLIC_COMPANY_PHONE|CLOSING_SELLER_PHONE|JOB_ORDER_SELLER_PHONES)/,
  ]);
}
reject("src/components/print/UnderHoodTags.tsx", [/SERVICE_PHONE/]);
reject("src/app/api/demands/[id]/job-order/route.ts", [/body\.phone/, /request\.json\(\)/]);

if (failures.length) {
  console.error(`Branch print context checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Branch print context checks passed (order, tag, diagnostics, closing documents, permissions and isolation).");
