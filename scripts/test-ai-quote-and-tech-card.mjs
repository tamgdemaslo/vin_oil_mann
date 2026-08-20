#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const {
  buildQuoteAndTechCardCustomerMessage,
  createQuoteAndTechCardPlan,
  parseQuoteAndTechCardResult,
} = await jiti.import("../src/lib/ai-assistant/quote-and-tech-card.ts");

const base = {
  locationId: "dachnaya",
  vehicle: { displayName: "Hyundai Tucson 2.0 AT", aggregateCode: "A6MF1", snapshot: { year: 2019 } },
  service: {
    type: "automatic_transmission",
    name: "Замена жидкости АКПП",
    requiredFluidSpec: "Hyundai SP-IV",
    partialVolumeLiters: 4.3,
    totalCapacityLiters: 7.1,
    procedures: ["partial", "machine"],
    filterAccess: "internal_requires_disassembly",
    torqueNotes: [],
    levelProcedure: "Выставить уровень по температуре жидкости.",
    servicePoints: ["Слив", "Залив", "Контроль уровня"],
    criticalChecks: ["Проверить течи после прогрева"],
  },
  selectedProducts: [],
  consumables: [],
  rosskoItems: [{ article: "46321-3B000", brand: "Hyundai", quantity: 1, role: "internal_filter" }],
  localCatalogChecked: true,
  softWarnings: [],
  evidence: [],
};

const plan = createQuoteAndTechCardPlan(base);
assert.equal(plan.options.length, 2, "не более двух вариантов процедуры");
assert.equal(plan.options[0].billableLiters, 5, "4.3 л округляются вверх до 5 л");
assert.equal(plan.options[1].billableLiters, 13, "аппаратный объём использует настраиваемый множитель и округление");
assert.match(plan.softWarnings.join(" "), /внутренний фильтр/i, "фильтр с разборкой исключается с предупреждением");
assert.match(plan.softWarnings.join(" "), /Моменты/i, "отсутствующие моменты — мягкая неопределённость");
assert.equal(plan.hardBlockers.length, 0, "подтверждённые VIN/допуск не блокируют сценарий");

const calibrated = createQuoteAndTechCardPlan(base, { transmissionMachineExchangeMultiplier: 1.65 });
assert.equal(calibrated.options[1].billableLiters, 12, "филиал может настроить множитель для аппаратной замены");

const missingSpec = createQuoteAndTechCardPlan({ ...base, service: { ...base.service, requiredFluidSpec: null } });
assert.equal(missingSpec.hardBlockers[0]?.code, "SPECIFICATION_NOT_CONFIRMED", "нет допуска — жёсткий блокер");

const missingVehicle = createQuoteAndTechCardPlan({ ...base, vehicle: { displayName: null } });
assert.equal(missingVehicle.hardBlockers[0]?.code, "VEHICLE_NOT_IDENTIFIED", "нет автомобиля — жёсткий блокер");

assert.throws(() => createQuoteAndTechCardPlan({ ...base, service: { ...base.service, procedures: ["partial", "machine", "standard"] } }), /Too big|maximum/i, "контракт не допускает третий вариант");

const result = parseQuoteAndTechCardResult({
  scenario: "quote_and_tech_card",
  status: "ready",
  vehicle: { displayName: "Hyundai Tucson 2.0 AT", aggregate: "A6MF1" },
  techCard: { serviceName: "Замена жидкости АКПП", serviceType: "automatic_transmission", requiredFluidSpec: "Hyundai SP-IV", filterPolicy: "Внутренний фильтр исключён.", levelProcedure: null, servicePoints: [], torqueNotes: [], criticalChecks: [], selectedMaterial: { name: "ATF SP-IV", quantity: 5, compatibilityEvidence: "SP-IV" } },
  options: [{ code: "partial", label: "Частичная замена", status: "ready", confidence: "final", requiredLiters: 5, lines: [{ name: "ATF SP-IV", article: null, quantity: 5, totalCents: 750000 }, { name: "Работа", article: null, quantity: 1, totalCents: 400000 }], totalCents: 1150000, maximumTotalCents: null, validUntil: null, blockers: [], warnings: [] }],
  hardBlockers: [],
  softWarnings: [],
  evidence: [],
  customerMessage: "",
});
assert.ok(result, "результат проходит строгую Zod-проверку");
const clientText = buildQuoteAndTechCardCustomerMessage(result);
assert.match(clientText, /11[\s ]?500 ₽/u, "клиентский текст берёт сумму только из готовой сметы");
assert.match(clientText, /ATF SP-IV/u, "клиентский текст использует подобранный материал");
assert.doesNotMatch(clientText, /46321-3B000/u, "внутренний фильтр не попадает в клиентский текст");

console.log("AI quote-and-tech-card tests — passed");
