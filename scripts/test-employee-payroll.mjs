import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { employedOn, selectPieceworkRecipients, resolveEmployeeRule } = await jiti.import("../src/lib/employee-pay-settings.ts");
const rule = (targetType, targetId, amount = 100) => ({ targetType, targetId, targetName: targetId, mode: "percent", fixedCents: null, percentBasisPoints: amount });
const settings = { individualPiecework: true, pieceworkRules: [rule("all_services", "*"), rule("service", "oil", 200), rule("all_products", "*")] };
assert.equal(resolveEmployeeRule(settings, "service", "oil").percentBasisPoints, 200);
assert.equal(resolveEmployeeRule(settings, "service", "other").percentBasisPoints, 100);
assert.equal(resolveEmployeeRule(settings, "product_group", null).targetType, "all_products");
assert.equal(employedOn({ employmentEnd: "2026-10-20" }, "2026-10-20"), true);
assert.equal(employedOn({ employmentEnd: "2026-10-20" }, "2026-10-21"), false);
assert.equal(employedOn({}, "2026-10-01", "2026-10-02"), false);
assert.equal(employedOn({}, "2026-10-03", "2026-10-02"), true);
const staff = [{ login: "one", role: "master" }, { login: "two", role: "master" }];
const personal = new Map([["one", settings], ["two", { individualPiecework: true, pieceworkRules: [rule("all_products", "*")] }]]);
function select(targetType, targetId, settingsFor = (login) => personal.get(login) ?? {}, roleRule = () => undefined) {
  return selectPieceworkRecipients({ staff, settingsFor, targetType, targetId, roleRule });
}
assert.deepEqual(select("service", "oil").recipients.map((r) => r.login), ["one"]);
assert.deepEqual(select("product_group", "parts").recipients.map((r) => r.login), ["one", "two"]);
// An individual config replaces all role rules, including intentionally empty configs.
assert.equal(select("service", "oil", () => ({ individualPiecework: true, pieceworkRules: [] }), () => rule("service", "oil")).recipients.length, 0);
const conflict = select("service", "oil", () => ({}), (role) => role === "master" ? rule("service", "oil") : undefined);
assert.equal(conflict.recipients.length, 0);
assert.equal(conflict.conflicts.length, 1);
// One employee on individual rules and one on role rules must not conflict or stack.
const mixed = select("service", "oil", (login) => login === "one" ? settings : {}, (role) => role === "master" ? rule("service", "oil") : undefined);
assert.deepEqual(mixed.recipients.map((r) => r.login), ["one", "two"]);
assert.equal(mixed.conflicts.length, 0);
console.log("Employee payroll: dismissal boundaries, independent categories, override precedence, role fallback and conflicts passed.");
