#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const {
  applyBillableQuantityToPrimaryFluid,
  buildQuoteAndTechCardArtifactCustomerMessage,
  buildQuoteAndTechCardBundleCustomerMessage,
  buildQuoteAndTechCardCustomerMessage,
  createQuoteAndTechCardPlan,
  customerMoneyFromCents,
  normalizeQuoteAndTechCardInput,
  parseQuoteAndTechCardInput,
  parseQuoteAndTechCardArtifact,
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
  assertServicePackageIntegrity,
  classifyQuoteAndTechCardFailure,
  LocalFirstInvariantError,
  QuoteAndTechCardIntegrityError,
  requestedDateRangeFromText,
  restoreQuoteAndTechCardContinuationInput,
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
  presence: "present",
  access: "internal_requires_disassembly",
  tgmAction: "do_not_replace",
  filterPartRequiredForQuote: false,
  panServiceRequired: false,
  reason: "Фильтр находится внутри агрегата; его замена требует разборки коробки и не входит в стандартную замену жидкости.",
  evidence: null,
  replaceFilter: false,
  requiredForQuote: false,
  searchPart: false,
  rosskoSearch: false,
  customerText: "Фильтр на этой АКПП находится внутри агрегата и для его замены требуется разборка коробки, поэтому при стандартной замене масла мы его не меняем.",
}, "internal filter policy is deterministic and customer-safe");
assert.deepEqual(plan.options[1].servicePackage, {
  procedure: "machine",
  diagnosticsRequired: true,
  machineExchange: true,
  chemicalFlush: false,
  panRemoval: false,
  filterReplacement: false,
  levelAdjustment: true,
  requiredParts: [],
  requiredHardware: [],
  includedOperations: ["Диагностика АКПП до аппаратной замены", "Аппаратная замена жидкости", "Контроль и корректировка уровня жидкости"],
}, "service package is deterministic and does not promise an internal-filter replacement");

const panServicePlan = createQuoteAndTechCardPlan({
  ...runtimeInput,
  service: {
    ...runtimeInput.service,
    filterAccess: "pan_service",
    filterEvidence: "OEM: фильтр меняется после снятия сервисного поддона.",
  },
});
assert.deepEqual(panServicePlan.filterPolicy, {
  presence: "present",
  access: "pan_service",
  tgmAction: "replace_with_pan",
  filterPartRequiredForQuote: true,
  panServiceRequired: true,
  reason: "Фильтр доступен при снятии сервисного поддона и должен входить в сервис с поддоном.",
  evidence: "OEM: фильтр меняется после снятия сервисного поддона.",
  replaceFilter: true,
  requiredForQuote: true,
  searchPart: true,
  rosskoSearch: true,
  customerText: "Фильтр доступен при снятии сервисного поддона: в сервис с поддоном его включаем только вместе с подтверждёнными прокладкой и крепежом.",
}, "a pan-service filter has a distinct structured policy even when the customer did not mention a filter");
assert.equal(panServicePlan.options[0].servicePackage.panRemoval, true, "pan service package requires pan removal");
assert.equal(panServicePlan.options[0].servicePackage.filterReplacement, true, "pan service package requires the accessible filter");
assert.equal(panServicePlan.options[0].servicePackage.requiredParts[0]?.type, "external_filter", "the required filter is machine-readable");

const integratedPanPlan = createQuoteAndTechCardPlan({
  ...runtimeInput,
  service: { ...runtimeInput.service, filterAccess: "integrated_with_pan" },
});
assert.equal(integratedPanPlan.filterPolicy.access, "integrated_with_pan", "integrated pan is not conflated with a removable filter");
assert.equal(integratedPanPlan.options[0].servicePackage.requiredParts[0]?.type, "integrated_pan", "integrated pan becomes a distinct required part");

const ab60fPlan = createQuoteAndTechCardPlan({
  ...runtimeInput,
  vehicle: { displayName: "Toyota Land Cruiser 200", aggregateCode: "AB60F", snapshot: {} },
  service: { ...runtimeInput.service, aggregate: "AB60F", filterAccess: "unknown", transmissionConfiguration: null },
});
assert.equal(ab60fPlan.filterPolicy.access, "pan_service", "AB60F cannot be downgraded to an unknown filter construction");
assert.equal(ab60fPlan.input.service.transmissionConfiguration, "pan_and_filter", "AB60F receives the pan-and-filter labour configuration");
assert.equal(ab60fPlan.options[0].servicePackage.filterReplacement, true, "AB60F service package includes the accessible filter");

const manualMismatchPlan = createQuoteAndTechCardPlan({
  ...runtimeInput,
  vehicleDisplayName: "Volkswagen Golf · WVWZZZ1KZBW588069",
  vehicle: { displayName: "Volkswagen Golf", snapshot: { transmissionType: "MECHANICAL" } },
});
assert.equal(manualMismatchPlan.hardBlockers[0]?.code, "TRANSMISSION_SERVICE_MISMATCH", "a VIN-resolved manual transmission cannot enter an ATF quote path");

const unverifiedHybridPlan = createQuoteAndTechCardPlan({
  ...runtimeInput,
  vehicle: { displayName: "Audi Q5 Hybrid", snapshot: { fuelType: "Hybrid", transmissionType: "Automatic" } },
  service: { ...runtimeInput.service, aggregate: "0BK" },
  evidence: [{ source: "Catalog", fact: "Audi Q5 Hybrid; ATF needs verification.", status: "needs_verification" }],
});
assert.equal(unverifiedHybridPlan.hardBlockers.some((blocker) => blocker.code === "HYBRID_TRANSMISSION_NOT_VERIFIED"), true, "hybrid transmissions require a sourced aggregate/specification branch before a quote");
assert.equal(unverifiedHybridPlan.hardBlockers.some((blocker) => blocker.code === "SAFETY_CRITICAL_POWERTRAIN_PROFILE_MISMATCH"), true, "the Audi Q5 Hybrid family cannot fall back to a conventional 0BK/ZF branch");

const verifiedQ5HybridPlan = createQuoteAndTechCardPlan({
  ...runtimeInput,
  vehicle: { displayName: "Audi Q5 Hybrid", aggregateCode: "0BW", snapshot: { fuelType: "Hybrid", transmissionType: "Automatic" } },
  service: { ...runtimeInput.service, aggregate: "0BW", fluidSpec: undefined, requiredFluidSpec: "VW G 060 162 A2" },
  evidence: [{ source: "Audi OEM", fact: "Audi Q5 Hybrid 0BW requires VW G 060 162 A2.", status: "confirmed", url: "https://static.nhtsa.gov/odi/tsbs/2015/MC-10120918-9999.pdf" }],
});
assert.equal(verifiedQ5HybridPlan.hardBlockers.some((blocker) => /HYBRID|SAFETY_CRITICAL/u.test(blocker.code)), false, "the correct hybrid family profile is allowed without a VIN-specific exception");

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
assert.deepEqual(quoteAndTechCardSupplierRows({ ...parsedInput, rosskoItems: [] }, false, 5), [{ article: "04500-00115", brand: null, offerId: null, quantity: 5, role: "fluid" }], "supplier fallback is explicit and controlled");
assert.deepEqual(quoteAndTechCardSupplierRows(parsedInput, true, 5), [], "A: no supplier ATF is added with a local compatible product");

const primaryFluid = applyBillableQuantityToPrimaryFluid([{ productId: "valvoline-atf", quantity: 12.41, role: "fluid" }], 13, true);
assert.equal(primaryFluid[0].quantity, 13, "one billable value is reused by product line and quote");
const materialTrace = {
  requiredSpecification: "Hyundai/Kia ATF SP-IV",
  oemRequirement: { specification: "Hyundai/Kia ATF SP-IV", evidence: "Hyundai/Kia ATF SP-IV" },
  oemReference: { brand: "Hyundai/Kia", article: "04500-00115" },
  localCandidates: evaluatedLocal.candidates,
  selectedLocalCandidate: evaluatedLocal.candidates[0],
  compatibleProduct: { productId: "valvoline-atf", catalogName: localValvoline.name, compatibilityEvidence: "Hyundai/Kia ATF SP-IV" },
  selectedProduct: { source: "local_catalog", productId: "valvoline-atf", catalogName: localValvoline.name, customerDisplayName: "Valvoline ATF" },
  selectedSellableProduct: { source: "local_catalog", productId: "valvoline-atf", catalogName: localValvoline.name, customerDisplayName: "Valvoline ATF" },
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
    technicalQuantityLiters: 4.3, billableQuantityLiters: 5, quantityTrace: plan.options[0].quantityTrace, servicePackage: plan.options[0].servicePackage, materialSelectionTrace: { ...materialTrace, requiredQuantity: 5, selectedLocalCandidate: { ...evaluatedLocal.candidates[0], requiredQuantity: 5 } },
    lines: [partialFluidLine, partialLaborLine, roundingLine], totalCents: partialTotal, maximumTotalCents: null, validUntil: "2026-08-30", blockers: [], warnings: [],
  },
  {
    code: "machine", label: "Аппаратная замена", customerDisplayName: "Аппаратная замена масла в АКПП", status: "ready",
    technicalQuantityLiters: 12.41, billableQuantityLiters: 13, quantityTrace: plan.options[1].quantityTrace, servicePackage: plan.options[1].servicePackage, materialSelectionTrace: materialTrace,
    lines: [machineFluidLine, machineLaborLine, roundingLine], totalCents: machineTotal, maximumTotalCents: null, validUntil: "2026-08-30", blockers: [], warnings: [],
  },
];
assert.doesNotThrow(() => assertQuoteAndTechCardOptionIntegrity(options[1]), "quantity and total invariant accepts the confirmed machine option");
assert.throws(() => assertQuoteAndTechCardOptionIntegrity({ ...options[1], totalCents: machineTotal - 200 }), QuoteAndTechCardIntegrityError, "contradictory totals are rejected before persistence");
assert.throws(() => assertServicePackageIntegrity({ servicePackage: panServicePlan.options[0].servicePackage, lines: [partialFluidLine, partialLaborLine] }), QuoteAndTechCardIntegrityError, "a filter/pan service cannot be quoted without its mandatory package part");
assert.equal(classifyQuoteAndTechCardFailure(new Error("Unexpected JSON payload")).code, "QUOTE_CALCULATION_ERROR", "an unexpected calculator failure is not misreported as a missing labor rule");
assert.equal(classifyQuoteAndTechCardFailure(new Error("Для услуги нет правила стоимости работ")).code, "MISSING_LABOR_RULE", "a true labor-rule gap has a distinct machine-readable blocker");
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
  filterPolicy: quoteAndTechCardFilterPolicy("internal_requires_disassembly"),
  filterSummary: quoteAndTechCardFilterPolicy("internal_requires_disassembly").customerText,
  filter: quoteAndTechCardFilterPolicy("internal_requires_disassembly"),
  procedureVolumes: options.map((option) => ({ code: option.code, customerDisplayName: option.customerDisplayName, technicalQuantityLiters: option.technicalQuantityLiters, billableQuantityLiters: option.billableQuantityLiters })),
  servicePackages: options.map((option) => option.servicePackage),
  serviceHardware: [],
  levelTemperature: null,
  levelProcedure: null,
  servicePoints: ["Слив / залив / контроль"],
  torqueNotes: [],
  criticalChecks: ["Диагностика перед аппаратной заменой"],
  selectedMaterial: { name: "Valvoline ATF", catalogName: localValvoline.name, customerDisplayName: "Valvoline ATF", specification: "Hyundai/Kia ATF SP-IV", quantity: 13, compatibilityEvidence: "Hyundai/Kia ATF SP-IV" },
  warnings: ["Моменты затяжки не найдены."],
};
const customerMessage = buildQuoteAndTechCardCustomerMessage({ vehicle: { displayName: "Hyundai Tucson 2.0 CRDi, VIN XWEJC81ADH0000196", aggregate: "A6LF2" }, quoteSet, techCard });
assert.equal(customerMessage.status, "ready", "F: whole QuoteSet creates a single client message");
assert.equal(compact(customerMoneyFromCents(1_396_200)), "13962₽", "G: formatter keeps exact 13 962 ₽ amount");
assert.equal(compact(customerMessage.text).includes("13962₽"), true, "G: customer text does not re-round 13 962 ₽ to 14 000 ₽");
assert.equal(compact(customerMessage.text).includes("30862₽"), true, "G: customer text keeps exact 30 862 ₽ amount");
assert.match(customerMessage.text, /Valvoline/u, "H: customer text uses the cleaned product display name");
assert.doesNotMatch(customerMessage.text, /Масло трансмиссионное|Округление|XWEJC81ADH0000196/u, "H/I: raw ERP name, rounding line and VIN never leak into client text");
assert.doesNotMatch(customerMessage.text, /VIN\s*(?:,|\.|!|$)/iu, "H/I: removing a VIN also removes its label");
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

const panServiceResult = parseQuoteAndTechCardResult({
  ...result,
  quoteSet: { ...result.quoteSet, requestedProcedures: ["partial", "machine"] },
  techCard: {
    ...result.techCard,
    filterPolicy: panServicePlan.filterPolicy,
    filter: panServicePlan.filterPolicy,
    filterSummary: panServicePlan.filterPolicy.customerText,
    servicePackages: panServicePlan.options.map((option) => option.servicePackage),
  },
});
const downgradedContinuationInput = parseQuoteAndTechCardInput({
  ...runtimeInput,
  requestedProcedures: ["partial"],
  service: { ...runtimeInput.service, filterAccess: "unknown", transmissionConfiguration: null },
});
const restoredContinuationInput = restoreQuoteAndTechCardContinuationInput(downgradedContinuationInput, panServiceResult);
assert.equal(restoredContinuationInput.service.filterAccess, "pan_service", "a generic recalculation cannot downgrade a confirmed pan-service filter to unknown");
assert.equal(restoredContinuationInput.service.transmissionConfiguration, "pan_and_filter", "the restored filter package keeps the pan-and-filter labour branch");
assert.deepEqual(restoredContinuationInput.requestedProcedures, ["partial", "machine"], "a generic recalculation keeps every previously requested procedure");
assert.equal(classifyQuoteAndTechCardFailure(new QuoteAndTechCardIntegrityError("Для сервиса со снятием поддона не подтверждена обязательная позиция «external_filter»")).code, "FILTER_SERVICE_PACKAGE_NOT_CONFIRMED", "an incomplete pan/filter package has an explicit actionable blocker");

const enginePlan = createQuoteAndTechCardPlan({
  vehicle: { id: "vehicle-tucson", displayName: "Hyundai Tucson 2.0 CRDi", aggregateCode: null, snapshot: {} },
  service: { type: "engine_oil", name: "Замена масла в двигателе", requiredFluidSpec: "PSA B71 2312", standardTechnicalQuantityLiters: 4, filterAccess: "none", serviceHardware: [], materialsOwner: "service" },
  requestedProcedures: ["standard"], selectedProducts: [], consumables: [], rosskoItems: [], localCatalogChecked: true, fluidMissingLocally: false, softWarnings: [], evidence: [{ source: "OEM", fact: "Двигатель требует PSA B71 2312, объём 4 л.", status: "confirmed", url: null }],
});
const engineFluidLine = makeLine({ role: "fluid", type: "product", productId: "engine-oil", name: "Моторное масло PSA B71 2312", customerDisplayName: "Моторное масло 0W-30", quantity: 4, unitPriceCents: 150000 });
const engineLaborLine = makeLine({ role: "labor", type: "labor", source: "labor_rule", name: "Работа: замена моторного масла", customerDisplayName: "Работа", quantity: 1, unitPriceCents: 0 });
const engineOption = {
  code: "standard", label: "Замена масла в двигателе", customerDisplayName: "Замена масла в двигателе", status: "ready",
  technicalQuantityLiters: 4, billableQuantityLiters: 4, quantityTrace: enginePlan.options[0].quantityTrace, servicePackage: enginePlan.options[0].servicePackage, materialSelectionTrace: { ...materialTrace, requiredSpecification: "PSA B71 2312", requiredQuantity: 4, selectedLocalCandidate: { ...evaluatedLocal.candidates[0], requiredQuantity: 4 } },
  lines: [engineFluidLine, engineLaborLine], totalCents: engineFluidLine.totalCents, maximumTotalCents: null, validUntil: "2026-08-30", blockers: [], warnings: [],
};
const engineQuoteSet = { id: "quote-set:vehicle-tucson:engine", vehicleId: "vehicle-tucson", serviceType: "engine_oil", requestedProcedures: ["standard"], requestedDates: "29–30 августа", status: "ready", confidence: "confirmed", options: [engineOption], hardBlockers: [], warnings: [] };
const engineTechCard = {
  ...techCard,
  status: "ready",
  serviceName: "Замена масла в двигателе",
  serviceType: "engine_oil",
  requiredFluidSpec: "PSA B71 2312",
  filterPolicy: quoteAndTechCardFilterPolicy("none"),
  filterSummary: quoteAndTechCardFilterPolicy("none").customerText,
  filter: quoteAndTechCardFilterPolicy("none"),
  procedureVolumes: [{ code: "standard", customerDisplayName: "Замена масла в двигателе", technicalQuantityLiters: 4, billableQuantityLiters: 4 }],
  servicePackages: [engineOption.servicePackage],
  selectedMaterial: { name: "Моторное масло 0W-30", catalogName: engineFluidLine.name, customerDisplayName: engineFluidLine.customerDisplayName, specification: "PSA B71 2312", quantity: 4, compatibilityEvidence: "PSA B71 2312" },
};
const engineCustomerMessage = buildQuoteAndTechCardCustomerMessage({ vehicle: result.vehicle, quoteSet: engineQuoteSet, techCard: engineTechCard });
const engineResult = parseQuoteAndTechCardResult({ scenario: "quote_and_tech_card", status: "ready", vehicle: result.vehicle, quoteSet: engineQuoteSet, techCard: engineTechCard, customerMessage: engineCustomerMessage, evidence: [{ source: "OEM", fact: "Двигатель требует PSA B71 2312, объём 4 л.", status: "confirmed", url: null }] });
assert.ok(engineResult, "engine service keeps the same checked QuoteSet contract");
const bundleMessage = buildQuoteAndTechCardBundleCustomerMessage({ vehicle: result.vehicle, results: [engineResult, result] });
assert.equal(bundleMessage.status, "ready", "a ready engine quote must not be lost beside a partial transmission tech card");
assert.match(bundleMessage.text, /Замена масла в двигателе/u, "bundle customer text includes the engine service");
assert.match(bundleMessage.text, /Частичная замена масла в АКПП/u, "bundle customer text includes the transmission service");
assert.match(bundleMessage.text, /Моторное масло 0W-30/u, "bundle keeps an engine material separate from ATF");
assert.match(bundleMessage.text, /Valvoline ATF/u, "bundle keeps the transmission material separate from engine oil");
const bundle = parseQuoteAndTechCardArtifact({ scenario: "quote_and_tech_card_bundle", status: "partial", vehicle: result.vehicle, results: [engineResult, result], customerMessage: bundleMessage, evidence: [...engineResult.evidence, ...result.evidence] });
assert.equal(bundle?.scenario, "quote_and_tech_card_bundle", "bundle is accepted as a strict public attachment contract");
assert.equal(bundle?.results.length, 2, "bundle preserves two independent technical cards and quote sets");
assert.equal(buildQuoteAndTechCardArtifactCustomerMessage(bundle).status, "ready", "deterministic customer-message actions also support a complex quote");
assert.equal(parseQuoteAndTechCardToolResult({ ...bundle, quoteSnapshots: [{ argumentsValue: {}, preview: {} }], finalQuote: false })?.scenario, "quote_and_tech_card_bundle", "runner strips operational metadata before validating a complex quote attachment");
const engineBlocker = { code: "SPECIFICATION_NOT_CONFIRMED", message: "Не подтверждён допуск моторного масла.", requiredToContinue: "Укажите VIN либо модель, год и допуск масла." };
const blockedEngineResult = parseQuoteAndTechCardResult({
  ...engineResult,
  status: "blocked",
  quoteSet: { ...engineQuoteSet, status: "blocked", options: [{ ...engineOption, status: "blocked", lines: [], totalCents: null, blockers: [engineBlocker] }], hardBlockers: [engineBlocker] },
  customerMessage: { status: "blocked", text: "Нужен VIN." },
});
const partialBundleMessage = buildQuoteAndTechCardBundleCustomerMessage({ vehicle: result.vehicle, results: [blockedEngineResult, result] });
assert.equal(partialBundleMessage.status, "ready", "a blocked engine line does not erase a ready transmission quote");
assert.match(partialBundleMessage.text, /Замена масла в двигателе.*Укажите VIN/u, "the client message keeps the unresolved second service visible");
const legacyOptions = options.map((option) => {
  const legacyOption = { ...option };
  delete legacyOption.quantityTrace;
  delete legacyOption.materialSelectionTrace;
  delete legacyOption.servicePackage;
  return legacyOption;
});
const legacyTechCard = { ...techCard };
delete legacyTechCard.procedureVolumes;
delete legacyTechCard.servicePackages;
delete legacyTechCard.serviceHardware;
delete legacyTechCard.filterSummary;
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
