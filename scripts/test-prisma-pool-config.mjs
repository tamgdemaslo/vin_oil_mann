#!/usr/bin/env node

import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { configurePrismaPool } = await jiti.import("../src/lib/prisma-pool-config.ts");

const defaults = configurePrismaPool("postgresql://user:secret@db.example/app?schema=public", {});
assert.ok(defaults);
assert.equal(defaults.connectionLimit, 8);
assert.equal(defaults.poolTimeoutSeconds, 10);
assert.equal(new URL(defaults.url).searchParams.get("schema"), "public");
assert.equal(new URL(defaults.url).searchParams.get("connection_limit"), "8");
assert.equal(new URL(defaults.url).searchParams.get("pool_timeout"), "10");

const configured = configurePrismaPool(
  "postgresql://user:secret@db.example/app?connection_limit=3&pool_timeout=10",
  { PRISMA_CONNECTION_LIMIT: "6", PRISMA_POOL_TIMEOUT_SECONDS: "4" }
);
assert.ok(configured);
assert.equal(configured.connectionLimit, 6);
assert.equal(configured.poolTimeoutSeconds, 4);

const legacyUrlSettings = configurePrismaPool(
  "postgresql://user:secret@db.example/app?connection_limit=3&pool_timeout=10",
  {}
);
assert.ok(legacyUrlSettings);
assert.equal(legacyUrlSettings.connectionLimit, 8);
assert.equal(legacyUrlSettings.poolTimeoutSeconds, 10);

const bounded = configurePrismaPool("postgresql://user:secret@db.example/app", {
  PRISMA_CONNECTION_LIMIT: "1000",
  PRISMA_POOL_TIMEOUT_SECONDS: "1000",
});
assert.ok(bounded);
assert.equal(bounded.connectionLimit, 20);
assert.equal(bounded.poolTimeoutSeconds, 30);

assert.equal(configurePrismaPool(undefined, {}), null);
assert.equal(configurePrismaPool("not-a-url", {}), null);

console.log("Prisma pool configuration checks passed (bounded pool size and burst-tolerant timeout).");
