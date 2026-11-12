import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";

function load(path, modules = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  new Function("require", "exports", compiled.outputText)(name => {
    assert.ok(name in modules, `Unexpected dependency ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

const { uniqueQuickBookingService, uniqueQuickOption } = load("src/lib/quick-assistant.ts");
const { journalId } = load("src/lib/booking/journal-id.ts");
const masters = [{ name: "Семён", id: 1 }, { name: "Алексей", id: 2 }];
assert.equal(uniqueQuickOption(" семен ", masters)?.id, 1);
assert.equal(uniqueQuickOption("Алексей", [...masters, { name: "Алексей", id: 3 }]), undefined);
assert.equal(uniqueQuickOption("", masters), undefined);
const oilService = { id: "oil", name: "Замена моторного масла в двигателе и масляного фильтра", masterIds: [1] };
const oilOnly = { id: "oil-only", name: "Замена моторного масла в двигателе", masterIds: [1] };
const oilHint = "Замена моторного масла и масляного фильтра";
assert.equal(uniqueQuickBookingService(oilHint, [oilOnly, oilService])?.id, "oil");
assert.equal(uniqueQuickBookingService(oilHint, [oilOnly]), undefined);
assert.equal(uniqueQuickBookingService(oilOnly.name, [oilService])?.id, "oil");
assert.equal(uniqueQuickBookingService(oilOnly.name, [oilService, oilOnly])?.id, "oil-only");
assert.equal(uniqueQuickBookingService(oilOnly.name, [oilService, { ...oilService, id: "other" }]), undefined);
assert.equal(uniqueQuickBookingService(oilHint, [oilService, { ...oilService, id: "other" }]), undefined);

const access = {
  branchId: "branch-a",
  branchName: "Первый филиал",
  actorId: "owner",
  organizationId: "org",
  session: { user: { login: "owner", name: "Owner" } },
  context: { branch: { timezone: "Europe/Kaliningrad" } },
};
let signedIn = true;
let canBook = true;
let modelCalls = 0;
let chainStockBranch = "branch-a";
let chainSlotAvailable = true;
let chainStockChecks = [];
const secondBranch = { ...access, branchId: "branch-b", branchName: "Гагарина", context: { branch: { timezone: "Europe/Kaliningrad" } } };
access.branches = [{ id: "branch-a", name: "Дачная" }, { id: "branch-b", name: "Гагарина" }];
let matchingVisits = [];
let lookupMaterial = false;
let catalogFixtureFound = false;
let queries = 0;
let modelResult = { kind: "task", customerName: "Тестовый Клиент", title: "Уточнить наличие фильтра" };
const auth = {
  requireAIAssistantAccess: async () => signedIn ? access : { response: NextResponse.json({}, { status: 401 }) },
  branchAccess: (_, id) => { assert.equal(id, "branch-b"); return secondBranch; },
  runWithAIAssistantBranchContext: (current, operation) => {
    assert.ok(current === access || current === secondBranch);
    return operation();
  },
};
const product = { id: "product-a", name: "Масляный фильтр", entityType: "product", archived: false };
const order = {
  id: "order-a", name: "0042", updatedAt: new Date("2026-11-09T09:00:00Z"),
  counterparty: { id: "client-a", name: "Тестовый Клиент", archived: false },
  store: { id: "store-a", name: "Основной", archived: false, organizationId: "org" },
  organization: { id: "org", name: "Организация", isActive: true },
  positions: [1, 2].map(id => ({
    id: String(id), name: product.name, product, quantity: 2, discount: 10,
    priceCentsPerUnit: 10000, vat: 0, vatEnabled: false, raw: {},
  })),
};
let available = 3;
let orderMatches = [order];
let writes = 0;
const saved = new Map();
const db = { prisma: {
  localDemand: {
    findFirst: async ({ where }) => {
      assert.equal(where.branchId, access.branchId);
      return where.id === order.id ? order : saved.get(where.id) ?? null;
    },
    findMany: async ({ where }) => {
      assert.equal(where.branchId, access.branchId);
      return where.id?.in ? [{ id: order.id, name: order.name, applicable: true, documentDate: "2026-11-09" }] : orderMatches;
    },
  },
  localStockBalance: { findMany: async ({ where }) => {
    assert.deepEqual(where, { branchId: "branch-a", storeId: "store-a", productId: { in: ["product-a"] } });
    return [{ productId: "product-a", available }];
  } },
  crmDeal: {
    findMany: async ({ where }) => {
      assert.equal(where.branchId, access.branchId);
      assert.ok(where.AND.some(filter => filter.customerName?.contains === "Тестовый Клиент"));
      return [{
        id: "case-a", title: "Подобрать фильтр", customerName: "Тестовый Клиент", status: "open",
        caseStatus: "calculation_needed", nextAction: "Уточнить наличие", nextActionAt: null,
        nextContactAt: null, updatedAt: order.updatedAt, responsibleLogin: "owner", shipmentId: order.id,
      }];
    },
    count: async ({ where }) => {
      assert.equal(where.branchId, access.branchId);
      return 1;
    },
  },
  booking: { findMany: async ({ where }) => {
    assert.equal(where.branchId, access.branchId);
    assert.deepEqual(where.status, { not: "CANCELLED" });
    return [{ id: "booking-a", customerName: "Тестовый Клиент", startsAt: order.updatedAt, confirmationState: "CONFIRMED" }];
  } },
} };
const shipmentModule = load("src/lib/ai-assistant/quick-shipment.ts", { "node:crypto": crypto, "@/lib/db": db });
const journalTime = { utcInstantToJournalLocal: () => "2026-11-09T11:00" };
const crmModule = load("src/lib/ai-assistant/quick-crm.ts", {
  "@/lib/db": db,
  "@/lib/booking/access": { canViewBookings: () => true, bookingViewIsSelfOnly: () => false },
  "@/lib/booking/timezone": { formatLocalDate: () => "2026-11-09" },
  "@/lib/booking/journal-time": journalTime,
  "@/lib/booking/journal-id": { journalId },
  "@/lib/booking/constants": { BOOKING_STATUS: { CANCELLED: "CANCELLED" } },
  "@/lib/client-case-shared": load("src/lib/client-case-shared.ts"),
});
const { quickMaintenanceQuote } = load("src/lib/ai-assistant/quick-maintenance-quote.ts", {
  "@/lib/vehicle-normalization": load("src/lib/vehicle-normalization.ts"),
  "@/lib/db": { prisma: { localStore: { findMany: async () => [{ id: "test-store", name: "Склад", isMain: true }] } } },
  "@/lib/vehicle-identity": { lookupVehicle: async () => ({
    status: "found", candidates: [{}], vehicle: { makeRaw: "Chevrolet", modelRaw: "Lacetti" },
  }) },
  "@/lib/mann-research-catalog": {},
  "@/lib/mann-fluid-research": {},
  "@/lib/maintenance-quote-stock": {},
  "@/lib/maintenance-quote": {},
  "@/lib/oil-normalizer": {},
  "@/lib/ai-agent/settings": {},
  "@/lib/rossko": {},
  "@/lib/maintenance-quote-rossko": {},
  "./labor-pricing": {},
  "./tariff-context": {},
  "./technical-context": { mannContext: () => assert.fail("Conflicting vehicle must not reach the parts catalogue") },
});
const conflictingQuote = await quickMaintenanceQuote(access, {
  vin: "X4XNA78435B675505", expectedMake: "БМВ", viscosities: ["5W-30"], filterTypes: ["oil"], warehouse: "",
});
assert.match(conflictingQuote.text, /БМВ.*Chevrolet Lacetti/);
assert.deepEqual(conflictingQuote.sources, []);

const { POST } = load("src/app/api/ai-assistant/quick-command/route.ts", {
  "@/lib/quick-assistant": load("src/lib/quick-assistant.ts"),
  "@/lib/booking/timezone": { addLocalDays: () => "2026-11-10" },
  "next/server": { NextResponse },
  "@/lib/ai-assistant/access": auth,
  "@/lib/ai-assistant/quick-shipment": shipmentModule,
  "@/lib/ai-assistant/quick-crm": crmModule,
  "@/lib/ai-assistant/quick-maintenance-quote": { quickMaintenanceQuote: async (current, input) => {
    assert.equal(current, access);
    assert.deepEqual(input, { vin: "JTDBR32E720012345", expectedMake: "Toyota", viscosities: ["5W-30", "5W-40"], filterTypes: ["oil", "air", "cabin"], warehouse: "" });
    return { text: "Расчёт ТО: 5W-30 и 5W-40 с работой", sources: [] };
  } },
  "@/lib/ai-assistant/tariff-context": { assistantTariffContext: async () => ({ locationId: "test" }) },
  "@/lib/ai-assistant/labor-pricing": { resolveLaborPrice: async () => ({ laborPriceCents: 0, requiresHumanConfirmation: false }) },
  "@/lib/ai-assistant/quick-catalog": {
    findQuickCatalogProducts: async queries => {
      assert.deepEqual(queries, ["Eurol Ultrance VCC 0W-20", "Eurol Ultrance"]);
      return catalogFixtureFound ? [{ id: "oil-vcc", name: "Eurol Ultrance VCC 0W-20", article: "E100017", viscosity: "0W-20" }] : [];
    },
    searchQuickCatalog: async input => {
    if (modelResult.kind === "chain") {
      assert.equal(input.maxRubles, 5000);
      assert.equal(input.liters, 5);
      assert.equal(input.approval, "VW 504 00");
      const branchId = chainStockChecks.length ? "branch-b" : "branch-a";
      chainStockChecks.push(branchId);
      return { total: Number(branchId === chainStockBranch), complete: true, products: branchId === chainStockBranch
        ? [{ id: "oil-a", name: "Масло VW 504 00", subtotalRubles: 4500, purchasedLiters: 5, warehouses: [{ enough: true }] }] : [] };
    }
    assert.deepEqual(input, { query: "", approval: "C2", viscosity: "", liters: 6, article: "", packageVolume: "", warehouse: "", maxRubles: null });
    return { total: 1, products: [{ id: "oil-a", name: "Тестовое масло C2", neededUnits: 2, purchasedLiters: 8, unit: "шт.", warehouses: [{ name: "Основной", enough: true }] }] };
  } },
  "@/lib/ai-assistant/quick-booking-tools": {
    lookupQuickCustomers: async (_, input) => {
      assert.equal(input.customerId, "open-card");
      return { status: "matched", customer: { name: "Тестовый Клиент", phone: "79990000000" } };
    },
    listQuickBookingServices: async () => [{ id: "service-1", name: "Диагностика" }],
    findQuickBookingSlots: async (_, input) => {
      assert.deepEqual(input, { date: "2026-11-10", after: "14:00", serviceIds: ["service-1"] });
      return { slots: chainSlotAvailable ? [{ time: "14:30", master: "Мастер" }] : [] };
    },
  },
  "@/lib/branch-context": { getBranchContext: async () => secondBranch.context },
  "@/lib/ai-assistant/quick-inventory-actions": {},
  "@/lib/ai-assistant/quick-vehicle": { answerQuickVehicle: async (current, question, system) => {
    assert.equal(current, access);
    assert.equal(question, "Допуск масла VIN JTDBR32E720012345");
    assert.equal(system, "engine_oil");
    return { text: "Проверенный допуск", sources: [] };
  } },
  "@/lib/booking/access": { canManageBookings: () => canBook },
  "@/lib/booking/constants": { BOOKING_MASTER_ROLE_ID: "master", BOOKING_STATUS: { ACTIVE: "ACTIVE" } },
  "@/lib/booking/journal-id": { journalId },
  "@/lib/booking/journal-time": { utcInstantToJournalLocal: () => "2026-11-09T11:00", journalLocalToUtcIso: value => value + ":00.000Z" },
  "@/lib/db": { prisma: {
    booking: { findMany: async ({ where }) => {
      assert.equal(where.branchId, "branch-a");
      assert.equal(where.status, "ACTIVE");
      assert.deepEqual(where.OR.map(row => row.customerName.contains), ["Аслан", "Сослан"]);
      assert.equal(where.startsAt.gte.toISOString(), "2026-11-09T00:00:00.000Z");
      return matchingVisits;
    } },
    localCounterparty: { findMany: async ({ where }) => {
      queries++;
      assert.equal(where.branchId, modelResult.kind === "chain" ? chainStockBranch : "branch-a");
      return [{ name: "Тестовый Клиент", normalizedPhone: "79990000000" }];
    } },
    bookingService: { findMany: async ({ where }) => {
      assert.equal(where.branchId, modelResult.kind === "chain" ? chainStockBranch : "branch-a");
      return [{ id: "service-1", name: "Диагностика", masters: [{ membershipId: "membership-1" }] },
        ...(modelResult.services ? [{ id: "service-2", name: "Замена воздушного фильтра", masters: [{ membershipId: "membership-1" }] }] : [])];
    } },
    branchMembership: { findMany: async ({ where }) => {
      assert.equal(where.branchId, modelResult.kind === "chain" ? chainStockBranch : "branch-a");
      return [{ id: "membership-1", user: { name: "Мастер" } }];
    } },
  } },
  "@/lib/openai-client": { createOpenAIClient: () => ({
    responses: { create: async request => {
      modelCalls++;
      assert.equal(request.model, process.env.OPENAI_QUICK_ASSISTANT_MODEL?.trim() || "gpt-6-luna");
      assert.equal(request.store, false);
      if (request.tools.some(tool => tool.name === "choose_service")) {
        const { draftService, catalog } = JSON.parse(request.input);
        return { usage: { input_tokens: 80, output_tokens: 10 }, output: [{ type: "function_call", name: "choose_service", arguments: JSON.stringify({
          assessments: catalog.map(row => ({ option: row.option, match: row.name === draftService ? "exact" : "unrelated" })),
        }) }] };
      }
      if (request.tools.some(tool => tool.type === "web_search")) {
        const vehicle = JSON.parse(request.input);
        assert.equal(vehicle.model, "Solaris");
        assert.equal(vehicle.engine, "1.6 бензин");
        return { output_text: "Найдена рекомендация в руководстве.", output: [{ type: "message", content: [{
          type: "output_text", annotations: [{ type: "url_citation", url: "https://example.test/manual", title: "Руководство" }],
        }] }] };
      }
      assert.ok(request.tools.some(tool => tool.name === "search_stock"));
      assert.match(request.instructions, /2026-11-09T11:00/);
      const output = request.input.findLast(item => item.type === "function_call_output");
      assert.equal(request.tool_choice, undefined);
      if (modelResult.kind === "chain") {
        const facts = output && JSON.parse(output.output);
        const usage = { input_tokens: 100, output_tokens: 20 };
        const call = (name, args) => ({ usage, output: [{ type: "function_call", name, call_id: name, arguments: JSON.stringify(args) }] });
        const stock = branchId => call("search_stock", { branchId, approval: "VW 504 00", viscosity: "5W-30", liters: 5, maxRubles: 5000 });
        if (!output) return call("list_branches", {});
        if (output.call_id === "list_branches") return stock(facts.branches[0].id);
        if (output.call_id === "search_stock") {
          if (facts.products.length) return call("find_customer", { currentCard: true });
          if (chainStockChecks.length === 1) return stock("branch-b");
          return { usage, output: [], output_text: "Масло не найдено." };
        }
        if (output.call_id === "find_customer") return call("list_booking_services", { branchId: chainStockBranch });
        if (output.call_id === "list_booking_services") return call("find_booking_slots", { branchId: chainStockBranch, date: "2026-11-10", after: "14:00", serviceIds: [facts[0].id] });
        if (output.call_id === "prepare_booking") return { usage, output: [], output_text: "Черновик готов." };
        if (!facts.slots.length) return { usage, output: [], output_text: "Свободного окна нет." };
        return call("prepare_booking", { branchId: chainStockBranch, stockProductId: "oil-a", customerName: "Тестовый Клиент", phone: "79990000000",
          datetime: "2026-11-10T" + facts.slots[0].time, master: facts.slots[0].master, service: "Диагностика", taskTitle: "Проверить фильтр по VIN" });
      }
      if (modelResult.kind === "reschedule" && lookupMaterial) {
        if (!output) return { output: [{ type: "function_call", name: "find_catalog_product", call_id: "catalog-call",
          arguments: JSON.stringify({ queries: ["Eurol Ultrance VCC 0W-20", "Eurol Ultrance"] }) }] };
        const facts = JSON.parse(output.output);
        return { output: [{ type: "function_call", name: "prepare_reschedule", call_id: "move-call",
          arguments: JSON.stringify({ ...modelResult, shopProductId: facts[0]?.id ?? "" }) }] };
      }
      if (output) {
        const facts = JSON.parse(output.output);
        if (modelResult.kind === "research") {
          assert.deepEqual(facts.sourceUrls, ["https://example.test/manual"]);
          return { output: [], output_text: facts.findings };
        }
        if (modelResult.kind === "maintenance") return { output: [], output_text: facts };
        if (modelResult.kind === "vehicle") assert.equal(facts, "Проверенный допуск");
        if (modelResult.kind === "stock") assert.equal(facts.products[0].purchasedLiters, 8);
        if (modelResult.kind === "crm") {
          assert.equal(facts.matchingCases, 1);
          assert.equal(facts.cases[0].nextAction, "Уточнить наличие");
          assert.equal(facts.cases[0].linkedShipment.status, "Проведена");
          assert.equal(facts.upcomingBookings[0].confirmation, "CONFIRMED");
        }
        const answers = { vehicle: "Проверенный допуск", stock: "Да. Масло C2 · 2 шт. (8 л).", crm: "В CRM есть дело по подбору фильтра." };
        return { output: [], output_text: answers[modelResult.kind] };
      }
      if (modelResult.kind === "research") {
        assert.match(request.input[0].content, /Solaris/);
        assert.match(request.input.at(-1).content, /бензин/);
        return { output: [{ type: "function_call", name: "research_vehicle", call_id: "research-call",
          arguments: JSON.stringify({ make: "Hyundai", model: "Solaris", year: "2018", engine: "1.6 бензин", topic: "Допуск масла" }) }] };
      }
      if (modelResult.kind === "unsupported") return { output: [], output_text: "Уточните, пожалуйста, что проверить." };
      if (modelResult.kind === "stock") {
        assert.match(request.input.at(-1).content, /6 литров/);
        assert.match(request.input[0].content, /C2/);
      }
      const name = { vehicle: "read_vehicle", crm: "read_crm", stock: "search_stock", maintenance: "calculate_maintenance_quote" }[modelResult.kind] ?? `prepare_${modelResult.kind}`;
      const args = modelResult.kind === "vehicle" ? { ...modelResult, question: "Тестовая команда" } : modelResult;
      return { output: [{ type: "function_call", name, arguments: JSON.stringify(args), call_id: "call_test" }] };
    } },
    audio: { transcriptions: { create: async ({ file, language }) => {
      assert.ok(["command.webm", "command.mp4"].includes(file.name));
      assert.equal(await file.text(), "fake recording");
      assert.equal(language, "ru");
      return { text: " Тестовая команда " };
    } } },
  }) },
  "@/lib/phone-normalize": load("src/lib/phone-normalize.ts"),
});

function request(branch = "branch-a", audio) {
  return new NextRequest("http://localhost/api/ai-assistant/quick-command", {
    method: "POST",
    headers: audio
      ? { "x-eco-assistant-branch": branch }
      : { "Content-Type": "application/json", "x-eco-assistant-branch": branch },
    body: audio ?? JSON.stringify({ text: "Тестовая команда" }),
  });
}

process.env.OPENAI_API_KEY = "mock-only";
signedIn = false;
assert.equal((await POST(request())).status, 401);
signedIn = true;
assert.equal((await POST(request("branch-b"))).status, 409);
assert.equal(modelCalls, 0);
assert.equal(queries, 0);

const audio = new FormData();
audio.set("audio", new Blob(["fake recording"], { type: "audio/webm" }), "command");
assert.deepEqual(await (await POST(request("branch-a", audio))).json(), { text: "Тестовая команда" });

function rawRecording(body, mime) {
  return new NextRequest("http://localhost/api/ai-assistant/quick-command", {
    method: "POST",
    headers: { "Content-Type": mime, "x-eco-assistant-branch": "branch-a" },
    body,
  });
}
const safariAudio = new TextEncoder().encode("fake recording").buffer;
assert.deepEqual(await (await POST(rawRecording(safariAudio, "audio/mp4; codecs=mp4a.40.2"))).json(), { text: "Тестовая команда" });
assert.equal((await POST(rawRecording(new ArrayBuffer(0), "audio/mp4"))).status, 400);
assert.equal((await POST(rawRecording(new ArrayBuffer(4 * 1024 * 1024 + 1), "audio/mp4"))).status, 413);
assert.equal((await POST(rawRecording(safariAudio, "audio/flac"))).status, 400);
assert.equal(queries, 0);

const task = await (await POST(request())).json();
assert.equal(task.draft.kind, "task");
assert.equal(task.draft.phone, "79990000000");
assert.equal(task.branch.login, "owner");
assert.equal(task.options, undefined);

modelResult = { kind: "unsupported" };
assert.match((await (await POST(request())).json()).answer.text, /Уточните/);
assert.equal(queries, 1);

modelResult = { kind: "booking", customerName: "Тестовый Клиент", datetime: "2026-11-10T15:00", service: "Диагностика" };
canBook = false;
assert.equal((await POST(request())).status, 403);
assert.equal(queries, 1);
canBook = true;
const booking = await (await POST(request())).json();
assert.equal(booking.draft.datetime, "2026-11-10T15:00");
assert.equal(booking.selectedServiceId, "service-1");
const bookingModelResult = modelResult;
modelResult = { ...bookingModelResult, services: ["Диагностика", "Замена воздушного фильтра"], taskTitle: "Заказать воздушный фильтр" };
const combinedBooking = await (await POST(request())).json();
assert.deepEqual(combinedBooking.selectedServiceIds, ["service-1", "service-2"]);
assert.equal(combinedBooking.relatedTask.title, "Заказать воздушный фильтр");
modelResult = { kind: "reschedule", names: ["Аслан", "Сослан"], sourceDay: "2026-11-09", datetime: "2026-11-10T13:00", customerMaterials: "масляный фильтр", shopMaterials: "масло Eurol" };
matchingVisits = [{ id: "visit-a", customerName: "Сослан", startsAt: new Date("2026-11-09T11:00Z"), updatedAt: new Date("2026-11-09T09:00Z") }];
lookupMaterial = true;
const moved = (await (await POST(request())).json()).reschedule;
assert.equal(moved.recordId, "visit-a");
assert.equal(moved.datetime, "2026-11-10T13:00");
assert.match(moved.notes, /Клиент привезёт: масляный фильтр.*Материалы сервиса: масло Eurol/s);
assert.match(moved.notes, /не сверено с каталогом/);
catalogFixtureFound = true;
const matchedProduct = (await (await POST(request())).json()).reschedule;
assert.match(matchedProduct.notes, /Eurol Ultrance VCC 0W-20/);
assert.doesNotMatch(matchedProduct.notes, /не сверено/);
lookupMaterial = false;
matchingVisits = [...matchingVisits, { ...matchingVisits[0], id: "visit-b", customerName: "Аслан" }];
const ambiguous = await (await POST(request())).json();
assert.equal(ambiguous.reschedule, undefined);
assert.equal(ambiguous.answer.sources.length, 2);
modelResult = bookingModelResult;
assert.deepEqual(booking.options.services[0].masterIds, [booking.options.masters[0].id]);
assert.equal(booking.branch.id, "branch-a");

modelResult = { kind: "vehicle", system: "engine_oil" };
const ask = (text, history = []) => new NextRequest("http://localhost/api/ai-assistant/quick-command", {
  method: "POST", headers: { "Content-Type": "application/json", "x-eco-assistant-branch": "branch-a" },
  body: JSON.stringify({ text, history }),
});
assert.equal((await (await POST(ask("Допуск масла JTDBR32E720012345"))).json()).answer.text, "Проверенный допуск");

modelResult = { kind: "research" };
const publicVehicle = (await (await POST(ask("Двигатель 1.6 бензин", [
  { role: "user", content: "Какой допуск масла для Hyundai Solaris 2018?" },
]))).json()).answer;
assert.equal(publicVehicle.text, "Найдена рекомендация в руководстве.");
assert.equal(publicVehicle.sources[0].href, "https://example.test/manual");

modelResult = { kind: "crm", customerName: "Тестовый Клиент", filter: "all" };
const crm = await (await POST(request())).json();
assert.match(crm.answer.text, /подбору фильтра/);
assert.deepEqual(crm.answer.sources.map(source => source.href), [
  "/crm?dealId=case-a", `/records?recordId=${journalId("booking-a")}`, "/shipment/order-a/edit",
]);

modelResult = { kind: "stock", query: "", approval: "C2", viscosity: "", liters: 6 };
const stockRequest = new NextRequest("http://localhost/api/ai-assistant/quick-command", {
  method: "POST", headers: { "Content-Type": "application/json", "x-eco-assistant-branch": "branch-a" },
  body: JSON.stringify({ text: "Мне нужно 6 литров", history: [{ role: "user", content: "Какие масла C2 есть?" }] }),
});
const stockAnswer = (await (await POST(stockRequest)).json()).answer;
assert.match(stockAnswer.text, /^Да.*2 шт\. \(8 л\)/);
assert.equal(stockAnswer.sources[0].href, "/inventory/products?product=oil-a");

modelResult = { kind: "maintenance", vin: "", expectedMake: "Toyota", viscosities: ["5W-30", "5W-40"], filterTypes: ["oil", "air", "cabin"], warehouse: "" };
const quoteRequest = new NextRequest("http://localhost/api/ai-assistant/quick-command", {
  method: "POST", headers: { "Content-Type": "application/json", "x-eco-assistant-branch": "branch-a" },
  body: JSON.stringify({ text: "Сравни 5W-30 и 5W-40.", history: [
    { role: "user", content: "Рассчитай ТО для Toyota по VIN JTDBR32E720012345." },
    { role: "assistant", content: "VIN/Frame: неизвестен" },
  ] }),
});
assert.match((await (await POST(quoteRequest)).json()).answer.text, /5W-30 и 5W-40 с работой/);

modelResult = { kind: "chain" };
for (const [branch, slot, wording] of [
  ["branch-a", true, "Посмотри на Дачной, затем Гагарина, 5 литров 5W-30 до 5000, запиши клиента из карточки и создай дело."],
  ["branch-b", true, "Если на Дачной пусто, проверь Гагарина. Нашёл масло — поставь визит после двух и дело по фильтру."],
  ["", true, "Проверь масло в обоих филиалах."],
  ["branch-b", false, "Найди масло, затем первое свободное окно."],
]) {
  chainStockBranch = branch;
  chainSlotAvailable = slot;
  chainStockChecks = [];
  const response = await POST(new NextRequest("http://localhost/api/ai-assistant/quick-command", {
    method: "POST", headers: { "Content-Type": "application/json", "x-eco-assistant-branch": "branch-a" },
    body: JSON.stringify({ text: wording, currentCustomerId: "open-card" }),
  }));
  const result = await response.json();
  assert.deepEqual(chainStockChecks, branch === "branch-a" ? ["branch-a"] : ["branch-a", "branch-b"]);
  if (branch && slot) {
    assert.equal(result.branch.id, branch);
    assert.equal(result.draft.datetime, "2026-11-10T14:30");
    assert.equal(result.relatedTask.title, "Проверить фильтр по VIN");
    assert.match(response.headers.get("Server-Timing"), /input=\d+, output=\d+, calls=[78]/);
  } else {
    assert.equal(result.draft, undefined);
    assert.match(result.answer.text, branch ? /окна нет/ : /не найдено/);
  }
}

modelResult = { kind: "shipment", reference: "0042" };
orderMatches = [order, { ...order, id: "another-order" }];
assert.equal((await (await POST(request())).json()).answer.sources.length, 2);
orderMatches = [order];
const previewResponse = await POST(request());
assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
const { shipment } = await previewResponse.json();
assert.equal(shipment.customer, "Тестовый Клиент");
assert.equal(shipment.totalCents, 36000);
assert.ok(shipment.positions.every(position => position.shortage));
assert.equal(writes, 0);

const vehicle = { makeRaw: "Toyota", modelRaw: "Corolla", year: 2019, engineCode: "2ZR" };
let decode = { status: "found", vehicle, candidates: [{ vehicle }] };
let catalog = { status: "resolved", filters: [
  { filterType: "oil", mannArticle: "W 68/3", condition: "до 2020" },
  { filterType: "air", mannArticle: "C 30 005" },
] };
const partsVin = "JTDBR32E720012345";
const partsCar = { vin: partsVin, catalogId: "fixture", carId: "car", make: "Toyota", model: "Corolla" };
let partsCars = [partsCar];
let partsRequests = 0;
const { getFiltersFromPartsCatalogs } = load("src/lib/parts-catalogs-filters.ts", {
  "./parts-catalogs": { partsCatalogsRequest: async (path, params) => {
    partsRequests++;
    if (path === "/car/info") {
      assert.equal(params.q, partsVin);
      return { status: 200, data: partsCars };
    }
    if (path.endsWith("/groups2/")) return { status: 200, data: params.groupId
      ? [{ id: "oil", name: "Oil filter", hasParts: true }]
      : [{ id: "filters", name: "Filters", hasSubgroups: true }] };
    return { status: 200, data: { partGroups: [{ parts: [
      { name: "Oil filter", number: "90915-YZZF2" },
      { name: "Oil filter" },
    ] }] } };
  } },
});
assert.equal((await getFiltersFromPartsCatalogs(partsVin, { strictVin: true })).oilFilterOem, "90915YZZF2");
partsCars = [partsCar, { ...partsCar, carId: "other" }];
partsRequests = 0;
assert.deepEqual(await getFiltersFromPartsCatalogs(partsVin, { strictVin: true }), {});
assert.equal(partsRequests, 1);
partsCars = [{ ...partsCar, vin: "JTDBR32E720012346" }];
assert.deepEqual(await getFiltersFromPartsCatalogs(partsVin, { strictVin: true }), {});

let lookups = 0;
let oemFilters = {};
const { answerQuickVehicle } = load("src/lib/ai-assistant/quick-vehicle.ts", {
  "@/lib/parts-catalogs-filters": { getFiltersFromPartsCatalogs: async (vin, options) => {
    assert.equal(vin, "JTDBR32E720012345");
    assert.equal(options.strictVin, true);
    return oemFilters;
  } },
  "@/lib/vehicle-normalization": load("src/lib/vehicle-normalization.ts"),
  "./technical-answer": { buildTechnicalCustomerAnswer: (_, facts) => ({ text: String(facts[0].value), verifiedFacts: facts }) },
  "./technical-context": {
    mannContext: async () => ({ resolution: catalog }),
    mannResolutionDiagnostic: () => ({ message: "Подбор неоднозначен." }),
    technicalSystems: { engine_oil: "ENGINE_OIL" },
    verifiedLocalTechnicalInput: async (input, organizationId) => {
      assert.equal(organizationId, "org");
      assert.equal(input.vehicle.aggregateCode, "2ZR");
      return { facts: [{ value: "API SP", source: "Проверенный профиль", url: "https://example.com/spec" }] };
    },
  },
  "./quote-and-tech-card": { parseQuoteAndTechCardInput: input => input },
  "@/lib/vehicle-identity": { lookupVehicle: async input => {
    lookups++;
    assert.equal(input.organizationId, "org");
    assert.equal(input.input, "JTDBR32E720012345");
    return decode;
  } },
});
assert.match((await answerQuickVehicle(access, "Подбери фильтр", "")).text, /Укажите VIN/);
assert.equal(lookups, 0);
const vehicleAnswer = await answerQuickVehicle(access, "JTDBR32E720012345 масляный фильтр и допуск двигателя", "engine_oil");
assert.match(vehicleAnswer.text, /W 68\/3.*до 2020/s);
assert.doesNotMatch(vehicleAnswer.text, /C 30 005/);
assert.match(vehicleAnswer.text, /API SP/);
assert.equal(vehicleAnswer.sources[0].href, "https://example.com/spec");
const priorPartsKey = process.env.PARTS_CATALOGS_API_KEY;
try {
  process.env.PARTS_CATALOGS_API_KEY = "synthetic";
  oemFilters = { make: "Toyota", model: "Corolla", oilFilterOem: "90915YZZF2", airFilterOem: "178010D060" };
  const original = await answerQuickVehicle(access, "JTDBR32E720012345 оригинальный номер масляного фильтра", "", "Toyota");
  assert.match(original.text, /90915YZZF2.*Parts Catalogs/s);
  assert.doesNotMatch(original.text, /178010D060|W 68/);
  const conflict = await answerQuickVehicle(access, "JTDBR32E720012345 оригинальный номер масляного фильтра", "", "BMW");
  assert.match(conflict.text, /BMW.*Toyota/);
  assert.doesNotMatch(conflict.text, /90915YZZF2/);
} finally {
  if (priorPartsKey === undefined) delete process.env.PARTS_CATALOGS_API_KEY;
  else process.env.PARTS_CATALOGS_API_KEY = priorPartsKey;
}
catalog = { status: "candidates", filters: [] };
assert.match((await answerQuickVehicle(access, "JTDBR32E720012345 подбери фильтр", "")).text, /Подбор неоднозначен/);
decode = { ...decode, candidates: [{ vehicle }, { vehicle }] };
assert.match((await answerQuickVehicle(access, "JTDBR32E720012345 подбери фильтр", "")).text, /Не удалось однозначно/);

let cashAllowed = true;
const confirmShipment = load("src/app/api/ai-assistant/quick-command/shipment/route.ts", {
  "next/server": { NextResponse },
  "node:crypto": crypto,
  "@/lib/ai-assistant/access": auth,
  "@/lib/ai-assistant/quick-shipment": shipmentModule,
  "@/lib/api-session-cash-shift": { requireApiSessionWithCashShift: async () => cashAllowed
    ? { ok: true } : { ok: false, response: NextResponse.json({}, { status: 403 }) } },
  "@/lib/db": db,
  "@/lib/local-demand-write": { createLocalDemand: async (body, options) => {
    writes++;
    assert.equal(body.applicable, false);
    assert.equal(body.positions[0].price, 100);
    assert.equal(body.positions[0].discount, 10);
    assert.equal(options.branchId, "branch-a");
    const result = { id: options.demandId, name: "0051" };
    saved.set(result.id, result);
    return { ok: true, ...result };
  } },
}).POST;
function confirmation(preview, { confirm = true, branch = "branch-a" } = {}) {
  const { sourceId, fingerprint, nonce } = preview;
  return new NextRequest("http://localhost/api/ai-assistant/quick-command/shipment", {
    method: "POST", headers: { "Content-Type": "application/json", "x-eco-assistant-branch": branch },
    body: JSON.stringify({ confirm, sourceId, fingerprint, nonce }),
  });
}

assert.equal((await confirmShipment(confirmation(shipment, { confirm: false }))).status, 400);
assert.equal((await confirmShipment(confirmation(shipment, { branch: "branch-b" }))).status, 409);
cashAllowed = false;
assert.equal((await confirmShipment(confirmation(shipment))).status, 403);
cashAllowed = true;
available = 5;
const stale = await confirmShipment(confirmation(shipment));
assert.equal(stale.status, 409);
const { shipment: updated } = await stale.json();
assert.ok(updated.positions.every(position => !position.shortage));
assert.equal(writes, 0);
const created = await confirmShipment(confirmation(updated));
assert.equal(created.status, 201);
const createdData = await created.json();
assert.deepEqual(await (await confirmShipment(confirmation(updated))).json(), createdData);
assert.deepEqual(await (await confirmShipment(confirmation(shipment))).json(), createdData);
assert.equal(writes, 1);
console.log("Quick assistant CRM, shipment preview and confirmation, booking, task, VIN, and transcription checks passed");

const priorSessionSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "fixture-signing-key";
const receiptWrites = [];
const productWrites = [];
const postedReceiptCalls = [];
const fixtureInventory = {
  localStore: { findMany: async () => [], findFirst: async () => ({ name: "Учебный склад" }) },
  localCounterparty: { findMany: async () => [], findFirst: async () => ({ name: "Учебный поставщик" }) },
  localProduct: {
    findMany: async () => [{ id: "filter", name: "Фильтр", article: "TEST" }],
    findFirst: async () => productWrites.length ? { id: "created-product" } : null,
  },
  localInventoryDocument: {
    findFirst: async () => receiptWrites.length ? { id: "created-receipt", applicable: true } : null,
    findMany: async () => [{
      id: "draft-receipt", name: "005", updatedAt: new Date("2026-11-09T09:00Z"),
      positions: [{ productName: "Фильтр", quantity: 3, priceCentsPerUnit: 50000 }],
    }],
  },
  $queryRaw: async () => {},
  $transaction: async operation => operation(fixtureInventory),
};
const inventoryActions = load("src/lib/ai-assistant/quick-inventory-actions.ts", {
  "node:crypto": crypto,
  "@prisma/client": { Prisma: { sql: () => null } },
  "@/lib/db": { prisma: fixtureInventory },
  "@/lib/local-inventory-admin": {
    createLocalStockDocument: async input => {
      receiptWrites.push(input);
      return { ok: true, document: { id: "created-receipt" } };
    },
    createLocalAdminProduct: async input => {
      productWrites.push(input);
      return { ok: true, product: { id: "created-product" } };
    },
    postLocalReceipt: async (id, _actor, options) => {
      postedReceiptCalls.push({ id, options });
      return { ok: true, document: { id } };
    },
  },
});
try {
  const inventoryAccess = { ...access, context: { ...access.context, userId: "user-a", branch: { status: "active" } } };
  const receipt = (await inventoryActions.prepareQuickInventory(inventoryAccess, {
    kind: "receipt", storeId: "store-a", supplierId: "supplier-a", post: true,
    lines: [{ productId: "filter", quantity: 3, unitPriceRubles: 500 }],
  })).inventory;
  assert.match(receipt.details.at(-1), /3 × 500 ₽/);
  assert.equal(receiptWrites.length, 0);
  assert.match((await inventoryActions.confirmQuickInventory({ ...inventoryAccess, branchId: "branch-b" }, receipt.token)).error, /филиал/);
  assert.equal(receiptWrites.length, 0);
  const savedReceipt = await inventoryActions.confirmQuickInventory(inventoryAccess, receipt.token);
  assert.equal(savedReceipt.posted, true);
  assert.deepEqual(await inventoryActions.confirmQuickInventory(inventoryAccess, receipt.token), savedReceipt);
  assert.equal(receiptWrites.length, 1);
  assert.equal(receiptWrites[0].positions[0].price, 500);
  const item = (await inventoryActions.prepareQuickInventory(inventoryAccess, {
    kind: "product", name: "Учебный фильтр", article: "TEST", brand: "Тест", groupPath: "Фильтры", uomName: "шт.",
  })).inventory;
  assert.equal(productWrites.length, 0);
  assert.deepEqual(await inventoryActions.confirmQuickInventory(inventoryAccess, item.token), { id: "created-product", kind: "product" });
  await inventoryActions.confirmQuickInventory(inventoryAccess, item.token);
  assert.equal(productWrites.length, 1);
  const existing = (await inventoryActions.prepareQuickExistingReceipt(inventoryAccess, "005")).inventory;
  assert.match(existing.details.at(-1), /3 × 500 ₽/);
  assert.equal(postedReceiptCalls.length, 0);
  assert.equal((await inventoryActions.confirmQuickInventory(inventoryAccess, existing.token)).posted, true);
  assert.deepEqual(postedReceiptCalls, [{ id: "draft-receipt", options: { expectedUpdatedAt: "2026-11-09T09:00:00.000Z" } }]);
} finally {
  if (priorSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = priorSessionSecret;
}
console.log("Inventory confirmations passed: preview is read-only, target branch is checked, product and receipt retries reuse the result.");
