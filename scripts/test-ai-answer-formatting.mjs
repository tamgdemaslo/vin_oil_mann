#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const { parseAIAssistantStructuredResponse, structuredResponseToMarkdown } = await jiti.import("../src/lib/ai-assistant/structured-response.ts");
const { buildClientMessage } = await jiti.import("../src/lib/ai-assistant/client-message.ts");

const structured = parseAIAssistantStructuredResponse(JSON.stringify({
  summaryMarkdown: "Жидкость **подобрана** по допуску.",
  confirmed: ["Допуск Toyota CVTF FE"],
  assumptions: [],
  requiresVerification: ["Сверить код вариатора"],
  recommendations: [{ title: "Проверить уровень", detail: "Выставить по температуре.", priority: "important" }],
  clientMessage: "Добрый день! Расчёт готов.",
}));
assert.ok(structured);
assert.equal(structured.recommendations[0].priority, "important");
assert.match(structuredResponseToMarkdown(structured), /## Подтверждено/);
assert.equal(parseAIAssistantStructuredResponse("not json"), null);

const clientMessage = buildClientMessage({
  id: "quote-1",
  status: "draft",
  vehicleDisplayName: "Toyota C-HR",
  serviceName: "замена масла в вариаторе",
  selectedScenario: "аппаратная замена",
  includedItemsJson: [
    { name: "Деталь", article: "35330-28020", quantity: 1, totalCents: 300000 },
    { name: "Valvoline ATF/CVT", article: "30015049794", quantity: 8, totalCents: 1592000 },
  ],
  optionalItemsJson: [],
  baseTotalCents: 2180000,
  maximumTotalCents: null,
  priceRangeJson: {},
  assumptionsJson: [],
  internalWarningsJson: [],
  customerSafeWarningsJson: ["Перед работой сверим комплект."],
  validUntil: null,
}, "short_with_price");
assert.doesNotMatch(clientMessage.message, /\bДеталь\b/u);
assert.match(clientMessage.message, /запчасть 35330-28020/u);

console.log("AI answer formatting tests — passed");
