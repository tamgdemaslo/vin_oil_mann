import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { ConnectionTCPObfuscated } from "telegram/network/connection/index.js";
import { PromisedWebSockets } from "telegram/extensions/index.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { canUseTelegramUserSession, connectTelegramWithFallback, TelegramConnectionError, isTelegramConnectionFailure } = await jiti.import("../src/lib/messenger/channels/telegram-connect.ts");

assert.equal(canUseTelegramUserSession({ isActive: true, status: "degraded" }), true, "A temporary sync failure must allow reconnection for first contact");
for (const status of ["needs_auth", "disconnected", "waiting_password", "error"]) {
  assert.equal(canUseTelegramUserSession({ isActive: true, status }), false);
}
assert.equal(canUseTelegramUserSession({ isActive: false, status: "connected" }), false);
assert.equal(canUseTelegramUserSession(null), false);

async function attempt({ preferredTransport = "tcp", proxyConfigured = false, failures = {} } = {}) {
  const events = [];
  const clients = [];
  try {
    const result = await connectTelegramWithFallback({
      preferredTransport,
      proxyConfigured,
      createClient(transport) {
        events.push(`create:${transport}`);
        const client = { transport, closed: false };
        clients.push(client);
        return client;
      },
      async connectClient(client) {
        events.push(`connect:${client.transport}`);
        if (failures[client.transport]) throw failures[client.transport];
      },
      async closeClient(client) {
        events.push(`close:${client.transport}`);
        client.closed = true;
      },
    });
    return { result, events, clients };
  } catch (error) {
    return { error, events, clients };
  }
}

const timeout = new Error("Telegram connect timeout after 10000ms");
const success = await attempt();
assert.equal(success.result.transport, "tcp");
assert.deepEqual(success.events, ["create:tcp", "connect:tcp"]);
assert.equal(success.result.client.closed, false);

const fallback = await attempt({ failures: { tcp: timeout } });
assert.equal(fallback.result.transport, "websocket");
assert.deepEqual(fallback.events, ["create:tcp", "connect:tcp", "close:tcp", "create:websocket", "connect:websocket"]);
assert.equal(fallback.clients[0].closed, true);
assert.equal(fallback.result.client.closed, false);

const reverse = await attempt({ preferredTransport: "websocket", failures: { websocket: { type: "error" } } });
assert.equal(reverse.result.transport, "tcp");
assert.equal(reverse.clients[0].closed, true);

const proxy = await attempt({ proxyConfigured: true, preferredTransport: "websocket", failures: { tcp: timeout } });
assert.ok(proxy.error instanceof TelegramConnectionError);
assert.deepEqual(proxy.events, ["create:tcp", "connect:tcp", "close:tcp"]);

const revoked = new Error("AUTH_KEY_UNREGISTERED");
const authFailure = await attempt({ failures: { tcp: revoked } });
assert.equal(authFailure.error, revoked);
assert.deepEqual(authFailure.events, ["create:tcp", "connect:tcp", "close:tcp"]);

const allFailed = await attempt({ failures: { tcp: timeout, websocket: timeout } });
assert.ok(allFailed.error instanceof TelegramConnectionError);
assert.equal(allFailed.error.cause, timeout);
assert.ok(allFailed.clients.every(client => client.closed));
assert.equal(isTelegramConnectionFailure(allFailed.error), true);
assert.equal(isTelegramConnectionFailure(new Error("fetch failed", { cause: Object.assign(new Error("socket"), { code: "ECONNRESET" }) })), true);
assert.equal(isTelegramConnectionFailure(revoked), false);
assert.equal(isTelegramConnectionFailure(new Error("database unavailable")), false);

// Exercise the production factory without database access or Telegram traffic.
// The real GramJS constructor verifies the WebSocket framing configuration.
const source = readFileSync(new URL("../src/lib/messenger/channels/telegram-user-session.ts", import.meta.url), "utf8");
const factorySource = source.slice(source.indexOf("let lastWorkingDirectTransport:"), source.indexOf("async function withTelegramConnectTimeout"));
const factoryJs = ts.transpileModule(factorySource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const configuredClients = [];
class FakeSession {
  constructor(value) { this.value = value; this.dcId = 2; }
  setDC(id, address, port) { this.dcId = id; this.address = address; this.port = port; }
}
class FakeClient {
  constructor(session, apiId, apiHash, options) {
    Object.assign(this, { session, apiId, apiHash, options });
    configuredClients.push(this);
  }
  async connect() { if (!this.options.useWSS) throw timeout; }
  async destroy() { this.closed = true; }
}
const getClient = new Function("loadGramJs", "resolveTelegramUserCredentials", "telegramSocksProxy", "telegramTransport", "telegramWebDcAddress", "telegramTcpDcAddress", "telegramConnectionRetries", "telegramGramJsLogLevel", "connectTelegramWithFallback", "withTelegramConnectTimeout", "telegramConnectTimeoutMs", "disconnectTelegramClient", `${factoryJs}; return getClient;`)(
  async () => ({ TelegramClient: FakeClient, StringSession: FakeSession, PromisedWebSockets, ConnectionTCPObfuscated }),
  async () => { throw new Error("Credentials should be supplied by the test"); },
  () => undefined, () => "tcp",
  (id) => ({ id, ipAddress: "venus.web.telegram.org", port: 443 }),
  (id) => ({ id, ipAddress: "149.154.167.40", port: 443 }),
  () => 1, () => "none", connectTelegramWithFallback,
  async (promise) => promise, () => 10000, async (client) => client.destroy(),
);
const credentials = { apiId: 12345, apiHash: "0".repeat(32) };
const connected = await getClient("same-authorized-session", credentials);
assert.equal(configuredClients.length, 2);
assert.equal(configuredClients[0].closed, true);
assert.ok(configuredClients.every(client => client.session.value === "same-authorized-session" && client.session.dcId === 2));
assert.notEqual(configuredClients[0].session, connected.session);
assert.equal(connected.options.networkSocket, PromisedWebSockets);
assert.equal(connected.options.connection, ConnectionTCPObfuscated);
assert.equal((await connected.getDC(2)).ipAddress, "venus.web.telegram.org");
await getClient("same-authorized-session", credentials);
assert.equal(configuredClients.length, 3, "Successful fallback should be reused without another TCP timeout");
const realClient = new TelegramClient(new StringSession(""), credentials.apiId, credentials.apiHash, connected.options);
assert.equal(realClient._connection, ConnectionTCPObfuscated);
await realClient.destroy();

console.log("Telegram connection fallback, socket cleanup, proxy isolation and retry classification: PASS");
