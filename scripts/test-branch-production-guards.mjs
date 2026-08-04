import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
});
const tenant = await jiti.import("../src/lib/request-tenant-store.ts");
const branchApi = await jiti.import("../src/lib/branch-api.ts");
const effects = await jiti.import("../src/lib/external-side-effects.ts");
const { proxy } = await jiti.import("../src/proxy.ts");
const { createBranch } = await jiti.import("../src/lib/branches.ts");

const previousSessionSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "branch-group-route-regression-secret";
const branchCookiePayload = Buffer.from(JSON.stringify({
  branchId: "all",
  login: "owner",
  exp: Math.floor(Date.now() / 1000) + 300,
}), "utf8").toString("base64url");
const branchCookieSignature = crypto
  .createHmac("sha256", process.env.SESSION_SECRET)
  .update(branchCookiePayload, "utf8")
  .digest("base64url");
const allModeCookie = `eco_active_branch=${branchCookiePayload}.${branchCookieSignature}`;

async function proxyResult(path, method = "POST") {
  const response = proxy(new NextRequest(`http://localhost${path}`, {
    method,
    headers: { cookie: allModeCookie },
  }));
  return {
    status: response.status,
    next: response.headers.get("x-middleware-next") === "1",
    body: response.headers.get("content-type")?.includes("application/json") ? await response.json() : null,
  };
}

assert.deepEqual(await proxyResult("/api/branches"), { status: 200, next: true, body: null });
assert.deepEqual(await proxyResult("/api/branches", "PUT"), {
  status: 409,
  next: false,
  body: {
    error: "В режиме «Все филиалы» операции изменения запрещены. Выберите конкретный филиал.",
    code: "concrete_branch_required",
  },
});
for (const path of ["/api/clients", "/api/shipments"]) {
  const result = await proxyResult(path);
  assert.equal(result.status, 409);
  assert.equal(result.next, false);
  assert.equal(result.body?.code, "concrete_branch_required");
}

const deniedInput = {
  name: "Blocked branch",
  shortName: "Blocked",
  slug: "blocked-branch",
  businessGroupId: "attacker-controlled-group",
};
for (const context of [
  { canManageBranches: false, groupRole: null, branchRole: "branch_admin" },
  { canManageBranches: false, groupRole: null, branchRole: null },
]) {
  const result = await createBranch(context, deniedInput);
  assert.deepEqual(result, { ok: false, status: 403, error: "Недостаточно прав" });
}

const branchRouteSource = fs.readFileSync(new URL("../src/app/api/branches/route.ts", import.meta.url), "utf8");
const branchesSource = fs.readFileSync(new URL("../src/lib/branches.ts", import.meta.url), "utf8");
assert.match(branchRouteSource, /requireBranchContext\(\{ allowAll: true, requireActive: false \}\)/);
assert.match(branchRouteSource, /createBranch\(context, body\)/);
assert.match(branchesSource, /if \(!context\.canManageBranches\) return \{ ok: false as const, status: 403/);
assert.match(branchesSource, /businessGroupId: context\.businessGroupId/);
assert.match(branchesSource, /branchAuditLog\.create/);
assert.doesNotMatch(branchesSource.match(/export type BranchInput = \{[\s\S]*?\n\};/)?.[0] ?? "", /businessGroupId/);

for (const routePath of [
  "../src/app/api/catalog/search/route.ts",
  "../src/app/api/crm/deadline-notifications/route.ts",
  "../src/app/api/crm/deals/route.ts",
  "../src/app/api/dashboard/operations/route.ts",
  "../src/app/api/demands/route.ts",
  "../src/app/api/demands/[id]/route.ts",
  "../src/app/api/demands/[id]/copy/route.ts",
  "../src/app/api/demands/metadata/route.ts",
  "../src/app/api/messenger/conversations/route.ts",
  "../src/app/api/messenger/conversations/[id]/messages/route.ts",
  "../src/app/api/messenger/conversations/[id]/context/route.ts",
  "../src/app/api/messenger/telegram-user/sync/route.ts",
]) {
  const routeSource = fs.readFileSync(new URL(routePath, import.meta.url), "utf8");
  assert.match(routeSource, /requireBranchApi\(\{ allowAll: false, requireActive: true \}\)/);
  assert.match(routeSource, /runWithBranchApiContext\(/);
}

if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
else process.env.SESSION_SECRET = previousSessionSecret;

assert.throws(() => tenant.getScopedBranchId(), /Branch context is required/);
const scoped = tenant.runWithRequestTenant(
  { mode: "branch", branchId: "branch-test", organizationId: "org-test", allowedBranchIds: ["branch-test"] },
  () => tenant.getScopedBranchId()
);
assert.equal(scoped, "branch-test");
const branchApiScope = await branchApi.runWithBranchApiContext(
  {
    mode: "branch",
    branchId: "branch-api-test",
    organizationId: "org-api-test",
    businessGroupId: "group-api-test",
    userId: "user-api-test",
    groupRole: "group_admin",
    branchRole: "branch_admin",
    branches: [],
  },
  async () => {
    await Promise.resolve();
    return {
      branchId: tenant.getScopedBranchId(),
      requestTenant: tenant.getRequestTenant(),
    };
  }
);
assert.equal(branchApiScope.branchId, "branch-api-test");
assert.deepEqual(branchApiScope.requestTenant, {
  mode: "branch",
  branchId: "branch-api-test",
  organizationId: "org-api-test",
  allowedBranchIds: ["branch-api-test"],
  businessGroupId: "group-api-test",
  userId: "user-api-test",
  permissions: ["group_admin", "branch_admin"],
});
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

console.log("Branch production guard and exact group-route regression tests passed.");
