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

const { uniqueQuickOption } = load("src/lib/quick-assistant.ts");
const { journalId } = load("src/lib/booking/journal-id.ts");
const masters = [{ name: "Семён", id: 1 }, { name: "Алексей", id: 2 }];
assert.equal(uniqueQuickOption(" семен ", masters)?.id, 1);
assert.equal(uniqueQuickOption("Алексей", [...masters, { name: "Алексей", id: 3 }]), undefined);
assert.equal(uniqueQuickOption("", masters), undefined);

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
let queries = 0;
let modelResult = { kind: "task", customerName: "Тестовый Клиент", title: "Уточнить наличие фильтра" };
const auth = {
  requireAIAssistantAccess: async () => signedIn ? access : { response: NextResponse.json({}, { status: 401 }) },
  runWithAIAssistantBranchContext: (current, operation) => {
    assert.equal(current, access);
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
const { POST } = load("src/app/api/ai-assistant/quick-command/route.ts", {
  "next/server": { NextResponse },
  "@/lib/ai-assistant/access": auth,
  "@/lib/ai-assistant/quick-shipment": shipmentModule,
  "@/lib/ai-assistant/quick-crm": crmModule,
  "@/lib/ai-assistant/quick-maintenance-quote": { quickMaintenanceQuote: async (current, input) => {
    assert.equal(current, access);
    assert.deepEqual(input, { vin: "JTDBR32E720012345", viscosities: ["5W-30", "5W-40"], filterTypes: ["oil", "air", "cabin"], warehouse: "" });
    return { text: "Расчёт ТО: 5W-30 и 5W-40 с работой", sources: [] };
  } },
  "@/lib/ai-assistant/tariff-context": { assistantTariffContext: async () => ({ locationId: "test" }) },
  "@/lib/ai-assistant/labor-pricing": { resolveLaborPrice: async () => ({ laborPriceCents: 0, requiresHumanConfirmation: false }) },
  "@/lib/ai-assistant/quick-catalog": { searchQuickCatalog: async input => {
    assert.deepEqual(input, { query: "", approval: "C2", viscosity: "", liters: 6 });
    return { total: 1, products: [{ id: "oil-a", name: "Тестовое масло C2", neededUnits: 2, purchasedLiters: 8 }] };
  } },
  "@/lib/ai-assistant/quick-vehicle": { answerQuickVehicle: async (current, question, system) => {
    assert.equal(current, access);
    assert.equal(question, "Тестовая команда");
    assert.equal(system, "engine_oil");
    return { text: "Проверенный допуск", sources: [] };
  } },
  "@/lib/booking/access": { canManageBookings: () => canBook },
  "@/lib/booking/constants": { BOOKING_MASTER_ROLE_ID: "master" },
  "@/lib/booking/journal-id": { journalId },
  "@/lib/booking/journal-time": { utcInstantToJournalLocal: () => "2026-11-09T11:00" },
  "@/lib/db": { prisma: {
    localCounterparty: { findMany: async ({ where }) => {
      queries++;
      assert.equal(where.branchId, "branch-a");
      return [{ name: "Тестовый Клиент", normalizedPhone: "79990000000" }];
    } },
    bookingService: { findMany: async ({ where }) => {
      assert.equal(where.branchId, "branch-a");
      return [{ id: "service-1", name: "Диагностика", masters: [{ membershipId: "membership-1" }] }];
    } },
    branchMembership: { findMany: async ({ where }) => {
      assert.equal(where.branchId, "branch-a");
      return [{ id: "membership-1", user: { name: "Мастер" } }];
    } },
  } },
  "@/lib/openai-client": { createOpenAIClient: () => ({
    responses: { create: async request => {
      modelCalls++;
      assert.equal(request.model, "gpt-5-nano");
      assert.equal(request.store, false);
      assert.ok(request.tools.some(tool => tool.name === "search_stock"));
      assert.match(request.instructions, /2026-11-09T11:00/);
      const output = request.input.findLast(item => item.type === "function_call_output");
      if (output) {
        const facts = JSON.parse(output.output);
        if (modelResult.kind === "vehicle") assert.equal(facts, "Проверенный допуск");
        if (modelResult.kind === "stock") assert.equal(facts.products[0].purchasedLiters, 8);
        if (modelResult.kind === "crm") {
          assert.equal(facts.matchingCases, 1);
          assert.equal(facts.cases[0].nextAction, "Уточнить наличие");
          assert.equal(facts.cases[0].linkedShipment.status, "Проведена");
          assert.equal(facts.upcomingBookings[0].confirmation, "CONFIRMED");
        }
        const answers = { vehicle: "Проверенный допуск", stock: "Есть масло C2. Две упаковки дадут 8 л.", crm: "В CRM есть дело по подбору фильтра." };
        return { output: [], output_text: answers[modelResult.kind] };
      }
      if (modelResult.kind === "unsupported") return { output: [], output_text: "Уточните, пожалуйста, что проверить." };
      if (modelResult.kind === "stock") {
        assert.match(request.input.at(-1).content, /6 литров/);
        assert.match(request.input[0].content, /C2/);
      }
      const name = { vehicle: "read_vehicle", crm: "read_crm", stock: "search_stock", maintenance: "calculate_maintenance_quote" }[modelResult.kind] ?? "prepare_draft";
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
assert.deepEqual(booking.options.services[0].masterIds, [booking.options.masters[0].id]);
assert.equal(booking.branch.id, "branch-a");

modelResult = { kind: "vehicle", system: "engine_oil" };
assert.equal((await (await POST(request())).json()).answer.text, "Проверенный допуск");

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
assert.match(stockAnswer.text, /8 л/);
assert.equal(stockAnswer.sources[0].href, "/inventory/products?product=oil-a");

modelResult = { kind: "maintenance", vin: "JTDBR32E720012345", viscosities: ["5W-30", "5W-40"], filterTypes: ["oil", "air", "cabin"], warehouse: "" };
assert.match((await (await POST(request())).json()).answer.text, /5W-30 и 5W-40 с работой/);

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
let lookups = 0;
const { answerQuickVehicle } = load("src/lib/ai-assistant/quick-vehicle.ts", {
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
