import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url);
const trace = await jiti.import("../src/lib/save-trace.ts");
const { withSaveTrace } = await jiti.import("../src/lib/save-trace-server.ts");

function extract(path, name) {
  const source = ts.createSourceFile(path, readFileSync(new URL("../src/app/" + path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let text;
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(source) === name) {
      text = ts.isVariableDeclaration(node)
        ? "const " + name + " = " + node.initializer.arguments[0].getText(source) + ";"
        : node.getText(source);
    }
    if (!text) ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(text, name);
  return text;
}

const flows = [
  { name: "product", path: "inventory/products/ProductsClient.tsx", submit: "submit", load: "load" },
  { name: "journal", path: "records/RecordsPageClient.tsx", submit: "handleSubmitRecord", load: "loadRecords" },
  { name: "source", path: "crm/CrmPipelineClient.tsx", submit: "action", load: "load" },
];

const originalFetch = globalThis.fetch;
const originalInfo = console.info;
const lines = [];
console.info = (tag, line) => {
  if (tag === "[save-trace]") lines.push(JSON.parse(line));
  else originalInfo(tag, line);
};

try {
  for (const flow of flows) {
    const ui = {};
    const receipts = new Map();
    const writes = [];
    let dropResponse = true;
    let notificationRuns = 0;
    globalThis.fetch = async (path, options) => {
      const url = new URL(path, "http://fixture.test");
      const request = new Request(url, options);
      const operation = request.headers.get(trace.SAVE_OPERATION_HEADER);
      trace.saveTrace(request.headers, url.pathname, request.method, "proxy")("forwarded");
      if (request.method === "GET") throw new TypeError("Load failed");
      writes.push({ operation, requestId: request.headers.get(trace.SAVE_REQUEST_HEADER) });
      const payload = await request.clone().json();
      if (flow.name === "journal") assert.equal(payload.idempotencyKey, operation);
      const response = await withSaveTrace(Object.assign(request, { nextUrl: url }), async (log) => {
        if (!receipts.has(operation)) {
          receipts.set(operation, "fixture");
          if (flow.name === "journal") notificationRuns++;
          log("committed");
        } else log("reused");
        await new Promise(resolve => setTimeout(resolve, 5));
        return Response.json({ ok: true, id: "fixture", data: { id: "fixture", booking_id: "fixture" }, case: { id: "fixture" } }, { status: flow.name === "journal" ? 201 : 200 });
      });
      if (dropResponse) {
        dropResponse = false;
        throw new TypeError("Load failed");
      }
      return response;
    };

    const source = [flow.load && extract(flow.path, flow.load), extract(flow.path, flow.submit)].filter(Boolean).join("\n");
    const form = new Proxy({ serviceIds: ["1"], staffId: "1", clientName: "fixture", clientPhone: "redacted-fixture" }, { get: (target, key) => target[key] ?? "" });
    const env = {
      ...trace,
      useCallback: f => f,
      window: { dispatchEvent() {}, setTimeout, clearTimeout },
      pendingPartsSave: { current: null }, pendingProductSave: { current: null }, pendingRecordSave: { current: null },
      mutationPending: { current: false }, productSaveInFlightRef: { current: false }, recordSaveInFlight: { current: false }, loadVersion: { current: 0 },
      editingId: null, editingProduct: null, rosskoLinkLoading: false, markingTouched: false,
      validateProductForm: () => ({}), parseMoneyInput: () => 0, isMarkingEnabled: () => false, formMarkingMode: () => "",
      formBaseline: {}, form, formMode: "create", formTimeValidation: { ok: true }, normalizePhone: () => "fixture", normalizePhoneKey: () => "fixture",
      journalContactUrl: () => null, serviceById: new Map(), selectedServiceDurationSeconds: 3600, composeRecordComment: () => "",
      staff: [{ id: 1 }], canCreateJournalBooking: () => true,
      emptyVehicle: {}, companyId: "1", saveBranchId: "fixture-branch", scheduleDate: "fixture", timelineStaffId: null,
      linkedCreateDealId: null, formFromProduct: () => ({}), readJson: response => response.json(),
      reportFormError: value => { ui.formError = value; },
      search: "", sort: "", direction: "", filters: {}, resetForm() {},
      synchronizeSingleProductPublication: async () => {},
      listAbortRef: { current: null }, loadMoreAbortRef: { current: null }, loadingMoreRef: { current: false },
      PRODUCT_LIST_SLOW_MS: 5000, PRODUCT_LIST_TIMEOUT_MS: 10000, PRODUCT_LIST_ERROR: "Ошибка загрузки списка",
      buildListParams: () => new URLSearchParams({ q: "redacted-fixture" }),
    };
    for (const [, setter] of source.matchAll(/\b(set[A-Z]\w*)\(/g)) env[setter] = value => { ui[setter] = value; };
    const js = ts.transpileModule(source + "\nreturn " + flow.submit + ";", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const handler = new Function(...Object.keys(env), js)(...Object.values(env));
    const submit = () => flow.name === "source"
      ? handler({ id: "fixture" }, "waiting_parts", { source: "manual", supplier: "redacted-fixture" }, "Источник заказа сохранён", true, true)
      : handler(flow.name === "product");

    await Promise.all([submit(), submit()]);
    assert.equal(writes.length, 1, flow.name + " blocks concurrent clicks");
    assert.equal(receipts.size, 1);
    assert.equal(ui.setPartsError ?? ui.formError ?? ui.setFormError, trace.UNKNOWN_SAVE_RESULT);
    await submit();
    assert.equal(writes.length, 2);
    assert.equal(writes[0].operation, writes[1].operation, flow.name + " retries with the original key");
    assert.notEqual(writes[0].requestId, writes[1].requestId);
    assert.equal(receipts.size, 1);
    assert.equal(notificationRuns, flow.name === "journal" ? 1 : 0);
    assert.equal(ui.setNotice ?? ui.setInfo ?? ui.setError, trace.SAVED_REFRESH_FAILED);
    const operationLines = lines.filter(line => line.operationId === writes[0].operation);
    assert.ok(operationLines.some(line => line.method === "GET" && line.phase === "fetch_failed"), flow.name + " traces the failed refresh");
    const stages = operationLines.map(line => line.phase);
    for (const stage of ["send", "forwarded", "handler_enter", "committed", "fetch_failed", "reused", "response", "body_read"]) assert.ok(stages.includes(stage), stage);
  }
  assert.doesNotMatch(JSON.stringify(lines), /redacted-fixture|fixture-branch|company_id|\?action/);
  console.log("Save recovery: three forms, lost response, concurrent click, refresh failure and trace redaction passed");
} finally {
  globalThis.fetch = originalFetch;
  console.info = originalInfo;
}
