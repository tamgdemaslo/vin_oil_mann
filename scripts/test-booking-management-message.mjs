import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync("src/lib/client-notifications/booking-management-message.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, URL });
const { appendBookingManagementLink: append } = exports;
const url = "https://example.com/booking/manage/personal-token";
const message = "Вы записаны. Ждём вас.";
for (const event of ["appointment_admin_created", "appointment_client_created"]) {
  const result = append(event, message, url);
  assert.ok(result.startsWith(message));
  assert.ok(result.includes(`href="${url}"`));
  assert.match(result, /перенести или отменить запись/);
  assert.equal(append(event, result, url), result);
  for (const invalid of ["", "https://example.com/booking", "javascript:alert(1)", "/booking/manage/token"]) {
    assert.equal(append(event, message, invalid), message);
  }
}
const escaped = `${url}?a=1&amp;b=2`;
assert.equal(append("appointment_admin_created", `<a href="${escaped}">Запись</a>`, `${url}?a=1&b=2`), `<a href="${escaped}">Запись</a>`);
assert.equal(append("appointment_cancelled", message, url), message);
console.log("Booking management notification checks passed");
