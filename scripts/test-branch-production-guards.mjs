import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const tenant = await jiti.import("../src/lib/request-tenant-store.ts");
const effects = await jiti.import("../src/lib/external-side-effects.ts");

assert.throws(() => tenant.getScopedBranchId(), /Branch context is required/);
const scoped = tenant.runWithRequestTenant(
  { mode: "branch", branchId: "branch-test", organizationId: "org-test", allowedBranchIds: ["branch-test"] },
  () => tenant.getScopedBranchId()
);
assert.equal(scoped, "branch-test");
assert.throws(
  () => tenant.runWithRequestTenant(
    { mode: "all", branchId: null, organizationId: null, allowedBranchIds: ["branch-test"] },
    () => tenant.getScopedBranchId()
  ),
  /выберите конкретный/
);

const previous = {
  appEnv: process.env.APP_ENV,
  master: process.env.EXTERNAL_SIDE_EFFECTS_ENABLED,
  telegram: process.env.TELEGRAM_SEND_ENABLED,
  yclients: process.env.YCLIENTS_MUTATIONS_ENABLED,
  moysklad: process.env.MOYSKLAD_MUTATIONS_ENABLED,
  rossko: process.env.ROSSKO_ORDER_ENABLED,
  tbank: process.env.TBANK_MUTATIONS_ENABLED,
};
process.env.APP_ENV = "branch-migration-rehearsal";
process.env.EXTERNAL_SIDE_EFFECTS_ENABLED = "false";
process.env.TELEGRAM_SEND_ENABLED = "false";
process.env.YCLIENTS_MUTATIONS_ENABLED = "false";
process.env.MOYSKLAD_MUTATIONS_ENABLED = "false";
process.env.ROSSKO_ORDER_ENABLED = "false";
process.env.TBANK_MUTATIONS_ENABLED = "false";
assert.equal(effects.externalSideEffectAllowed("telegram_send"), false);
assert.throws(() => effects.assertExternalSideEffectAllowed("telegram_send"), /blocked/);
assert.throws(() => effects.assertExternalSideEffectAllowed("tbank_mutation"), /blocked/);
assert.equal(effects.externalSideEffectAllowed("yclients_mutation"), false);
assert.equal(effects.externalSideEffectAllowed("moysklad_mutation"), false);
assert.equal(effects.externalSideEffectAllowed("rossko_order"), false);

if (previous.appEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = previous.appEnv;
if (previous.master === undefined) delete process.env.EXTERNAL_SIDE_EFFECTS_ENABLED; else process.env.EXTERNAL_SIDE_EFFECTS_ENABLED = previous.master;
if (previous.telegram === undefined) delete process.env.TELEGRAM_SEND_ENABLED; else process.env.TELEGRAM_SEND_ENABLED = previous.telegram;
if (previous.yclients === undefined) delete process.env.YCLIENTS_MUTATIONS_ENABLED; else process.env.YCLIENTS_MUTATIONS_ENABLED = previous.yclients;
if (previous.moysklad === undefined) delete process.env.MOYSKLAD_MUTATIONS_ENABLED; else process.env.MOYSKLAD_MUTATIONS_ENABLED = previous.moysklad;
if (previous.rossko === undefined) delete process.env.ROSSKO_ORDER_ENABLED; else process.env.ROSSKO_ORDER_ENABLED = previous.rossko;
if (previous.tbank === undefined) delete process.env.TBANK_MUTATIONS_ENABLED; else process.env.TBANK_MUTATIONS_ENABLED = previous.tbank;

console.log("Branch production guard tests passed.");
