#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const {
  applyBillableQuantityToPrimaryFluid,
  buildQuoteAndTechCardCustomerMessage,
  createQuoteAndTechCardPlan,
  customerMoneyFromCents,
  normalizeQuoteAndTechCardInput,
  parseQuoteAndTechCardInput,
  parseQuoteAndTechCardResult,
  parseQuoteAndTechCardToolResult,
  QUOTE_AND_TECH_CARD_TOOL_PARAMETERS,
  quoteAndTechCardFilterPolicy,
  quoteAndTechCardMaterials,
  quoteAndTechCardSupplierRows,
  quoteStatus,
  scenarioStatus,
} = await jiti.import("../src/lib/ai-assistant/quote-and-tech-card.ts");
const {
  assertLocalFirstInvariant,
  assertQuoteAndTechCardOptionIntegrity,
  LocalFirstInvariantError,
  QuoteAndTechCardIntegrityError,
  requestedDateRangeFromText,
  selectQuoteAndTechCardFallbackServiceCard,
} = await jiti.import("../src/lib/ai-assistant/tools.ts");
const { buildClientMessage } = await jiti.import("../src/lib/ai-assistant/client-message.ts");
const { evaluatePreferredLocalFluid } = await jiti.import("../src/lib/ai-assistant/material-selection.ts");
const { jsonSafe } = await jiti.import("../src/lib/ai-assistant/json-safe.ts");
const { Prisma } = await import("@prisma/client");

const compact = (value) => value.replace(/[\s\u00a0]/gu, "");

// Regression context from the customer request: Tucson / SP-IV / an
// inaccessible internal filter.  The local candidate intentionally uses the
// Valvoline catalog name, while the OEM article is retained only as reference.
const runtimeInput = {
  branchId: "dachnaya",
  vehicleId: "vehicle-tucson",
  vehicleDisplayName: "Hyundai Tucson 2.0 AT · XWEJC81ADH0000196",
  requestedProcedures: ["machine_exchange", "partial_change"],
  requestedDates: "29–30 августа",
  service: {
    serviceType: "transmission_fluid",
    serviceName: "Замена жидкости АКПП",
    fluidSpec: "Hyundai/Kia ATF SP-IV",
    fluidOemArticle: "04500-00115",
    partialVolumeLiters: 4.3,
    totalCapacityLiters: 7.3,
    procedures: ["machine_exchange"],
    filterAccess: "internal_requires_disassembly",
    technicalWarnings: ["Пробег около 200 000 км; перед аппаратной заменой нужна диагностика."],
  },
  localCatalogChecked: true,
  selectedProducts: [],
  consumables: [{ productId: "internal-filter", quantity: 1, role: "internal_filter" }],
  rosskoItems: [
    { article: "04500-00115", brand: "Hyundai", quantity: 13, role: "fluid" },
    { article: "46321-3B000", brand: "Hyundai", quantity: 1, role: "internal_filter" },
    { article: "GASKET-ATF", brand: "Hyundai", quantity: 1, role: "consumable" },
  ],
  evidence: [{ source: "OEM", fact: "Общий объём АКПП 7,3 л; требуется Hyundai/Kia ATF SP-IV.", status: "confirmed" }],
};

const normalized = normalizeQuoteAndTechCardInput(runtimeInput);
const toolService = QUOTE_AND_TECH_CARD_TOOL_PARAMETERS.properties.input.properties.service;
const toolEvidence = QUOTE_AND_TECH_CARD_TOOL_PARAMETERS.properties.input.properties.evidence.items;
assert.equal(toolService.properties.type.type, "string", "tool intake accepts upstream service aliases before normalization");
assert.equal(toolService.properties.procedures.items.type, "string", "tool intake accepts upstream procedure aliases before normalization");
assert.equal(toolEvidence.properties.status.type, "string", "tool intake accepts observed evidence statuses before normalization");
assert.equal(normalized.service.type, "automatic_transmission", "transmission_fluid normalizes to automatic_transmission");
assert.deepEqual(normalized.requestedProcedures, ["machine", "partial"], "requested procedures survive separately from a single scenario procedure");
assert.equal(normalized.requestedDates, "29–30 августа", "requested dates stay in the normalized scenario input");
const parsedInput = parseQuoteAndTechCardInput(runtimeInput);
assert.equal(parsedInput.evidence[0].status, "confirmed", "runtime evidence status is canonical");
assert.equal(requestedDateRangeFromText("хочу приехать 29-30 августа"), "29–30 августа", "date range is retained when it comes from the employee request");

// C, D: same config must produce the same trace and the one quantity engine
// must turn 7.3 × 1.7 = 12.41 into 13 billable litres.
const rules = { transmissionMachineExchangeMultiplier: 1.7, literRoundingStep: 1, transmissionMinimumBillableLiters: 0 };
const plan = createQuoteAndTechCardPlan(runtimeInput, rules);
const repeatedPlan = createQuoteAndTechCardPlan(runtimeInput, rules);
assert.deepEqual(plan.options.map((option) => option.quantityTrace), repeatedPlan.options.map((option) => option.quantityTrace), "quantity trace is deterministic");
assert.equal(plan.options.length, 2, "both requested variants remain in the quote");
assert.deepEqual(plan.options.map((option) => option.code), ["partial", "machine"], "customer-facing quote options have stable partial → machine order");
assert.equal(plan.options[0].billableQuantityLiters, 5, "partial quantity is rounded by the common quantity engine");
assert.equal(plan.options[1].technicalQuantityLiters, 12.41, "machine quantity uses total capacity and configured multiplier");
assert.equal(plan.options[1].billableQuantityLiters, 13, "12.41 litres becomes exactly 13 billable litres");
assert.deepEqual(plan.options[1].quantityTrace, {
  sourceCapacity: 7.3,
  sourceCapacityEvidence: "OEM: Общий объём АКПП 7,3 л; требуется Hyundai/Kia ATF SP-IV.",
  configuredMultiplier: 1.7,
  configuredAdditionalVolume: 0,
  calculationMode: "total_capacity_x_machine_multiplier",
  rawCalculatedQuantity: 12.41,
  packageStep: 1,
  roundingRule: "Округление вверх до шага 1 л; минимум 0 л.",
  technicalQuantity: 12.41,
  billableQuantity: 13,
}, "quantity trace records capacity, settings and rounding rule");
assert.equal(plan.techCardWarnings.some((warning) => /фильтр|epc|заказ/iu.test(warning)), false, "internal-filter policy removes search instructions from tech-card warnings");
assert.deepEqual(plan.filterPolicy, {
  replaceFilter: false,
  requiredForQuote: false,
  searchPart: false,
  rosskoSearch: false,
  customerText: "Фильтр на этой АКПП находится внутри агрегата и для его замены требуется разборка коробки, поэтому при стандартной замене масла мы его не меняем.",
}, "internal filter policy is deterministic and customer-safe");

const localValvoline = {
  id: "valvoline-atf",
  name: "Масло трансмиссионное Valvoline Light & Heavy Duty ATF / CVT, 1 л",
  salePriceCents: 199000,
  uomName: "л",
  packageVolume: "1 л",
  markingMode: "BULK_OIL_FROM_MARKED_BARREL",
  atf: "Hyundai/Kia ATF SP-IV; Toyota ATF WS",
  oemAtf: null,
  searchText: "Valvoline ATF Hyundai Kia SP-IV",
  availableUnits: 59.96,
};
const evaluatedLocal = evaluatePreferredLocalFluid([localValvoline], "Hyundai/Kia ATF SP-IV", 13);
assert.equal(evaluatedLocal.selected?.source, "local_catalog", "A: local selection marks its source explicitly");
assert.equal(evaluatedLocal.selected?.productId, "valvoline-atf", "A: compatible Valvoline is selected from local catalog");
assert.equal(evaluatedLocal.candidates[0]?.eligible, true, "A: local candidate has enough stock and a price");
assert.equal(evaluatedLocal.candidates[0]?.requiredQuantity, 13, "A: candidate trace uses billable quantity");

const materials = quoteAndTechCardMaterials(parsedInput, true);
assert.equal(materials.rosskoItems.length, 0, "A: local fluid blocks supplier fallback ATF");
assert.equal(materials.consumables.length, 0, "J: inaccessible internal filter never enters quote materials");
assert.deepEqual(quoteAndTechCardMaterials(parsedInput, false).rosskoItems.map((item) => item.article), ["04500-00115"], "B: OEM article is used only as verified fallback if local fluid is absent");
assert.deepEqual(quoteAndTechCardSupplierRows({ ...parsedInput, rosskoItems: [] }, false, 5), [{ article: "04500-00115", brand: null, offerId: null, quantity: 5 }], "supplier fallback is explicit and controlled");
assert.deepEqual(quoteAndTechCardSupplierRows(parsedInput, true, 5), [], "A: no supplier ATF is added with a local compatible product");

const primaryFluid = applyBillableQuantityToPrimaryFluid([{ productId: "valvoline-atf", quantity: 12.41, role: "fluid" }], 13, true);
assert.equal(primaryFluid[0].quantity, 13, "one billable value is reused by product line and quote");
const materialTrace = {
  requiredSpecification: "Hyundai/Kia ATF SP-IV",
  oemReference: { brand: "Hyundai/Kia", article: "04500-00115" },
  localCandidates: evaluatedLocal.candidates,
  selectedLocalCandidate: evaluatedLocal.candidates[0],
  selectedProduct: { source: "local_catalog", productId: "valvoline-atf", catalogName: localValvoline.name, customerDisplayName: "Valvoline ATF" },
  localAvailableQuantity: 59.96,
  requiredQuantity: 13,
  fallbackSupplierUsed: false,
  fallbackReason: null,
};
assert.doesNotThrow(() => assertLocalFirstInvariant(materialTrace), "A: local-first invariant accepts the selected local product");
assert.throws(() => assertLocalFirstInvariant({ ...materialTrace, selectedProduct: { ...materialTrace.selectedProduct, source: "supplier" }, fallbackSupplierUsed: true }), LocalFirstInvariantError, "A: supplier primary fluid is rejected when a local compatible product exists");

const makeLine = ({ role, type, name, customerDisplayName, quantity, unitPriceCents, source = "local", productId = null, internalOnly = false }) => ({
  source,
  type,
  role,
  productId,
  name,
  catalogName: name,
  customerDisplayName,
  article: null,
  quantity,
  unitPriceCents,
  totalCents: quantity * unitPriceCents,
  internalOnly,
});
const partialFluidLine = makeLine({ role: "fluid", type: "product", productId: "valvoline-atf", name: localValvoline.name, customerDisplayName: "Valvoline ATF", quantity: 5, unitPriceCents: 199000 });
const machineFluidLine = makeLine({ role: "fluid", type: "product", productId: "valvoline-atf", name: localValvoline.name, customerDisplayName: "Valvoline ATF", quantity: 13, unitPriceCents: 199000 });
const partialLaborLine = makeLine({ role: "labor", type: "labor", source: "labor_rule", name: "Работа: частичная замена", customerDisplayName: "Работа", quantity: 1, unitPriceCents: 401000 });
const machineLaborLine = makeLine({ role: "labor", type: "labor", source: "labor_rule", name: "Работа: аппаратная замена", customerDisplayName: "Работа", quantity: 1, unitPriceCents: 499000 });
const roundingLine = makeLine({ role: "rounding", type: "rounding", source: "calculation_rule", name: "Округление итога", customerDisplayName: "Округление", quantity: 1, unitPriceCents: 200, internalOnly: true });

const partialTotal = partialFluidLine.totalCents + partialLaborLine.totalCents + roundingLine.totalCents;
const machineTotal = machineFluidLine.totalCents + machineLaborLine.totalCents + roundingLine.totalCents;
const options = [
  {
    code: "partial", label: "Частичная замена", customerDisplayName: "Частичная замена масла в АКПП", status: "ready",
    technicalQuantityLiters: 4.3, billableQuantityLiters: 5, quantityTrace: plan.options[0].quantityTrace, materialSelectionTrace: { ...materialTrace, requiredQuantity: 5, selectedLocalCandidate: { ...evaluatedLocal.candidates[0], requiredQuantity: 5 } },
    lines: [partialFluidLine, partialLaborLine, roundingLine], totalCents: partialTotal, maximumTotalCents: null, validUntil: "2026-08-30", blockers: [], warnings: [],
  },
  {
    code: "machine", label: "Аппаратная замена", customerDisplayName: "Аппаратная замена масла в АКПП", status: "ready",
    technicalQuantityLiters: 12.41, billableQuantityLiters: 13, quantityTrace: plan.options[1].quantityTrace, materialSelectionTrace: materialTrace,
    lines: [machineFluidLine, machineLaborLine, roundingLine], totalCents: machineTotal, maximumTotalCents: null, validUntil: "2026-08-30", blockers: [], warnings: [],
  },
];
assert.doesNotThrow(() => assertQuoteAndTechCardOptionIntegrity(options[1]), "quantity and total invariant accepts the confirmed machine option");
assert.throws(() => assertQuoteAndTechCardOptionIntegrity({ ...options[1], totalCents: machineTotal - 200 }), QuoteAndTechCardIntegrityError, "contradictory totals are rejected before persistence");
assert.equal(options[1].lines.filter((line) => line.role === "fluid").length, 1, "A: OEM fluid is not added as a second priced line");
assert.equal(options[1].materialSelectionTrace.oemReference.article, "04500-00115", "B: OEM article remains a compatibility reference");
assert.equal(options[1].lines[0].catalogName, localValvoline.name, "B: quote line remains the selected local Valvoline product");

const fallbackCards = [
  { id: "generic-atf", name: "Замена масла АКПП", code: null, searchText: null },
  { id: "partial-atf", name: "АКПП: частичная замена", code: null, searchText: "ATF" },
  { id: "machine-atf", name: "АКПП: аппаратная замена", code: null, searchText: "ATF" },
];
assert.equal(selectQuoteAndTechCardFallbackServiceCard(fallbackCards, "automatic_transmission", "partial")?.id, "partial-atf", "labour fallback remains procedure-specific");
assert.equal(selectQuoteAndTechCardFallbackServiceCard(fallbackCards, "automatic_transmission", "machine")?.id, "machine-atf", "machine service cannot borrow the partial tariff");

const qStatus = quoteStatus(options, []);
const quoteSet = {
  id: "quote-set:vehicle-tucson:partial+machine",
  vehicleId: "vehicle-tucson",
  serviceType: "automatic_transmission",
  requestedProcedures: ["partial", "machine"],
  requestedDates: "29–30 августа",
  status: qStatus,
  confidence: "confirmed",
  options,
  hardBlockers: [],
  warnings: [],
};
assert.equal(quoteSet.options.length, 2, "E: QuoteSet contains two immutable procedure options");
const techCard = {
  status: "partial",
  serviceName: "Диагностика и замена ATF в АКПП",
  serviceType: "automatic_transmission",
  requiredFluidSpec: "Hyundai/Kia ATF SP-IV",
  filterPolicy: quoteAndTechCardFilterPolicy("internal_requires_disassembly").customerText,
  filter: quoteAndTechCardFilterPolicy("internal_requires_disassembly"),
  procedureVolumes: options.map((option) => ({ code: option.code, customerDisplayName: option.customerDisplayName, technicalQuantityLiters: option.technicalQuantityLiters, billableQuantityLiters: option.billableQuantityLiters })),
  levelTemperature: null,
  levelProcedure: null,
  servicePoints: ["Слив / залив / контроль"],
  torqueNotes: [],
  criticalChecks: ["Диагностика перед аппаратной заменой"],
  selectedMaterial: { name: "Valvoline ATF", catalogName: localValvoline.name, customerDisplayName: "Valvoline ATF", specification: "Hyundai/Kia ATF SP-IV", quantity: 13, compatibilityEvidence: "Hyundai/Kia ATF SP-IV" },
  warnings: ["Моменты затяжки не найдены."],
};
const customerMessage = buildQuoteAndTechCardCustomerMessage({ vehicle: { displayName: "Hyundai Tucson 2.0 CRDi · XWEJC81ADH0000196", aggregate: "A6LF2" }, quoteSet, techCard });
assert.equal(customerMessage.status, "ready", "F: whole QuoteSet creates a single client message");
assert.equal(compact(customerMoneyFromCents(1_396_200)), "13962₽", "G: formatter keeps exact 13 962 ₽ amount");
assert.equal(compact(customerMessage.text).includes("13962₽"), true, "G: customer text does not re-round 13 962 ₽ to 14 000 ₽");
assert.equal(compact(customerMessage.text).includes("30862₽"), true, "G: customer text keeps exact 30 862 ₽ amount");
assert.match(customerMessage.text, /Valvoline/u, "H: customer text uses the cleaned product display name");
assert.doesNotMatch(customerMessage.text, /Масло трансмиссионное|Округление|XWEJC81ADH0000196/u, "H/I: raw ERP name, rounding line and VIN never leak into client text");
assert.match(customerMessage.text, /5 л/u, "F: partial option stays in one client message");
assert.match(customerMessage.text, /13 л/u, "F: machine option stays in the same client message");
assert.match(customerMessage.text, /Фильтр на этой АКПП находится внутри агрегата/u, "J: filter explanation is human-readable");
assert.match(customerMessage.text, /29–30 августа/u, "K: requested dates survive into client text");
assert.doesNotMatch(customerMessage.text, /заказ(?:ать|а)|EPC|артикул фильтра/iu, "J: no filter order/EPC instruction leaks to customer text");
const recommendationMessage = buildQuoteAndTechCardCustomerMessage({ vehicle: { displayName: "Hyundai Tucson", aggregate: "A6LF2" }, quoteSet, techCard }, "recommendation");
assert.match(recommendationMessage.text, /Рекомендуем начать с диагностики АКПП/u, "recommendation action stays grounded in the machine-service condition");
assert.doesNotMatch(recommendationMessage.text, /13[\s\u00a0]?962 ₽|30[\s\u00a0]?862 ₽/u, "recommendation action does not add a price or an invented paid service");
assert.equal(scenarioStatus(qStatus, techCard.status, customerMessage.status), "partial", "a partial tech card leaves a confirmed quote usable");

const legacyMessage = buildClientMessage({
  id: "legacy-quote",
  status: "draft",
  vehicleDisplayName: "Hyundai Tucson",
  serviceName: "Замена масла АКПП",
  selectedScenario: null,
  includedItemsJson: [], optionalItemsJson: [], baseTotalCents: 1_396_200, maximumTotalCents: null,
  priceRangeJson: null, assumptionsJson: [], internalWarningsJson: [], customerSafeWarningsJson: [], validUntil: null,
}, "short_with_price");
assert.equal(compact(legacyMessage.message).includes("13962₽"), true, "legacy client formatter also preserves the stored amount without re-rounding");

const result = parseQuoteAndTechCardResult({
  scenario: "quote_and_tech_card", status: "partial", vehicle: { displayName: "Hyundai Tucson 2.0 CRDi", aggregate: "A6LF2" }, quoteSet, techCard, customerMessage, evidence: parsedInput.evidence,
});
assert.ok(result, "shared public contract accepts QuoteSet result with material and quantity traces");
const legacyOptions = options.map(({ quantityTrace, materialSelectionTrace, ...option }) => option);
const { procedureVolumes, ...legacyTechCard } = techCard;
const migratedLegacyResult = parseQuoteAndTechCardResult({
  scenario: "quote_and_tech_card",
  status: "partial",
  vehicle: { displayName: "Hyundai Tucson 2.0 CRDi", aggregate: "A6LF2" },
  quote: { status: qStatus, confidence: "confirmed", options: legacyOptions, hardBlockers: [], warnings: [] },
  techCard: legacyTechCard,
  customerMessage,
  evidence: parsedInput.evidence,
});
assert.equal(migratedLegacyResult?.quoteSet.options.length, 2, "older tech-card attachments migrate to QuoteSet instead of disappearing");
const toolEnvelope = { ...result, quoteSnapshots: [{ argumentsValue: {}, preview: {} }], finalQuote: false };
assert.equal(parseQuoteAndTechCardResult(toolEnvelope), null, "public contract stays strict about tool-only metadata");
assert.ok(parseQuoteAndTechCardToolResult(toolEnvelope), "runner removes tool-only metadata before public validation");

const decimalPayload = jsonSafe({ available: new Prisma.Decimal("59.96"), nested: [123n, new Date("2026-08-20T10:00:00.000Z"), { fn: () => "skip" }] });
assert.deepEqual(decimalPayload, { available: "59.96", nested: ["123", "2026-08-20T10:00:00.000Z", {}] }, "Decimal, BigInt, Date and nested values become plain JSON");

console.log("AI quote-and-tech-card regression tests — passed");
