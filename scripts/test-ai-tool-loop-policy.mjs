#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const {
  isAssistantCalculationTool,
  shouldFinalizeAssistantToolTurn,
} = await jiti.import("../src/lib/ai-assistant/tool-loop-policy.ts");

assert.equal(isAssistantCalculationTool("calculate_service_quote_v2"), true);
assert.equal(isAssistantCalculationTool("calculate_quote_preview"), true);
assert.equal(isAssistantCalculationTool("build_quote_and_tech_card"), true);
assert.equal(isAssistantCalculationTool("build_quote_and_tech_card_bundle"), true);
assert.equal(isAssistantCalculationTool("search_rossko"), false);

assert.equal(shouldFinalizeAssistantToolTurn({ turn: 1, maxToolTurns: 6, calculationCompleted: true }), true);
assert.equal(shouldFinalizeAssistantToolTurn({ turn: 4, maxToolTurns: 6, calculationCompleted: false }), false);
assert.equal(shouldFinalizeAssistantToolTurn({ turn: 5, maxToolTurns: 6, calculationCompleted: false }), true);

const runner = await readFile("src/lib/ai-assistant/runner.ts", "utf8");
assert.match(runner, /const MAX_TOOL_CALLS = \d+;/);
assert.match(runner, /const MAX_AGENT_ITERATIONS = \d+;/);
assert.match(runner, /const MAX_RUN_DURATION_MS = /);
assert.match(runner, /tool_choice: "none"/);
assert.match(runner, /status: "failed_run_timeout"/);
assert.match(runner, /"failed_tool_limit"/);
assert.match(runner, /Остался один цикл инструментов/);
assert.match(runner, /build_quote_and_tech_card_bundle/);
assert.match(runner, /complex_request_requires_bundle/);
assert.match(runner, /vin: vinFromMessage\(scenarioRequest\)/);
assert.match(runner, /previousQuoteAndTechCard/);
assert.match(runner, /continuationTechnicalContext/);

console.log("AI tool loop policy tests — passed");
