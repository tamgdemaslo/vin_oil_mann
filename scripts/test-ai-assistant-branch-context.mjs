#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const [access, threadRoutes, threadRoute, messageRoute, runner, tools, rossko, migration] = await Promise.all([
  read("src/lib/ai-assistant/access.ts"),
  read("src/app/api/ai-assistant/threads/route.ts"),
  read("src/app/api/ai-assistant/threads/[id]/route.ts"),
  read("src/app/api/ai-assistant/threads/[id]/messages/route.ts"),
  read("src/lib/ai-assistant/runner.ts"),
  read("src/lib/ai-assistant/tools.ts"),
  read("src/lib/rossko.ts"),
  read("scripts/migrate-branch-integrations-from-env.mjs"),
]);

// A model cannot choose a tenant: the selected branch is server-verified and
// an existing thread resolves its own stored branch before any runner call.
assert.match(access, /ASSISTANT_BRANCH_SELECTION_REQUIRED = "BRANCH_SELECTION_REQUIRED"/);
assert.match(access, /resolveAIAssistantThreadAccess/);
assert.match(access, /branchId:\s*\{ in: access\.branches\.map/);
assert.match(access, /runWithRequestTenant\(access\.tenant/);
assert.match(threadRoutes, /branchId: z\.string\(\)/);
assert.match(threadRoutes, /runWithAIAssistantBranchContext/);
assert.match(threadRoute, /resolveAIAssistantThreadAccess/);
assert.match(messageRoute, /resolveAIAssistantThreadAccess/);
assert.match(messageRoute, /runWithAIAssistantBranchContext/);
assert.match(runner, /aIAssistantThread\.create/);
assert.match(runner, /aIAssistantToolCall\.create/);

// Tool schemas remain branch-id-free; ROSSKO receives context only from the
// runner's verified tenant and never from a model function argument.
const schemaPart = tools.slice(tools.indexOf("export const assistantFunctionTools"), tools.indexOf("] as const;"));
assert.doesNotMatch(schemaPart, /branchId/);
assert.match(tools, /getAgentSettings\(context\.organizationId\)/);
assert.match(tools, /ROSSKO_NOT_CONFIGURED/);
assert.match(tools, /ROSSKO_AUTH_FAILED/);
assert.match(tools, /ROSSKO_TEMPORARILY_UNAVAILABLE/);
assert.match(tools, /ROSSKO_NO_RESULTS/);
assert.match(tools, /DATABASE_TEMPORARILY_UNAVAILABLE/);
assert.match(tools, /ROSSKO_SEARCH_FAILED/);
assert.match(tools, /traceDiagnostics/);
assert.doesNotMatch(rossko, /process\.env\.ROSSKO_KEY[12]/);
assert.match(rossko, /credentialFingerprint/);
assert.match(rossko, /recoverableRosskoClient/);
assert.match(rossko, /checkoutDetailsCache = new Map/);

// Env credentials are allowed only in the one-time command and the command
// proves decryptability before its non-mutating ROSSKO authorization probe.
assert.match(migration, /source\("ROSSKO_KEY1"\)/);
assert.match(migration, /rosskoConfig\(\)/);
assert.match(migration, /rosskoCheckoutDetails/);
assert.match(migration, /recordRosskoCheck/);
assert.doesNotMatch(migration, /console\.(?:error|warn)/);

console.log("AI assistant branch context and ROSSKO credential guard tests — passed");
