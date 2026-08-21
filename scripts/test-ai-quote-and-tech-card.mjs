#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const {
  applyBillableQuantityToPrimaryFluid,
  buildQuoteAndTechCardCustomerMessage,
  createQuoteAndTechCardPlan,
  normalizeQuoteAndTechCardInput,
  parseQuoteAndTechCardInput,
  parseQuoteAndTechCardResult,
  parseQuoteAndTechCardToolResult,
  QUOTE_AND_TECH_CARD_TOOL_PARAMETERS,
  quoteAndTechCardMaterials,
  quoteAndTechCardFilterPolicy,
  quoteAndTechCardSupplierRows,
  quoteStatus,
  scenarioStatus,
} = await jiti.import("../src/lib/ai-assistant/quote-and-tech-card.ts");
const { assertQuoteAndTechCardOptionIntegrity, QuoteAndTechCardIntegrityError, selectQuoteAndTechCardFallbackServiceCard } = await jiti.import("../src/lib/ai-assistant/tools.ts");
const { jsonSafe } = await jiti.import("../src/lib/ai-assistant/json-safe.ts");
const { Prisma } = await import("@prisma/client");

// Exact regression context: VIN XWEJC81ADH0000196, 200k mileage, two prior
// partial services, standard TGM policy for inaccessible internal filters.
const runtimeInput = {
  branchId: "dachnaya",
  vehicleId: "vehicle-tucson",
  vehicleDisplayName: "Hyundai Tucson 2.0 AT · XWEJC81ADH0000196",
  requestedProcedures: ["machine_exchange", "partial_change"],
  service: {
    serviceType: "transmission_fluid",
    serviceName: "Замена жидкости АКПП",
    fluidSpec: "Hyundai SP-IV",
    fluidOemArticle: "ATF-SP4-OEM",
    partialVolumeLiters: 4.3,
    totalCapacityLiters: 7.1,
    procedures: ["machine_exchange"],
    filterAccess: "internal_requires_disassembly",
    technicalWarnings: ["Пробег около 200 000 км; перед аппаратной заменой нужна диагностика."],
  },
  localCatalogChecked: true,
  fluidMissingLocally: true,
  selectedProducts: [],
  consumables: [{ productId: "internal-filter", quantity: 1, role: "internal_filter" }],
  rosskoItems: [{ article: "ATF-SP4-OEM", brand: "Hyundai", quantity: 12, role: "fluid" }, { article: "46321-3B000", brand: "Hyundai", quantity: 1, role: "internal_filter" }, { article: "GASKET-ATF", brand: "Hyundai", quantity: 1, role: "consumable" }],
  evidence: [{ source: "OEM", fact: "SP-IV", status: "confirmed" }],
};

const normalized = normalizeQuoteAndTechCardInput(runtimeInput);
const toolService = QUOTE_AND_TECH_CARD_TOOL_PARAMETERS.properties.input.properties.service;
const toolEvidence = QUOTE_AND_TECH_CARD_TOOL_PARAMETERS.properties.input.properties.evidence.items;
assert.equal(toolService.properties.type.type, "string", "tool intake accepts upstream service aliases before normalization");
assert.equal(toolService.properties.procedures.items.type, "string", "tool intake accepts upstream procedure aliases before normalization");
assert.equal(toolEvidence.properties.status.type, "string", "tool intake accepts observed evidence statuses before normalization");
assert.equal(normalized.service.type, "automatic_transmission", "transmission_fluid normalizes to automatic_transmission");
assert.deepEqual(normalized.requestedProcedures, ["machine", "partial"], "requested procedures survive separately from a single scenario procedure");
const parsedInput = parseQuoteAndTechCardInput(runtimeInput);
assert.equal(parsedInput.evidence[0].source, "OEM", "runtime evidence source is accepted");
assert.equal(parsedInput.evidence[0].fact, "SP-IV", "runtime evidence fact is accepted");
assert.equal(parsedInput.evidence[0].status, "confirmed", "runtime evidence status is canonical");

const plan = createQuoteAndTechCardPlan(runtimeInput, { transmissionMachineExchangeMultiplier: 1.65, literRoundingStep: 1 });
assert.equal(plan.options.length, 2, "both requested variants remain in the quote");
assert.deepEqual(plan.requestedProcedures, ["machine", "partial"], "scenario context preserves the employee's requested procedures");
assert.deepEqual(plan.options.map((option) => option.code), ["partial", "machine"], "customer-facing quote options keep the stable partial → machine order");
assert.equal(plan.options[0].technicalQuantityLiters, 4.3, "partial technical quantity stays numeric");
assert.equal(plan.options[0].billableQuantityLiters, 5, "partial billable quantity uses the quantity engine");
assert.equal(plan.options[1].technicalQuantityLiters, 11.715, "machine technical quantity uses the configured multiplier");
assert.equal(plan.options[1].billableQuantityLiters, 12, "machine billable quantity rounds up deterministically");
assert.deepEqual(plan.filterPolicy, { replaceFilter: false, requiredForQuote: false, searchPart: false, rosskoSearch: false, customerText: "Внутренний, требует разборки АКПП. TGM при стандартной замене не меняет." }, "internal filter policy stops part and ROSSKO search before the quote");
assert.equal(plan.techCardWarnings.some((warning) => /фильтр|epc|заказ/i.test(warning)), false, "internal-filter policy removes order and EPC instructions from the compact tech card");
assert.equal(plan.quoteWarnings.length, 0, "missing torque does not downgrade a confirmed quote");
assert.equal(plan.hardBlockers.length, 0, "valid vehicle and specification are quote-ready");
const materials = quoteAndTechCardMaterials(parsedInput, true);
assert.equal(materials.rosskoItems.length, 0, "local Valvoline blocks ROSSKO fallback ATF");
assert.equal(materials.consumables.length, 0, "internal transmission filter never enters quote materials");
assert.deepEqual(quoteAndTechCardMaterials(parsedInput, false).rosskoItems.map((item) => item.article), ["ATF-SP4-OEM"], "internal-filter policy never sends filters or related parts to ROSSKO; only the verified ATF fallback remains");
const automaticSupplierRows = quoteAndTechCardSupplierRows({ ...parsedInput, rosskoItems: [] }, false, 5);
assert.deepEqual(automaticSupplierRows, [{ article: "ATF-SP4-OEM", brand: null, offerId: null, quantity: 5 }], "verified OEM ATF automatically becomes the supplier fallback only after local selection misses");
assert.deepEqual(quoteAndTechCardSupplierRows(parsedInput, true, 5), [], "a local compatible fluid keeps the supplier ATF out of the quote");

const fallbackCards = [
  { id: "generic-atf", name: "Замена масла АКПП", code: null, searchText: null },
  { id: "partial-atf", name: "АКПП: частичная замена", code: null, searchText: "ATF" },
  { id: "machine-atf", name: "АКПП: аппаратная замена", code: null, searchText: "ATF" },
];
assert.equal(selectQuoteAndTechCardFallbackServiceCard(fallbackCards, "automatic_transmission", "partial")?.id, "partial-atf", "a matching service card is used only as a deterministic labour fallback");
assert.equal(selectQuoteAndTechCardFallbackServiceCard(fallbackCards, "automatic_transmission", "machine")?.id, "machine-atf", "machine replacement cannot borrow the partial-replacement card");
assert.equal(selectQuoteAndTechCardFallbackServiceCard([...fallbackCards, { id: "duplicate", name: "АКПП: частичная замена", code: null, searchText: "ATF" }], "automatic_transmission", "partial"), null, "ambiguous service-card fallbacks remain blocked instead of choosing a random tariff");

const textQuantity = createQuoteAndTechCardPlan({ ...runtimeInput, service: { ...runtimeInput.service, partialVolumeLiters: "ориентир 4 л" } });
assert.equal(textQuantity.options[0].billableQuantityLiters, null, "textual reasoning cannot become a billable quantity");

// Quantity invariants: technical 12.41 l becomes 13 billable litres everywhere.
const primaryFluid = applyBillableQuantityToPrimaryFluid([{ productId: "valvoline-atf", quantity: 12, role: "fluid" }], 13, true);
assert.equal(primaryFluid[0].quantity, 13, "primary sellable fluid receives billable, not technical, quantity");
const machineFluidLine = { source: "local", type: "product", role: "fluid", productId: "valvoline-atf", name: "Масло трансмиссионное Valvoline Light & Heavy Duty ATF / CVT, 1 л", catalogName: "Масло трансмиссионное Valvoline Light & Heavy Duty ATF / CVT, 1 л", customerDisplayName: "Valvoline ATF", article: null, quantity: primaryFluid[0].quantity, unitPriceCents: 199000, totalCents: primaryFluid[0].quantity * 199000 };
assert.equal(machineFluidLine.totalCents, 13 * 199000, "13 × 1 990 ₽ is used for material total");
const integrityOption = { billableQuantityLiters: 13, lines: [machineFluidLine, { source: "labor_rule", type: "labor", role: "labor", productId: null, name: "Работа: аппаратная замена", catalogName: "Работа: аппаратная замена", customerDisplayName: "Работа", article: null, quantity: 1, unitPriceCents: 499000, totalCents: 499000 }], totalCents: machineFluidLine.totalCents + 499000 };
assert.doesNotThrow(() => assertQuoteAndTechCardOptionIntegrity(integrityOption), "confirmed quote has one billable quantity and total equal to lines");
assert.throws(() => assertQuoteAndTechCardOptionIntegrity({ ...integrityOption, totalCents: integrityOption.totalCents - 199000 }), QuoteAndTechCardIntegrityError, "inconsistent quote total is rejected before snapshot persistence");

const options = [
  { code: "partial", label: "Замена трансмиссионного масла, частичная", customerDisplayName: "Частичная замена масла в АКПП", status: "ready", technicalQuantityLiters: 4.3, billableQuantityLiters: 5, lines: [{ source: "local", type: "product", role: "fluid", productId: "valvoline-atf", name: "Масло трансмиссионное Valvoline Light & Heavy Duty ATF / CVT, 1 л", catalogName: "Масло трансмиссионное Valvoline Light & Heavy Duty ATF / CVT, 1 л", customerDisplayName: "Valvoline ATF", article: null, quantity: 5, unitPriceCents: 199000, totalCents: 995000 }, { source: "labor_rule", type: "labor", role: "labor", productId: null, name: "Работа: Замена трансмиссионного масла, частичная", catalogName: "Работа: Замена трансмиссионного масла, частичная", customerDisplayName: "Работа", article: null, quantity: 1, unitPriceCents: 400000, totalCents: 400000 }], totalCents: 1395000, maximumTotalCents: null, validUntil: null, blockers: [], warnings: [] },
  { code: "machine", label: "Замена трансмиссионного масла, полная/аппаратная", customerDisplayName: "Аппаратная замена масла в АКПП", status: "ready", technicalQuantityLiters: 12.41, billableQuantityLiters: 13, lines: [machineFluidLine, { source: "labor_rule", type: "labor", role: "labor", productId: null, name: "Работа: Замена трансмиссионного масла, полная/аппаратная", catalogName: "Работа: Замена трансмиссионного масла, полная/аппаратная", customerDisplayName: "Работа", article: null, quantity: 1, unitPriceCents: 499000, totalCents: 499000 }], totalCents: 3086000, maximumTotalCents: null, validUntil: null, blockers: [], warnings: [] },
];
const qStatus = quoteStatus(options, []);
assert.equal(qStatus, "ready", "optional tech-card gaps cannot block the quote");
const techCard = { status: "partial", serviceName: "Диагностика и замена ATF в АКПП", serviceType: "automatic_transmission", requiredFluidSpec: "Hyundai/Kia ATF SP-IV", filterPolicy: quoteAndTechCardFilterPolicy("internal_requires_disassembly").customerText, filter: quoteAndTechCardFilterPolicy("internal_requires_disassembly"), levelTemperature: null, levelProcedure: null, servicePoints: ["Слив / залив / контроль"], torqueNotes: [], criticalChecks: ["Диагностика перед аппаратной заменой"], selectedMaterial: { name: "Valvoline ATF", catalogName: "Масло трансмиссионное Valvoline Light & Heavy Duty ATF / CVT, 1 л", customerDisplayName: "Valvoline ATF", specification: "Hyundai/Kia ATF SP-IV", quantity: 13, compatibilityEvidence: "SP-IV" }, warnings: ["Моменты затяжки не найдены."], };
const customerMessage = buildQuoteAndTechCardCustomerMessage({ vehicle: { displayName: "Hyundai Tucson 2.0 CRDi", aggregate: "A6LF2" }, quote: { status: qStatus, confidence: "confirmed", options, hardBlockers: [], warnings: [] }, techCard });
assert.equal(customerMessage.status, "ready", "ready quote always creates client text");
assert.match(customerMessage.text, /13[\s ]?950 ₽/u, "partial total is in customer text");
assert.match(customerMessage.text, /30[\s ]?860 ₽/u, "machine total uses 13 billable litres in customer text");
assert.match(customerMessage.text, /Valvoline/u, "brand is in customer text");
assert.match(customerMessage.text, /5 л/u, "partial billable quantity is in customer text");
assert.match(customerMessage.text, /13 л/u, "machine billable quantity is in customer text");
assert.match(customerMessage.text, /Внутренний, требует разборки АКПП/u, "internal-filter policy is written for the client");
assert.doesNotMatch(customerMessage.text, /Масло трансмиссионное|полная\/аппаратная|предварительная стоимость|окончательно сверим/i, "customer formatter never leaks raw ERP names or contradicts confirmed quote confidence");
assert.equal(scenarioStatus(qStatus, techCard.status, customerMessage.status), "partial", "tech card partial leaves a ready quote usable");

const result = parseQuoteAndTechCardResult({ scenario: "quote_and_tech_card", status: "partial", vehicle: { displayName: "Hyundai Tucson 2.0 CRDi", aggregate: "A6LF2" }, quote: { status: qStatus, confidence: "confirmed", options, hardBlockers: [], warnings: [] }, techCard, customerMessage, evidence: parsedInput.evidence });
assert.ok(result, "final shared contract accepts the runtime-shaped regression result");
const toolEnvelope = { ...result, quoteSnapshots: [{ argumentsValue: {}, preview: {} }], finalQuote: false };
assert.equal(parseQuoteAndTechCardResult(toolEnvelope), null, "the public contract intentionally stays strict about tool metadata");
assert.ok(parseQuoteAndTechCardToolResult(toolEnvelope), "runner strips operational tool metadata before validating the public contract");

const decimalPayload = jsonSafe({ available: new Prisma.Decimal("59.96"), nested: [123n, new Date("2026-08-20T10:00:00.000Z"), { fn: () => "skip" }] });
assert.deepEqual(decimalPayload, { available: "59.96", nested: ["123", "2026-08-20T10:00:00.000Z", {}] }, "Decimal, BigInt, Date and nested values become plain JSON");

console.log("AI quote-and-tech-card regression tests — passed");
