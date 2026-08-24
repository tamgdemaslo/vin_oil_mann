#!/usr/bin/env node

import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { classifyRosskoRuntimeFailure, safeRosskoDiagnostic } = await jiti.import("../src/lib/rossko-error-classification.ts");

const database = classifyRosskoRuntimeFailure(Object.assign(new Error("Timed out fetching a new connection from the connection pool"), { code: "P2024" }));
assert.equal(database.code, "DATABASE_TEMPORARILY_UNAVAILABLE");
assert.match(database.publicMessage, /База данных временно перегружена/);

const transportCause = Object.assign(new Error("socket timed out"), { code: "ETIMEDOUT" });
const transport = classifyRosskoRuntimeFailure(new Error("SOAP client creation failed", { cause: transportCause }));
assert.equal(transport.code, "ROSSKO_TEMPORARILY_UNAVAILABLE");
assert.match(transport.diagnosticMessage, /ETIMEDOUT/);

const authentication = classifyRosskoRuntimeFailure(new Error("403 access denied"));
assert.equal(authentication.code, "ROSSKO_AUTH_FAILED");

const provider = classifyRosskoRuntimeFailure(new Error("Unknown article response"), { providerError: true });
assert.equal(provider.code, "ROSSKO_SEARCH_FAILED");
assert.match(provider.publicMessage, /Техническая причина сохранена в trace/);

const internal = classifyRosskoRuntimeFailure(new Error("unexpected mapper state"));
assert.equal(internal.code, "ROSSKO_SEARCH_FAILED");
assert.match(internal.publicMessage, /Внутренняя ошибка/);

const secretError = new Error("postgresql://admin:db-secret@database/app KEY1=rossko-secret TOKEN: bearer-secret");
const diagnostic = safeRosskoDiagnostic(secretError);
assert.doesNotMatch(diagnostic, /db-secret|rossko-secret|bearer-secret/);
assert.match(diagnostic, /\[redacted\]/);

console.log("ROSSKO runtime error classification and diagnostic redaction — passed");
