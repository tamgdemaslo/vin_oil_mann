import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import XLSX from "xlsx";

// Real domain, crypto, tenant scope and public route; an in-memory DB and mocked
// HTTP keep this suite independent of local secrets, production and Avito.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = mkdtempSync(resolve(tmpdir(), "eco-avito-tests-"));
writeFileSync(resolve(temp, "db.mjs"), "export const prisma = globalThis.__ecoAvitoTestDb;\n");
writeFileSync(resolve(temp, "branch-api.mjs"), `
export async function requireBranchApi() { return { ok: true, context: globalThis.__ecoAvitoTestContext }; }
export function runWithBranchApiContext(context, operation) { return globalThis.__ecoAvitoTestTenant.runWithRequestTenant({ mode: 'branch', branchId: context.branchId, organizationId: context.organizationId, businessGroupId: context.businessGroupId, allowedBranchIds: [context.branchId], userId: context.userId }, operation); }
`);
const records = new Map();
const audit = [];
let products = [];
let stock = 3;
let stockFailure = false;
let branchActive = true;
let tenant;
let productReads = 0;
const branches = new Map([
  ["branch-A", { id: "branch-A", legacyOrganizationId: "org-A", name: "Дачная 6В", shortName: "Дачная", address: "Калининград, ул. Дачная, 1" }],
  ["branch-B", { id: "branch-B", legacyOrganizationId: "org-B", name: "Гагарина 116", shortName: "Гагарина", address: "Калининград, ул. Юрия Гагарина, 116" }],
  ["branch-new", { id: "branch-new", legacyOrganizationId: "org-new", name: "Новый филиал", shortName: "", address: "Калининград, ул. Тестовая, 1" }],
]);
const db = {
  integrationCredential: {
    findFirst: async ({ where }) => {
      const row = records.get(where.id);
      return row && row.branchId === where.branchId && row.organizationId === where.organizationId && row.businessGroupId === where.businessGroupId ? row : null;
    },
    findMany: async ({ where }) => [...records.values()].filter((row) => row.branchId === where.branchId && row.organizationId === where.organizationId && (row.key.startsWith("listing:") || row.key.startsWith("status:"))),
    upsert: async ({ where, create, update }) => {
      assert.equal(where.branchId, tenant.getScopedBranchId());
      const row = records.has(where.id) ? { ...records.get(where.id), ...update } : create;
      records.set(where.id, row); return row;
    },
  },
  branch: { findFirst: async ({ where }) => branchActive ? branches.get(where.id) ?? null : null },
  localProduct: {
    findMany: async ({ where }) => {
      productReads++;
      assert.equal(where.branchId, tenant.getScopedBranchId());
      return products.filter((p) => p.branchId === where.branchId && (!where.avito || p.avito) && (!where.id || where.id.in.includes(p.id)));
    },
    findFirst: async ({ where }) => products.find((p) => p.id === where.id && p.branchId === where.branchId) ?? null,
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const p of products) if (p.branchId === where.branchId && p.id === where.id && p.updatedAt.getTime() === where.updatedAt.getTime()) { p.avito = data.avito; count++; }
      return { count };
    },
  },
  localStockBalance: { findMany: async ({ where }) => {
    assert.equal(where.branchId, tenant.getScopedBranchId());
    assert.equal(where.store.branchId, where.branchId);
    if (stockFailure) throw new Error("simulated database outage");
    return products.filter((p) => p.branchId === where.branchId).map((p) => ({ productId: p.id, available: stock }));
  } },
  localProductPhoto: { count: async () => 0 },
  localStore: { findMany: async () => [] },
  integrationAuditLog: {
    create: async ({ data }) => { audit.push(data); return data; },
    findMany: async ({ where }) => audit.filter((row) => row.branchId === where.branchId).map((row) => ({ ...row, createdAt: new Date() })),
    findFirst: async ({ where }) => audit.find((row) => row.id === where.id && row.branchId === where.branchId && row.organizationId === where.organizationId && row.action === where.action) ?? null,
  },
  $transaction: async (operation) => operation(db),
};
globalThis.__ecoAvitoTestDb = db;
const jiti = createJiti(import.meta.url, { alias: { "@/lib/db": resolve(temp, "db.mjs"), "@/lib/branch-api": resolve(temp, "branch-api.mjs"), "@": resolve(root, "src") }, moduleCache: false });
try {
  const domain = await jiti.import("../src/lib/avito-autoload/domain.ts");
  const content = await jiti.import("../src/lib/avito-autoload/content.ts");
  const access = await jiti.import("../src/lib/avito-autoload/access.ts");
  const storage = await jiti.import("../src/lib/avito-autoload/storage.ts");
  const service = await jiti.import("../src/lib/avito-autoload/service.ts");
  const { AvitoAutoloadClient } = await jiti.import("../src/lib/avito-autoload/avito-client.ts");
  tenant = await jiti.import("../src/lib/request-tenant-store.ts");
  globalThis.__ecoAvitoTestTenant = tenant;
  const feedRoute = await jiti.import("../src/app/api/avito-autoload/feeds/[token]/feed.csv/route.ts");
  const apiRoute = await jiti.import("../src/app/api/avito-autoload/route.ts");
  const integrationRoute = await jiti.import("../src/app/api/integrations/avito/route.ts");
  const settings = { ...domain.AVITO_DEFAULT_SETTINGS, enabled: true, address: "Калининград, ул. Дачная, 1", publicBaseUrl: "https://crm.example.ru" };
  const source = { id: "product-A", name: "Shell Helix Ultra 5W-40 4 л", article: "550040755", groupPath: "Масла/Моторные масла", entityType: "product", brand: "Shell", sae: "5W-40", packageVolume: "4 л", acea: "A3/B4", aceaExtra: null, apiSpec: "SP", atf: null, oem: "VW 504.00/507.00", oemAtf: null, description: null, salePriceCents: 499000, archived: false, avito: true, available: 3, photos: [], updatedAt: "2026-10-13T10:00:00.000Z" };
  const scope = { branchId: "branch-A", organizationId: "org-A", businessGroupId: "group-A", userId: "user-A" };
  const listing = (changes = {}, overrides = {}, opts = settings) => domain.buildAvitoListing({ ...source, ...changes }, overrides, opts, storage.avitoAdId(scope, source.id));
  const valid = listing();
  assert.equal(valid.included, true);
  assert.equal(valid.values.multiItem, false);
  assert.equal(valid.issues.filter((i) => i.severity === "error").length, 0, "missing photos is a warning, not a publication blocker");
  assert.equal(domain.matchAvitoDictionary("motor", "Volume", "4000 мл"), "4 л");
  assert.equal(domain.matchAvitoDictionary("motor", "SAE", "5w — 40"), "5W-40");
  assert.equal(domain.matchAvitoDictionary("motor", "Brand", "Shellish"), null, "never guess a similar manufacturer");
  assert.deepEqual(domain.splitAvitoStandards("VW 504.00/507.00; MB 229.5 | MB 229.5"), ["VW 504.00/507.00", "MB 229.5"]);
  assert.equal(listing({ salePriceCents: 499099 }).included, false, "kopecks must not silently round");
  assert.equal(listing({ salePriceCents: 499099 }, { priceRubles: 5000 }).values.priceRubles, 5000);
  assert.equal(listing({}, { title: "x".repeat(51) }).included, false);
  const longName = "Моторное масло Shell Helix Ultra Professional AV-L 5W-30 5 л";
  const short = listing({ name: longName });
  assert.equal(short.values.title, "Shell Helix Ultra Professional AV-L 5W-30 5 л");
  assert.ok([...short.values.title].length <= 50);
  assert.ok(!short.issues.some((issue) => issue.field === "title" && issue.severity === "error"));
  assert.equal(short.name, longName, "automatic title never changes the product name");
  assert.equal(listing({ name: longName }, {}, { ...settings, autoShortenTitles: false }).included, false);
  assert.equal(listing({ name: longName }, { title: "Мой заголовок" }).values.title, "Мой заголовок");
  assert.equal(content.shortenAvitoTitle("😀".repeat(70), []), "😀".repeat(50), "truncate Unicode by code points");
  assert.equal(content.shortenAvitoTitle("Моторное масло ABC 5W-40", ["моторное масло"]), "Моторное масло ABC 5W-40", "short titles stay intact");
  assert.ok([...content.shortenAvitoTitle("Очень длинное название модели масла для объявления с подробностями", [])].length <= 50);
  assert.deepEqual(content.avitoTemplateIssues("{описание}", true), ["Неизвестная переменная {описание}"]);
  assert.deepEqual(content.avitoTemplateIssues("{название} {нет_такой}"), ["Неизвестная переменная {нет_такой}"]);
  assert.ok(content.avitoTemplateIssues("{название").length);
  const templatedSettings = { ...settings, titleTemplate: "{бренд} {вязкость} {объём}", descriptionTemplate: "Наш сервис\n{описание}\nЗаголовок: {заголовок}\nАдрес: {адрес}\nЦена: {цена}", categoryDescriptionTemplates: { motor: "Моторные\n{описание}\n{адрес}", transmission: "" } };
  const descriptionSource = "Описание именно этого товара {адрес}";
  const templated = listing({ description: descriptionSource }, {}, templatedSettings);
  assert.equal(templated.values.title, "Shell 5W-40 4 л");
  assert.equal(templated.values.description, `Моторные\n${descriptionSource}\n${settings.address}`, "category takes priority; product description is substituted once");
  const general = listing({ description: descriptionSource, groupPath: "Масла/Трансмиссионные масла", sae: "75W-90", apiSpec: "GL-4", oemAtf: null }, {}, templatedSettings);
  assert.ok(general.values.description.startsWith(`Наш сервис\n${descriptionSource}`));
  assert.ok(general.values.description.includes("Shell 75W-90 4 л"));
  assert.equal(listing({ description: descriptionSource }, { description: "Отдельное объявление" }, templatedSettings).values.description, "Отдельное объявление");
  assert.equal(listing({ description: "x".repeat(7400) }, {}, { ...settings, descriptionTemplate: "y".repeat(200) + "{описание}" }).included, false, "validate expanded descriptions; never silently truncate them");
  assert.equal(domain.normalizeAvitoSettings({ address: "Ранее заданный адрес" }).addressSource, "manual");
  assert.equal(domain.normalizeAvitoSettings({ address: "" }).addressSource, "branch");
  assert.equal(content.avitoBranchAddress(null, "Дачная 6В"), "Калининград, ул. Дачная, 6В");
  assert.equal(content.avitoBranchAddress(null, "Гагарина 116"), "Калининград, ул. Юрия Гагарина, 116");
  assert.equal(content.avitoBranchAddress(null, "Дачная 10"), "", "do not assign another branch address");
  assert.equal(listing({}, { description: "" }).included, false, "explicit blank does not silently inherit source");
  assert.equal(listing({ available: 1 }, {}, { ...settings, stockBuffer: 1 }).included, false);
  assert.equal(listing({ available: .2 }, {}, { ...settings, stockBuffer: .1 }).included, true, "fractional stock stays exact");
  assert.equal(listing({ uomName: "л", packageVolume: "208 л", available: 300 }).included, false, "barrel volume must never inherit the per-litre price");
  assert.equal(domain.avitoFeedStats([listing({ uomName: "л", packageVolume: "208 л", available: 3 })], settings).invalid, 1, "missing bulk offer is a validation failure, not stock withdrawal");
  assert.equal(listing({ uomName: "л", available: 4 }, { volume: "4 л", priceRubles: 4990 }).included, true);
  assert.equal(listing({ uomName: "л", available: 3.9 }, { volume: "4 л", priceRubles: 4990 }).included, false, "bulk stock must cover the advertised volume");
  assert.equal(listing({ uomName: "л", available: 4 }, { volume: "4 л", priceRubles: 4990 }, { ...settings, stockBuffer: 1 }).included, false);
  assert.equal(listing({ archived: true }).included, false);
  assert.equal(listing({ avito: false }).included, false);
  assert.equal(listing({ acea: null, apiSpec: null, oem: null }).included, false);
  const transmission = listing({ groupPath: "Масла/Трансмиссионные масла", sae: "75W-90", acea: "A3/B4", apiSpec: null, atf: null, oemAtf: null });
  assert.equal(transmission.included, false, "motor OEM/ACEA must not become transmission approvals");
  assert.equal(listing({}, { multiItem: true, multiName: "Bad group!" }).included, false);
  assert.equal(storage.avitoAdId(scope, source.id), storage.avitoAdId(scope, source.id));
  assert.notEqual(storage.avitoAdId(scope, source.id), storage.avitoAdId({ branchId: "branch-B" }, source.id));
  assert.ok(storage.avitoAdId(scope, source.id).length <= 100);
  const csv = domain.buildAvitoCsv([listing({}, { description: 'Строка, с "кавычками"\nВторая строка' })], settings, (id) => `https://crm.example.ru/${id}`);
  assert.ok(csv.startsWith("\uFEFF"));
  const table = XLSX.utils.sheet_to_json(XLSX.read(csv, { type: "string", raw: true }).Sheets.Sheet1, { header: 1 });
  assert.equal(table[1][7], 'Строка, с "кавычками"\nВторая строка');
  assert.equal(table[1][20], "VW 504.00/507.00");
  assert.equal(table[1][24], "Нет");
  assert.equal(table[1][27], "Free");
  assert.equal(domain.avitoFeedStats([valid, listing({ available: 0, brand: "Invalid" })], settings).invalid, 0, "ineligible stock rows do not block valid feed");
  assert.equal(access.canEditAvito({ groupRole: null, branchRole: "mechanic", permissions: [] }), false);
  assert.equal(access.canViewAvito({ groupRole: null, branchRole: "mechanic", permissions: [] }), true);
  assert.equal(access.canEditAvito({ groupRole: "group_owner", branchRole: null, permissions: [] }), true);
  assert.throws(() => storage.avitoScope(), /Branch context/);

  const requests = [];
  const providerProfile = { feeds_data: [{ feed_name: "Existing", feed_url: "https://other.example.ru/feed.xml" }], schedule: [{ weekdays: [1], time_slots: [9] }], allow_pay_over_limit: false, uploadMode: "full" };
  const client = new AvitoAutoloadClient("test-client-A", "test-secret-A", async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/token")) return Response.json({ access_token: "mock-token", expires_in: 3600 });
    if (init.method === "GET") return Response.json(providerProfile);
    return new Response(null, { status: 204 });
  });
  await client.connectFeed("https://crm.example.ru/feed.csv", "Eco");
  await client.upload();
  const payload = JSON.parse(requests.find((r) => r.url.endsWith("/autoload/v2/profile") && r.init.method === "POST").init.body);
  assert.deepEqual(payload.schedule, providerProfile.schedule);
  assert.equal(payload.allow_pay_over_limit, false);
  assert.equal(payload.feeds_data.length, 2, "other feed must survive connecting ours");
  assert.equal(requests.filter((r) => r.url.endsWith("/token")).length, 1);
  const pages = [];
  const paginated = new AvitoAutoloadClient("test-pages", "test-pages-secret", async (url) => {
    if (url.endsWith("/token")) return Response.json({ access_token: "page-token" });
    pages.push(url); return Response.json({ items: [{ ad_id: `p${pages.length}` }], meta: { pages: 2 } });
  });
  assert.equal((await paginated.reportItems("42")).length, 2, "honor page metadata even when provider returns short pages");
  let failedPosts = 0;
  const failed = new AvitoAutoloadClient("test-failure", "test-failure-secret", async (url) => {
    if (url.endsWith("/token")) return Response.json({ access_token: "failure-token" });
    failedPosts++; return Response.json({ error: "PRIVATE TOKEN MUST NOT BE DISPLAYED" }, { status: 429 });
  });
  await assert.rejects(failed.upload(), (e) => e.code === "AVITO_HTTP_429" && !e.message.includes("PRIVATE"));
  assert.equal(failedPosts, 1, "publication requests must never auto-retry");

  await tenant.runWithRequestTenant({ ...scope, mode: "branch", allowedBranchIds: [scope.branchId] }, async () => {
    const token = storage.newAvitoFeedToken(scope);
    const profile = { version: 1, settings, feedToken: token, connection: { status: "never", checkedAt: null, accountId: null, message: null } };
    await storage.writeAvitoValue(scope, "profile", profile);
    assert.ok(!JSON.stringify([...records.values()]).includes("Калининград"), "settings and token are encrypted at rest");
    assert.equal(await storage.withAvitoPublicProfile(token, async (_p, s) => s.branchId), "branch-A");
    const legacySettings = { ...settings, address: "" };
    delete legacySettings.addressSource; delete legacySettings.titleTemplate; delete legacySettings.titleRemovePhrases; delete legacySettings.autoShortenTitles; delete legacySettings.descriptionTemplate; delete legacySettings.categoryDescriptionTemplates;
    await storage.writeAvitoValue(scope, "profile", { ...profile, settings: legacySettings });
    assert.equal((await service.getAvitoProfile(scope)).settings.address, branches.get("branch-A").address, "legacy empty settings inherit this branch address");
    assert.equal(await storage.withAvitoPublicProfile(token, async (p) => p.settings.address), branches.get("branch-A").address, "public feed uses the same effective address as UI");
    await storage.writeAvitoValue(scope, "profile", profile);
    assert.equal(await storage.withAvitoPublicProfile(storage.newAvitoFeedToken(scope), async () => "unexpected"), null, "unregistered rotated token is rejected");
    branchActive = false;
    assert.equal(await storage.withAvitoPublicProfile(token, async () => "unexpected"), null);
    branchActive = true;
    products = [{ ...source, branchId: "branch-A", updatedAt: new Date(source.updatedAt), photos: [] }, { ...source, id: "foreign-product", branchId: "branch-B", updatedAt: new Date(source.updatedAt), photos: [] }];
    await service.saveAvitoSettings({ settings: templatedSettings });
    const templateExport = await service.generateAvitoExport();
    const templateCsv = (await service.downloadAvitoExport(templateExport.id)).toString("utf8");
    assert.ok(templateCsv.includes('"Shell 5W-40 4 л"'), "saved templates reach the actual CSV export");
    assert.ok(templateCsv.includes("Моторные\n"));
    assert.equal(products[0].name, source.name, "template saves never mutate product cards");
    const automaticTemplateFeed = await feedRoute.GET(new Request("https://crm.example.ru/feed.csv"), { params: Promise.resolve({ token }) });
    assert.equal(automaticTemplateFeed.status, 200);
    assert.ok((await automaticTemplateFeed.text()).includes("Моторные\n"), "Avito receives the same templates as manual export");
    await service.saveAvitoSettings({ settings });
    const exported = await service.generateAvitoExport();
    assert.equal(exported.stats.included, 1, "foreign branch never enters feed");
    const original = await service.downloadAvitoExport(exported.id);
    products[0].salePriceCents = 555000;
    assert.deepEqual(await service.downloadAvitoExport(exported.id), original, "history downloads the original file, not today's prices");
    const request = () => feedRoute.GET(new Request("https://crm.example.ru/feed.csv"), { params: Promise.resolve({ token }) });
    assert.equal((await request()).status, 200);
    products[0].brand = "Unsupported manufacturer";
    assert.equal((await request()).status, 503, "invalid selected ads stop feed instead of withdrawing them");
    products[0].brand = source.brand;
    stockFailure = true;
    assert.equal((await request()).status, 503, "database outage is never an empty successful feed");
    stockFailure = false; stock = 0;
    assert.equal((await request()).status, 200, "explicit stock policy can withdraw the last sold-out ad");
    stock = 3;
    await service.generateAvitoExport();
    products[0].avito = false;
    await assert.rejects(service.prepareAvitoFeed(profile, scope, false, true), (e) => e.code === "AVITO_EMPTY_FEED");
    await service.prepareAvitoFeed(profile, scope, true);
    products[0].avito = true;
    await assert.rejects(service.saveAvitoListing({ id: source.id, enabled: true, sourceUpdatedAt: "2026-10-12T00:00:00.000Z", overrides: {} }), (e) => e.code === "AVITO_PRODUCT_CHANGED");
    await assert.rejects(service.saveAvitoListing({ id: "foreign-product", enabled: true, sourceUpdatedAt: source.updatedAt, overrides: {} }), (e) => e.status === 404);
    await assert.rejects(service.saveAvitoListing({ id: source.id, enabled: true, sourceUpdatedAt: source.updatedAt, overrides: { photoIds: ["foreign-photo"] } }), /фотографии/);
    await assert.rejects(tenant.runWithRequestTenant({ ...scope, branchId: "branch-B", organizationId: "org-B", mode: "branch", allowedBranchIds: ["branch-B"] }, () => service.downloadAvitoExport(exported.id)), (e) => e.status === 404);
    globalThis.__ecoAvitoTestContext = { ...scope, groupRole: "group_owner", branchRole: null, permissions: [], isGroupOwner: true, branch: { name: "Test", shortName: "", address: "Калининград, ул. Дачная, 1", phone: "" } };
    await storage.writeAvitoValue(scope, "client_id", "api-route-test-id");
    await storage.writeAvitoValue(scope, "client_secret", "api-route-test-secret");
    const originalFetch = globalThis.fetch;
    const mockedUrls = [];
    globalThis.fetch = async (url) => {
      mockedUrls.push(url);
      if (url.endsWith("/token")) return Response.json({ access_token: "api-route-token" });
      return Response.json(url.endsWith("/self") ? { id: 12345 } : providerProfile);
    };
    const post = (body, origin = "https://crm.example.ru") => apiRoute.POST(new Request("https://crm.example.ru/api/avito-autoload", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }));
    const integrationPost = (body, origin = "https://crm.example.ru") => integrationRoute.POST(new Request("https://crm.example.ru/api/integrations/avito", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }));
    try {
      const result = await post({ operation: "api", action: "test" });
      assert.equal(result.status, 200, "outer operation and nested provider action must not overwrite each other");
      assert.equal(mockedUrls.length, 3);
      const beforeReads = productReads;
      const statusResponse = await integrationRoute.GET();
      assert.equal(statusResponse.status, 200);
      const statusText = await statusResponse.text();
      assert.equal(productReads, beforeReads, "connection settings do not need the product catalog");
      assert.ok(!statusText.includes("api-route-test-secret") && !statusText.includes("api-route-test-id"), "integration status never returns plaintext keys");
      const previousProfile = await service.getAvitoProfile(scope);
      assert.equal((await integrationPost({ operation: "settings", settings: { ...settings, titleTemplate: "{нет_такой}" } })).status, 422, "unknown placeholders cannot be saved");
      assert.equal((await integrationPost({ operation: "credentials", clientSecret: "replacement-secret" })).status, 200);
      const replacedProfile = await service.getAvitoProfile(scope);
      assert.deepEqual(replacedProfile.settings, previousProfile.settings, "changing keys preserves feed settings");
      assert.equal(replacedProfile.feedToken, previousProfile.feedToken, "changing keys preserves public URLs");
      assert.equal(replacedProfile.connection.status, "never", "new keys require a fresh check");
      assert.equal(await storage.readAvitoValue(scope, "client_id"), "api-route-test-id", "blank client id retains the saved id");
      assert.equal((await integrationPost({ operation: "api", action: "test" })).status, 200);
      const normalProvider = globalThis.fetch;
      globalThis.fetch = async (url, ...args) => {
        if (url.endsWith("/self")) {
          await service.saveAvitoCredentials({ clientSecret: "concurrently-replaced-secret" }, { branchName: "Test" });
          return Response.json({ id: 12345 });
        }
        return normalProvider(url, ...args);
      };
      assert.equal((await integrationPost({ operation: "api", action: "test" })).status, 409, "an old in-flight check cannot confirm replacement credentials");
      assert.equal((await service.getAvitoProfile(scope)).connection.status, "never");
      globalThis.fetch = normalProvider;
      assert.equal((await integrationPost({ operation: "api", action: "test" }, "https://foreign.example.ru")).status, 403);
      assert.equal((await post({ operation: "api", action: "test" }, "https://foreign.example.ru")).status, 403);
      globalThis.__ecoAvitoTestContext = { ...globalThis.__ecoAvitoTestContext, groupRole: null, branchRole: "mechanic", isGroupOwner: false };
      assert.equal((await post({ operation: "generate", allowEmpty: false })).status, 403, "reader cannot publish or mutate");
      assert.equal((await integrationRoute.GET()).status, 403, "warehouse reader cannot read integration settings");
      globalThis.__ecoAvitoTestContext = { ...globalThis.__ecoAvitoTestContext, branchRole: "administrator" };
      assert.equal((await post({ operation: "settings", settings, clientSecret: "forbidden-replacement" })).status, 403, "branch administrator cannot replace owner credentials");
      globalThis.__ecoAvitoTestContext = { ...globalThis.__ecoAvitoTestContext, permissions: ["integrations.manage"] };
      assert.equal((await integrationPost({ operation: "credentials", clientSecret: "forbidden-replacement" })).status, 403);
    } finally { globalThis.fetch = originalFetch; }
    products = Array.from({ length: 270 }, (_, i) => ({ ...source, id: `page-${i}`, name: `Товар ${i}`, branchId: "branch-A", updatedAt: new Date(source.updatedAt), groupPath: i < 260 ? source.groupPath : "Масла/Трансмиссионные масла", sae: i < 260 ? "5W-40" : "75W-90", apiSpec: i < 260 ? "SP" : "GL-4", photos: [] }));
    const filteredWorkspace = await service.getAvitoWorkspace({ branchName: "Test", canEdit: true, canEditSecrets: true, type: "transmission", view: "ready" });
    assert.equal(filteredWorkspace.total, 10, "filters apply to the full catalog before pagination");
    assert.equal(filteredWorkspace.products.length, 10);
    assert.equal((await service.getAvitoWorkspace({ branchName: "Test", canEdit: true, canEditSecrets: true, offset: 250 })).products.length, 20);
    const originalDescriptionTemplate = (await service.getAvitoProfile(scope)).settings.descriptionTemplate;
    await tenant.runWithRequestTenant({ ...scope, branchId: "branch-new", organizationId: "org-new", mode: "branch", allowedBranchIds: ["branch-new"] }, async () => {
      const newScope = storage.avitoScope();
      await assert.rejects(service.saveAvitoCredentials({ clientId: "new-only-id" }, { branchName: "Новый филиал" }), /оба поля/);
      assert.equal(await storage.readAvitoValue(newScope, "client_id"), null, "partial first credentials are never persisted");
      await service.saveAvitoCredentials({ clientId: "new-id", clientSecret: "new-secret", publicBaseUrl: "https://crm.example.ru" }, { branchName: "Новый филиал", address: "Калининград, ул. Тестовая, 1" });
      const firstProfile = await service.getAvitoProfile(newScope);
      assert.equal(firstProfile.settings.enabled, false, "connecting credentials never publishes or enables the feed");
      assert.equal(firstProfile.settings.publicBaseUrl, "https://crm.example.ru");
      assert.equal(firstProfile.settings.address, branches.get("branch-new").address);
      await service.saveAvitoSettings({ settings: { ...firstProfile.settings, descriptionTemplate: "Текст нового филиала\n{описание}\n{адрес}" } });
      assert.notEqual(originalDescriptionTemplate, (await service.getAvitoProfile(newScope)).settings.descriptionTemplate, "templates remain isolated per account/branch");
      assert.notEqual(firstProfile.feedToken, token, "a new branch gets its own feed token");
      assert.equal(await storage.readAvitoValue(scope, "client_id"), "api-route-test-id", "new branch cannot replace another branch keys");
    });
    assert.equal((await service.getAvitoProfile(scope)).settings.descriptionTemplate, originalDescriptionTemplate, "saving another branch never changes this branch template");
  });
  console.log("Avito autoload: content templates, automatic titles, branch addresses, CSV, permissions, tenant isolation, encrypted tokens, export history, feed failure guards and API contract tests passed");
} finally {
  delete globalThis.__ecoAvitoTestDb;
  delete globalThis.__ecoAvitoTestContext;
  delete globalThis.__ecoAvitoTestTenant;
  rmSync(temp, { recursive: true, force: true });
}
