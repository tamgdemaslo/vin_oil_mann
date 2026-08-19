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
const messengerStorage = await jiti.import("../src/lib/messenger/messenger-storage.ts");
const { config: proxyConfig, proxy } = await jiti.import("../src/proxy.ts");
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

async function proxyResult(path, method = "POST", headers = {}) {
  const response = proxy(new NextRequest(`http://localhost${path}`, {
    method,
    headers: { cookie: allModeCookie, ...headers },
  }));
  return {
    status: response.status,
    next: response.headers.get("x-middleware-next") === "1",
    body: response.headers.get("content-type")?.includes("application/json") ? await response.json() : null,
  };
}

assert.deepEqual(proxyConfig.matcher, [
  "/api/:path*",
  "/((?!api/|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
]);
assert.deepEqual(
  await proxyResult("/records?_rsc=prefetch", "GET", {
    rsc: "1",
    "next-router-prefetch": "1",
  }),
  { status: 204, next: false, body: null }
);
assert.deepEqual(
  await proxyResult("/records?_rsc=navigation", "GET", { rsc: "1" }),
  { status: 204, next: false, body: null }
);
assert.deepEqual(await proxyResult("/records?_rsc=query-only", "GET"), {
  status: 204,
  next: false,
  body: null,
});
assert.deepEqual(
  await proxyResult("/inventory/restock?_rsc=stale", "GET", {
    rsc: "1",
    "next-router-state-tree": "%7Btruncated",
  }),
  { status: 204, next: false, body: null }
);
assert.deepEqual(
  await proxyResult("/inventory/restock?_rsc=invalid-shape", "GET", {
    rsc: "1",
    "next-router-state-tree": encodeURIComponent(JSON.stringify(["", { children: {} }])),
  }),
  { status: 204, next: false, body: null }
);
assert.deepEqual(
  await proxyResult("/inventory/restock?_rsc=navigation", "GET", {
    rsc: "1",
    "next-router-state-tree": encodeURIComponent(JSON.stringify(["", {}])),
  }),
  { status: 204, next: false, body: null }
);
assert.deepEqual(await proxyResult("/records", "GET"), { status: 200, next: true, body: null });

const burstHeaders = {
  cookie: `${allModeCookie}; eco_session=test-browser-session`,
  "x-forwarded-for": "203.0.113.10",
  "user-agent": "request-burst-regression-test",
};
const originalDateNow = Date.now;
let burstNow = originalDateNow();
Date.now = () => burstNow;
for (let index = 0; index < 12; index += 1) {
  assert.deepEqual(await proxyResult(`/api/cash?request=${index}`, "GET", burstHeaders), {
    status: 200,
    next: true,
    body: null,
  });
}
const blockedApiBurst = await proxyResult("/api/cash?request=blocked", "GET", burstHeaders);
assert.equal(blockedApiBurst.status, 429);
assert.equal(blockedApiBurst.next, false);
assert.equal(blockedApiBurst.body?.code, "client_request_burst");

burstNow += 30_001;
for (let index = 0; index < 12; index += 1) {
  assert.deepEqual(await proxyResult(`/api/cash?second-wave=${index}`, "GET", burstHeaders), {
    status: 200,
    next: true,
    body: null,
  });
}
const secondBlockedApiBurst = await proxyResult("/api/cash?second-wave=blocked", "GET", burstHeaders);
assert.equal(secondBlockedApiBurst.status, 429);
assert.equal(secondBlockedApiBurst.body?.code, "client_request_burst");
burstNow += 30_001;
const stillBlockedApiBurst = await proxyResult("/api/cash?second-wave=still-blocked", "GET", burstHeaders);
assert.equal(stillBlockedApiBurst.status, 429);
assert.equal(stillBlockedApiBurst.body?.code, "client_request_burst");
Date.now = originalDateNow;

const documentBurstHeaders = {
  cookie: `${allModeCookie}; eco_session=test-restored-tabs-session`,
  "x-forwarded-for": "203.0.113.10",
  "user-agent": "restored-tabs-regression-test",
  accept: "text/html,application/xhtml+xml",
  "sec-fetch-dest": "document",
};
for (let index = 0; index < 4; index += 1) {
  assert.deepEqual(await proxyResult(`/shipment/restored-${index}`, "GET", documentBurstHeaders), {
    status: 200,
    next: true,
    body: null,
  });
}
const blockedDocumentBurst = await proxyResult("/inventory/restock", "GET", documentBurstHeaders);
assert.equal(blockedDocumentBurst.status, 429);
assert.equal(blockedDocumentBurst.next, false);
assert.equal(blockedDocumentBurst.body?.code, "client_request_burst");

for (const path of ["/api/health/live", "/api/health/ready", "/api/system/version", "/api/auth/users"]) {
  for (let index = 0; index < 30; index += 1) {
    assert.deepEqual(await proxyResult(path, "GET", burstHeaders), { status: 200, next: true, body: null });
  }
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
const yclientsRouteSource = fs.readFileSync(new URL("../src/app/api/yclients/route.ts", import.meta.url), "utf8");
assert.match(branchRouteSource, /requireBranchContext\(\{ allowAll: true, requireActive: false \}\)/);
assert.match(branchRouteSource, /createBranch\(context, body\)/);
assert.match(branchesSource, /if \(!context\.canManageBranches\) return \{ ok: false as const, status: 403/);
assert.match(branchesSource, /businessGroupId: context\.businessGroupId/);
assert.match(branchesSource, /branchAuditLog\.create/);
assert.doesNotMatch(branchesSource.match(/export type BranchInput = \{[\s\S]*?\n\};/)?.[0] ?? "", /businessGroupId/);
assert.match(
  yclientsRouteSource,
  /runWithBranchApiContext\(branchAccess\.context, async \(\) => \{\s*let config: YclientsBranchConfig;\s*try \{\s*config = await getYclientsBranchConfig\(\);[\s\S]*?return operation\(config\);/
);

for (const routePath of [
  "../src/app/api/analytics/customers/route.ts",
  "../src/app/api/catalog/search/route.ts",
  "../src/app/api/crm/deadline-notifications/route.ts",
  "../src/app/api/crm/deals/route.ts",
  "../src/app/api/dashboard/operations/route.ts",
  "../src/app/api/demands/route.ts",
  "../src/app/api/demands/[id]/route.ts",
  "../src/app/api/demands/[id]/copy/route.ts",
  "../src/app/api/demands/metadata/route.ts",
  "../src/app/api/messenger/conversations/route.ts",
  "../src/app/api/messenger/conversations/[id]/route.ts",
  "../src/app/api/messenger/conversations/[id]/archive/route.ts",
  "../src/app/api/messenger/conversations/[id]/important/route.ts",
  "../src/app/api/messenger/conversations/[id]/pin/route.ts",
  "../src/app/api/messenger/conversations/[id]/read/route.ts",
  "../src/app/api/messenger/conversations/[id]/messages/route.ts",
  "../src/app/api/messenger/conversations/[id]/messages/[messageId]/retry/route.ts",
  "../src/app/api/messenger/conversations/[id]/context/route.ts",
  "../src/app/api/messenger/conversations/[id]/avatar/route.ts",
  "../src/app/api/messenger/conversations/[id]/attachments/route.ts",
  "../src/app/api/messenger/attachments/[id]/route.ts",
  "../src/app/api/messenger/attachments/[id]/content/route.ts",
  "../src/app/api/messenger/attachments/[id]/thumbnail/route.ts",
  "../src/app/api/messenger/attachments/[id]/retry/route.ts",
  "../src/app/api/messenger/accounts/route.ts",
  "../src/app/api/messenger/channels/route.ts",
  "../src/app/api/messenger/events/route.ts",
  "../src/app/api/messenger/summary/route.ts",
  "../src/app/api/messenger/templates/route.ts",
  "../src/app/api/messenger/telegram-user/sync/route.ts",
]) {
  const routeSource = fs.readFileSync(new URL(routePath, import.meta.url), "utf8");
  assert.match(routeSource, /requireBranchApi\(\{ allowAll: false, requireActive: true \}\)/);
  assert.match(routeSource, /runWithBranchApiContext\(/);
}

const messengerProviderSource = fs.readFileSync(new URL("../src/components/messenger/MessengerProvider.tsx", import.meta.url), "utf8");
const authSource = fs.readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
const platformShellSource = fs.readFileSync(new URL("../src/components/platform/PlatformShell.tsx", import.meta.url), "utf8");
const shipmentDetailSource = fs.readFileSync(new URL("../src/app/shipment/[id]/page.tsx", import.meta.url), "utf8");
const telegramSyncWorkerSource = fs.readFileSync(new URL("../src/lib/messenger/telegram-sync-worker.ts", import.meta.url), "utf8");
const telegramUserSessionSource = fs.readFileSync(new URL("../src/lib/messenger/channels/telegram-user-session.ts", import.meta.url), "utf8");
const instrumentationSource = fs.readFileSync(new URL("../src/instrumentation.ts", import.meta.url), "utf8");
const attachmentRetrySource = fs.readFileSync(new URL("../src/app/api/messenger/attachments/[id]/retry/route.ts", import.meta.url), "utf8");
assert.match(messengerProviderSource, /const messengerActive = messengerEnabled && \(isMessagesPagePath\(pathname\) \|\| widgetView !== "collapsed"\)/);
assert.match(messengerProviderSource, /fetch\("\/api\/messenger\/summary"/);
assert.doesNotMatch(messengerProviderSource, /telegram-user\/sync/);
assert.match(authSource, /passwordOverridesInFlight/);
assert.match(authSource, /databaseUsersInFlight/);
assert.match(platformShellSource, /document\.visibilityState !== "visible"/);
assert.match(shipmentDetailSource, /document\.visibilityState !== "visible"/);
assert.match(shipmentDetailSource, /if \(!data\?\.header\?\.id\) return/);
assert.match(telegramSyncWorkerSource, /runForActiveBranches\(\(\) => syncTelegramUserAccount/);
assert.match(telegramSyncWorkerSource, /TELEGRAM_SYNC_WORKER_ENABLED === "1"/);
assert.doesNotMatch(telegramSyncWorkerSource, /process\.env\.NODE_ENV === "production"/);
assert.match(telegramSyncWorkerSource, /\{ worker: true \}/);
assert.match(telegramSyncWorkerSource, /TELEGRAM_SYNC_FAILURE_LOG_INTERVAL_MS/);
assert.match(telegramUserSessionSource, /autoReconnect: options\.autoReconnect \?\? false/);
assert.match(telegramUserSessionSource, /TELEGRAM_SYNC_MAX_BACKOFF_MS/);
assert.match(telegramUserSessionSource, /TELEGRAM_TRANSPORT/);
assert.match(telegramUserSessionSource, /TELEGRAM_TCP_DC_ADDRESSES/);
assert.match(telegramUserSessionSource, /telegramSyncWorkerLease/);
assert.match(telegramUserSessionSource, /client\.setLogLevel\?\.\(telegramGramJsLogLevel\(\)\)/);
assert.match(telegramUserSessionSource, /account\.status === "connected" \|\| account\.status === "degraded"/);
assert.match(instrumentationSource, /startTelegramSyncWorker/);
assert.match(attachmentRetrySource, /AND branch_id = \$\{branchAccess\.context\.branchId\}/);

assert.equal(messengerStorage.isMessengerStorageProxyUrl("/api/messenger/attachments/a/content"), true);
assert.equal(messengerStorage.isMessengerStorageProxyUrl("https://cdn.example.test/a.jpg"), false);
const storageEnvNames = [
  "MESSENGER_STORAGE_ENABLED",
  "MESSENGER_STORAGE_ENDPOINT",
  "MESSENGER_STORAGE_BUCKET",
  "MESSENGER_STORAGE_ACCESS_KEY_ID",
  "MESSENGER_STORAGE_SECRET_ACCESS_KEY",
];
const previousStorageEnv = Object.fromEntries(storageEnvNames.map((name) => [name, process.env[name]]));
process.env.MESSENGER_STORAGE_ENABLED = "false";
for (const name of storageEnvNames.slice(1)) delete process.env[name];
assert.deepEqual(messengerStorage.messengerStorageConfigurationError(), {
  error: "Хранилище файлов мессенджера отключено",
  code: "messenger_storage_unavailable",
});
Object.assign(process.env, {
  MESSENGER_STORAGE_ENABLED: "true",
  MESSENGER_STORAGE_ENDPOINT: "https://storage.example.test",
  MESSENGER_STORAGE_BUCKET: "messenger",
  MESSENGER_STORAGE_ACCESS_KEY_ID: "test-key",
  MESSENGER_STORAGE_SECRET_ACCESS_KEY: "test-secret",
});
assert.equal(messengerStorage.messengerStorageConfigurationError(), null);
for (const name of storageEnvNames) {
  const previousValue = previousStorageEnv[name];
  if (previousValue === undefined) delete process.env[name];
  else process.env[name] = previousValue;
}

for (const pagePath of [
  "../src/app/shipment/[id]/poster/page.tsx",
  "../src/app/shipment/[id]/tags/page.tsx",
]) {
  const pageSource = fs.readFileSync(new URL(pagePath, import.meta.url), "utf8");
  assert.match(pageSource, /requireBranchContext\(\{ allowAll: false, requireActive: true \}\)/);
  assert.match(pageSource, /runWithBranchApiContext\(/);
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
  rossko: process.env.ROSSKO_ORDER_ENABLED,
  tbank: process.env.TBANK_MUTATIONS_ENABLED,
};
process.env.APP_ENV = "branch-migration-rehearsal";
process.env.EXTERNAL_SIDE_EFFECTS_ENABLED = "false";
process.env.TELEGRAM_SEND_ENABLED = "false";
process.env.YCLIENTS_MUTATIONS_ENABLED = "false";
process.env.ROSSKO_ORDER_ENABLED = "false";
process.env.TBANK_MUTATIONS_ENABLED = "false";
assert.equal(effects.externalSideEffectAllowed("telegram_send"), false);
assert.throws(() => effects.assertExternalSideEffectAllowed("telegram_send"), /blocked/);
assert.throws(() => effects.assertExternalSideEffectAllowed("tbank_mutation"), /blocked/);
assert.equal(effects.externalSideEffectAllowed("yclients_mutation"), false);
assert.equal(effects.externalSideEffectAllowed("rossko_order"), false);

if (previous.appEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = previous.appEnv;
if (previous.master === undefined) delete process.env.EXTERNAL_SIDE_EFFECTS_ENABLED; else process.env.EXTERNAL_SIDE_EFFECTS_ENABLED = previous.master;
if (previous.telegram === undefined) delete process.env.TELEGRAM_SEND_ENABLED; else process.env.TELEGRAM_SEND_ENABLED = previous.telegram;
if (previous.yclients === undefined) delete process.env.YCLIENTS_MUTATIONS_ENABLED; else process.env.YCLIENTS_MUTATIONS_ENABLED = previous.yclients;
if (previous.rossko === undefined) delete process.env.ROSSKO_ORDER_ENABLED; else process.env.ROSSKO_ORDER_ENABLED = previous.rossko;
if (previous.tbank === undefined) delete process.env.TBANK_MUTATIONS_ENABLED; else process.env.TBANK_MUTATIONS_ENABLED = previous.tbank;

console.log("Branch production guard and exact group-route regression tests passed.");
