import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import XLSX from "xlsx";
import sax from "sax";

function parseXml(xml) {
  const parser = sax.parser(true, { trim: false });
  const stack = [];
  let root;
  parser.onopentag = ({ name, attributes }) => {
    const node = { name, attributes, text: "", children: [] };
    if (stack.length) stack.at(-1).children.push(node); else root = node;
    stack.push(node);
  };
  parser.ontext = parser.oncdata = (text) => { if (stack.length) stack.at(-1).text += text; };
  parser.onclosetag = () => stack.pop();
  parser.onerror = (error) => { throw error; };
  parser.write(xml).close();
  return root;
}
const xmlField = (node, name) => node.children.find((child) => child.name === name);

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
const stockByProduct = new Map();
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
    return products.filter((p) => p.branchId === where.branchId).map((p) => ({ productId: p.id, available: stockByProduct.get(p.id) ?? stock }));
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
  const xmlRoute = await jiti.import("../src/app/api/avito-autoload/feeds/[token]/feed.xml/route.ts");
  const { buildAvitoXml } = await jiti.import("../src/lib/avito-autoload/xml.ts");
  const downloadRoute = await jiti.import("../src/app/api/avito-autoload/exports/[exportId]/route.ts");
  const apiRoute = await jiti.import("../src/app/api/avito-autoload/route.ts");
  const integrationRoute = await jiti.import("../src/app/api/integrations/avito/route.ts");
  const settings = { ...domain.AVITO_DEFAULT_SETTINGS, enabled: true, address: "Калининград, ул. Дачная, 1", publicBaseUrl: "https://crm.example.ru" };
  const source = { id: "product-A", name: "Shell Helix Ultra 5W-40 4 л", article: "550040755", groupPath: "Масла/Моторные масла", entityType: "product", brand: "Shell", sae: "5W-40", packageVolume: "4 л", acea: "A3/B4", aceaExtra: null, apiSpec: "SP", atf: null, oem: "VW 504.00/507.00", oemAtf: null, description: null, salePriceCents: 499000, archived: false, avito: true, available: 3, photos: [], updatedAt: "2026-10-13T10:00:00.000Z" };
  const scope = { branchId: "branch-A", organizationId: "org-A", businessGroupId: "group-A", userId: "user-A" };
  const listing = (changes = {}, overrides = {}, opts = settings) => domain.buildAvitoListing({ ...source, ...changes }, overrides, opts, storage.avitoAdId(scope, source.id));
  const valid = listing();
  assert.equal(valid.included, true);
  assert.equal(valid.values.multiItem, false);
  for (const groupPath of ["Масляные фильтры АКПП", "Фильтры и поддоны АКПП / CVT", "Топливные фильтры", "Масла/Фильтры/АКПП", "Уплотнительные кольца и прокладки", "Тормозная жидкость", "АКПП"]) {
    assert.equal(domain.inferAvitoOilType({ ...source, groupPath, groupCode: "TRANSMISSION_FLUID" }), null, `non-oil group must not become transmission fluid: ${groupPath}`);
    assert.equal(listing({ groupPath, avito: true }, { type: "transmission" }).included, false, "neither Avito selection nor an old category override changes membership");
  }
  for (const groupPath of ["Масло в канистрах моторное/Масло в канистрах моторное", "Масло моторное в бочках на розлив", "Масла/Трансмиссионные масла/Моторные масла"]) assert.equal(domain.inferAvitoOilType({ ...source, groupPath }), "motor");
  for (const groupPath of ["Масло в канистрах трансмисионное", "Масло трансмиссионное в бочках на розлив", "Масла/АКПП и CVT", "ATF", "CVT Fluid"]) assert.equal(domain.inferAvitoOilType({ ...source, groupPath }), "transmission");
  assert.equal(domain.inferAvitoOilType({ ...source, group: { id: "filter-group", name: "Масляные фильтры АКПП", kind: "product" } }), null, "linked catalog group wins over stale groupPath");
  assert.equal(domain.inferAvitoOilType({ ...source, groupPath: "Масляные фильтры АКПП", group: { id: "oil-group", name: "Моторные масла", kind: "product" } }), "motor");
  assert.equal(domain.inferAvitoOilType({ ...source, group: { id: "service-group", name: "Моторные масла", kind: "service" } }), null);
  assert.equal(listing({}, { type: "transmission" }).type, "motor", "actual group determines the Avito category");
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
  const special = listing({ photos: [{ id: "photo&1", url: "", name: "Фото", contentType: "image/jpeg", size: 1 }] }, { title: 'Масло & <Shell> "4 л"', description: 'Текст & <html> ]]>\nМасло 🛢', acea: "A3/B4; C3", oem: "VW 504.00/507.00; MB 229.5", multiItem: true, multiName: "Shell4L" });
  assert.equal(special.included, true);
  const transmissionXmlListing = listing({ groupPath: "Трансмиссионные масла", sae: "75W-90", atf: "Dexron III", apiSpec: "GL-4", oemAtf: "ZF TE-ML 14C" });
  transmissionXmlListing.adId = storage.avitoAdId(scope, "transmission-A");
  const xml = buildAvitoXml([special, transmissionXmlListing, listing({ brand: "Bad" })], settings, (id) => `https://crm.example.ru/${id}?size=1&v=2`);
  const xmlRoot = parseXml(xml);
  assert.equal(xmlRoot.name, "Ads");
  assert.deepEqual(xmlRoot.attributes, { formatVersion: "3", target: "Avito.ru" });
  assert.equal(xmlRoot.children.length, 2, "invalid listings are also skipped in XML");
  const [motorAd, transmissionAd] = xmlRoot.children;
  assert.equal(xmlField(motorAd, "Id").text, table[1][0], "XML preserves the CSV identifier");
  assert.equal(xmlField(motorAd, "Title").text, special.values.title);
  assert.equal(xmlField(motorAd, "Description").text, special.values.description, "CDATA boundaries, markup and Unicode survive XML parsing");
  assert.deepEqual(xmlField(motorAd, "ACEA").children.map((child) => child.text), ["A3/B4", "C3"]);
  assert.equal(xmlField(motorAd, "OEMOil").children[0].text, "VW 504.00/507.00");
  assert.equal(xmlField(motorAd, "VendorCode").text, source.article);
  assert.equal(xmlField(motorAd, "MultiName").text, "Shell4L");
  assert.equal(xmlField(motorAd, "Images").children[0].attributes.url, "https://crm.example.ru/photo&1?size=1&v=2");
  assert.equal(xmlField(transmissionAd, "ACEA"), undefined);
  assert.equal(xmlField(transmissionAd, "ATF").children[0].text, "Dexron III");
  const addressAd = parseXml(buildAvitoXml([valid], { ...settings, sellerAddressId: "123" }, () => "")).children[0];
  assert.equal(xmlField(addressAd, "SellerAddressID").text, "123");
  assert.equal(xmlField(addressAd, "Address"), undefined);
  assert.throws(() => buildAvitoXml([valid, valid], settings, () => ""), /уникальный/);
  assert.throws(() => buildAvitoXml([{ ...valid, adId: "" }], settings, () => ""), /непустой/);
  for (const description of ["Bad\u0001text", "Bad\uD800text"]) assert.equal(listing({}, { description }).included, false, "invalid XML characters are listing errors, not whole-feed failures");
  assert.equal(domain.avitoFeedStats([valid, listing({ available: 0, brand: "Invalid" })], settings).invalid, 0, "ineligible stock rows do not block valid feed");
  assert.equal(access.canEditAvito({ groupRole: null, branchRole: "mechanic", permissions: [] }), false);
  assert.equal(access.canViewAvito({ groupRole: null, branchRole: "mechanic", permissions: [] }), true);
  assert.equal(access.canEditAvito({ groupRole: "group_owner", branchRole: null, permissions: [] }), true);
  assert.throws(() => storage.avitoScope(), /Branch context/);

  const requests = [];
  const providerProfile = { feeds_data: [{ feed_name: "Existing", feed_url: "https://other.example.ru/feed.xml" }, { feed_name: "Manually added", feed_url: "https://crm.example.ru/feed.csv" }], schedule: [{ weekdays: [1], time_slots: [9] }], allow_pay_over_limit: false, uploadMode: "full" };
  const client = new AvitoAutoloadClient("test-client-A", "test-secret-A", async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/token")) return Response.json({ access_token: "mock-token", expires_in: 3600 });
    if (init.method === "GET") return Response.json(providerProfile);
    return new Response(null, { status: 204 });
  });
  await client.connectFeed("https://crm.example.ru/feed.xml", "Eco", "https://crm.example.ru/feed.csv");
  await client.upload();
  const payload = JSON.parse(requests.find((r) => r.url.endsWith("/autoload/v2/profile") && r.init.method === "POST").init.body);
  assert.deepEqual(payload.schedule, providerProfile.schedule);
  assert.equal(payload.allow_pay_over_limit, false);
  assert.equal(payload.feeds_data.length, 2, "other feed must survive connecting ours");
  assert.ok(!payload.feeds_data.some((feed) => feed.feed_url.endsWith(".csv")), "the same branch's old CSV is replaced even if manually named");
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
    const publicGet = () => feedRoute.GET(new Request("https://crm.example.ru/feed.csv"), { params: Promise.resolve({ token }) });
    const publicHead = () => feedRoute.HEAD(new Request("https://crm.example.ru/feed.csv", { method: "HEAD" }), { params: Promise.resolve({ token }) });
    const publicXml = () => xmlRoute.GET(new Request("https://crm.example.ru/feed.xml"), { params: Promise.resolve({ token }) });
    const publicXmlHead = () => xmlRoute.HEAD(new Request("https://crm.example.ru/feed.xml", { method: "HEAD" }), { params: Promise.resolve({ token }) });
    assert.ok(service.avitoFeedUrl(profile).endsWith("/feed.xml"));
    assert.ok(service.avitoFeedUrl(profile, "csv").endsWith("/feed.csv"));
    assert.equal((await publicXml()).headers.get("X-Avito-Feed-Status"), "AVITO_FEED_NOT_REVIEWED");
    const notReviewed = await publicGet();
    assert.equal(notReviewed.status, 503, "a public link alone cannot publish an unreviewed first feed");
    assert.equal(notReviewed.headers.get("X-Avito-Feed-Status"), "AVITO_FEED_NOT_REVIEWED");
    assert.match(await notReviewed.text(), /Первый файл ещё не сформирован/);
    assert.equal((await publicHead()).headers.get("X-Avito-Feed-Status"), "AVITO_FEED_NOT_REVIEWED");
    await storage.writeAvitoValue(scope, "profile", { ...profile, settings: { ...settings, enabled: false } });
    const paused = await publicGet();
    assert.equal(paused.status, 503);
    assert.match(paused.headers.get("Content-Type"), /^text\/plain/);
    assert.equal(paused.headers.get("X-Avito-Feed-Status"), "AVITO_FEED_PAUSED", "paused and missing-review causes are distinct");
    assert.match(await paused.text(), /Включите «Разрешить автовыгрузку по ссылке»/);
    assert.equal(audit.at(-1).metadataJson.errorCode, "AVITO_FEED_PAUSED", "authenticated history retains the exact blocked-download reason");
    const pausedHead = await publicHead();
    assert.equal(pausedHead.status, 503);
    assert.equal(pausedHead.headers.get("X-Avito-Feed-Status"), "AVITO_FEED_PAUSED");
    assert.equal(await pausedHead.text(), "");
    assert.equal((await publicXmlHead()).headers.get("X-Avito-Feed-Status"), "AVITO_FEED_PAUSED");
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
    products = [{ ...source, branchId: "branch-A", updatedAt: new Date(source.updatedAt), photos: [] }, { ...source, id: "foreign-product", branchId: "branch-B", updatedAt: new Date(source.updatedAt), photos: [] }, { ...source, id: "filter-A", name: "Фильтр масляный АКПП Dencerman A220042", branchId: "branch-A", group: { id: "filter-group", name: "Масляные фильтры АКПП", kind: "product" }, updatedAt: new Date(source.updatedAt), photos: [] }];
    await assert.rejects(service.saveAvitoListing({ id: "filter-A", enabled: true, sourceUpdatedAt: source.updatedAt, overrides: { type: "transmission" } }), /групп/);
    products.push({ ...products[0], id: "bad-selected", brand: "Unsupported manufacturer" });
    products[0].brand = "Unsupported manufacturer";
    await assert.rejects(service.generateAvitoExport(), (error) => error.code === "AVITO_EMPTY_FEED" && error.details.stats.included === 0, "an entirely invalid first selection cannot create a header-only feed");
    assert.equal(await storage.readAvitoValue(scope, "snapshot"), null);
    products[0].brand = source.brand;
    await service.saveAvitoSettings({ settings: templatedSettings });
    const templateExport = await service.generateAvitoExport();
    assert.equal(templateExport.stats.included, 1, "the first export is allowed when valid and invalid selected oils are mixed");
    assert.equal(templateExport.stats.invalid, 1);
    const templateCsv = (await service.downloadAvitoExport(templateExport.id)).toString("utf8");
    assert.ok(templateCsv.includes('"Shell 5W-40 4 л"'), "saved templates reach the actual CSV export");
    assert.ok(templateCsv.includes("Моторные\n"));
    assert.ok(!templateCsv.includes("Dencerman"), "unsupported selected groups never enter the oil CSV");
    assert.ok(!templateCsv.includes(storage.avitoAdId(scope, "bad-selected")), "invalid selected oils never enter the first CSV");
    assert.equal(products.at(-1).avito, true, "skipping a bad listing preserves its Avito selection");
    assert.equal(products[0].name, source.name, "template saves never mutate product cards");
    const automaticTemplateFeed = await feedRoute.GET(new Request("https://crm.example.ru/feed.csv"), { params: Promise.resolve({ token }) });
    assert.equal(automaticTemplateFeed.status, 200);
    assert.equal(automaticTemplateFeed.headers.get("X-Avito-Skipped-Invalid"), "1");
    assert.ok((await automaticTemplateFeed.text()).includes("Моторные\n"), "Avito receives the same templates as manual export");
    products.pop();
    await service.saveAvitoSettings({ settings });
    const exported = await service.generateAvitoExport();
    assert.equal(exported.stats.included, 1, "foreign branch never enters feed");
    const original = await service.downloadAvitoExport(exported.id);
    const originalXml = await service.downloadAvitoExport(exported.id, "xml");
    assert.equal(xmlField(parseXml(originalXml.toString("utf8")).children[0], "Id").text, storage.avitoAdId(scope, source.id));
    products[0].salePriceCents = 555000;
    assert.deepEqual(await service.downloadAvitoExport(exported.id), original, "history downloads the original file, not today's prices");
    assert.deepEqual(await service.downloadAvitoExport(exported.id, "xml"), originalXml, "XML history is also immutable");
    audit.push({ ...audit.find((row) => row.id === exported.id), id: "legacy-csv", metadataJson: { csvGzip: audit.find((row) => row.id === exported.id).metadataJson.csvGzip } });
    assert.deepEqual(await service.downloadAvitoExport("legacy-csv"), original);
    await assert.rejects(service.downloadAvitoExport("legacy-csv", "xml"), (error) => error.status === 404 && /старой выгрузке/.test(error.message));
    const request = () => feedRoute.GET(new Request("https://crm.example.ru/feed.csv"), { params: Promise.resolve({ token }) });
    assert.equal((await request()).status, 200);
    const snapshotBeforeHead = await storage.readAvitoValue(scope, "snapshot");
    const auditCountBeforeHead = audit.length;
    const readyHead = await publicHead();
    assert.equal(readyHead.status, 200);
    assert.equal(readyHead.headers.get("X-Avito-Feed-Status"), "ready");
    assert.equal(await readyHead.text(), "");
    assert.deepEqual(await storage.readAvitoValue(scope, "snapshot"), snapshotBeforeHead, "HEAD never modifies the reviewed/exported snapshot");
    assert.equal(audit.length, auditCountBeforeHead, "HEAD does not pretend that Avito downloaded a CSV");
    assert.equal((await publicXmlHead()).status, 200);
    assert.equal(audit.length, auditCountBeforeHead, "XML HEAD never writes audit or snapshots");
    products[0].brand = "Unsupported manufacturer";
    const invalidFeed = await request();
    assert.equal(invalidFeed.status, 503, "an entirely invalid selection cannot silently replace a nonempty feed with an empty CSV");
    assert.equal(invalidFeed.headers.get("X-Avito-Feed-Status"), "AVITO_EMPTY_FEED");
    assert.match(await invalidFeed.text(), /Файл станет пустым/);
    assert.equal((await publicHead()).status, 503, "HEAD observes the same empty-feed protection as GET");
    assert.equal((await publicXml()).status, 503);
    products.push({ ...products[0], id: "healthy-selected", brand: source.brand });
    const mixed = await service.prepareAvitoFeed(profile, scope, false, true);
    assert.equal(mixed.stats.included, 1);
    assert.equal(mixed.stats.invalid, 1);
    assert.equal(mixed.stats.warnings, 1, "warnings count only exported listings, not skipped ones");
    assert.equal(mixed.stats.withdrawals, 1, "a previously exported bad listing is absent from the new feed");
    assert.deepEqual(mixed.snapshot.productIds, ["healthy-selected"]);
    assert.ok(!mixed.csv.includes(storage.avitoAdId(scope, source.id)));
    const mixedExport = await service.generateAvitoExport();
    assert.equal(mixedExport.stats.invalid, 1);
    const mixedCsv = (await service.downloadAvitoExport(mixedExport.id)).toString("utf8");
    const mixedPublic = await request();
    assert.equal(mixedPublic.status, 200, "a bad selected item cannot block healthy items in the public feed");
    assert.equal(mixedPublic.headers.get("X-Avito-Feed-Policy"), "skip-invalid");
    assert.equal(mixedPublic.headers.get("X-Avito-Skipped-Invalid"), "1");
    assert.deepEqual(Buffer.from(await mixedPublic.arrayBuffer()), Buffer.from(mixedCsv, "utf8"), "manual and automatic exports contain exactly the same CSV bytes, including BOM");
    assert.equal((await publicHead()).status, 200);
    assert.equal(audit.at(-1).metadataJson.stats.invalid, 1, "download history reports skipped items");
    assert.equal(products[0].avito, true);
    assert.equal(products[0].brand, "Unsupported manufacturer", "export must not edit bad product data");
    const mixedXmlResponse = await publicXml();
    assert.equal(mixedXmlResponse.status, 200);
    assert.match(mixedXmlResponse.headers.get("Content-Type"), /^application\/xml/);
    assert.equal(mixedXmlResponse.headers.get("X-Avito-Skipped-Invalid"), "1");
    assert.equal(await mixedXmlResponse.text(), (await service.downloadAvitoExport(mixedExport.id, "xml")).toString("utf8"));
    assert.equal((await xmlRoute.GET(new Request("https://crm.example.ru/feed.xml"), { params: Promise.resolve({ token: "invalid" }) })).status, 404);
    products.pop();
    products[0].brand = source.brand;
    const repaired = await service.prepareAvitoFeed(profile, scope, false, true);
    assert.equal(repaired.stats.invalid, 0);
    assert.deepEqual(repaired.snapshot.productIds, [source.id], "a repaired selected product automatically re-enters the next feed");
    await service.generateAvitoExport();
    stockFailure = true;
    const unavailable = await request();
    assert.equal(unavailable.status, 503, "database outage is never an empty successful feed");
    assert.equal(unavailable.headers.get("X-Avito-Feed-Status"), "AVITO_FEED_UNAVAILABLE");
    assert.ok(!(await unavailable.text()).includes("simulated database outage"), "public diagnostics never expose internal exception text");
    assert.equal((await publicHead()).status, 503);
    assert.equal((await publicXml()).headers.get("X-Avito-Feed-Status"), "AVITO_FEED_UNAVAILABLE");
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
    await assert.rejects(tenant.runWithRequestTenant({ ...scope, branchId: "branch-B", organizationId: "org-B", mode: "branch", allowedBranchIds: ["branch-B"] }, () => service.downloadAvitoExport(exported.id, "xml")), (e) => e.status === 404);
    globalThis.__ecoAvitoTestContext = { ...scope, groupRole: "group_owner", branchRole: null, permissions: [], isGroupOwner: true, branch: { name: "Test", shortName: "", address: "Калининград, ул. Дачная, 1", phone: "" } };
    const xmlDownload = await downloadRoute.GET(new Request(`https://crm.example.ru${exported.xmlDownloadUrl}`), { params: Promise.resolve({ exportId: exported.id }) });
    assert.equal(xmlDownload.status, 200);
    assert.match(xmlDownload.headers.get("Content-Type"), /^application\/xml/);
    assert.match(xmlDownload.headers.get("Content-Disposition"), /\.xml"$/);
    assert.deepEqual(Buffer.from(await xmlDownload.arrayBuffer()), originalXml);
    assert.equal((await downloadRoute.GET(new Request("https://crm.example.ru/download?format=bad"), { params: Promise.resolve({ exportId: exported.id }) })).status, 400);
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
      products.push({ ...products[0], id: "api-invalid-selected", brand: "Unsupported manufacturer" });
      const mixedApiExport = await post({ operation: "generate" });
      assert.equal(mixedApiExport.status, 200, "the real export API allows a mixed selection");
      const mixedApiResult = await mixedApiExport.json();
      assert.equal(mixedApiResult.stats.included, 1);
      assert.equal(mixedApiResult.stats.invalid, 1);
      products.pop();
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
    for (let i = 0; i < products.length; i++) {
      products[i].salePriceCents = (i + 1) * 10000;
      products[i].photos = i < 260 ? [{ id: `photo-${i}`, fileName: "Avito.jpg", contentType: "image/jpeg", sizeBytes: 500 }] : [];
    }
    products[0].avito = false;
    products[268].brand = "Unsupported manufacturer";
    products[269].brand = "Unsupported manufacturer"; products[269].sae = "Wrong SAE";
    stockByProduct.set("page-268", 7); stockByProduct.set("page-2", -1);
    await storage.writeAvitoValue(scope, "listing:page-259", { photoIds: [] });
    const workspace = (extra = {}) => service.getAvitoWorkspace({ branchName: "Test", canEdit: true, canEditSecrets: true, ...extra });
    assert.equal((await workspace()).total, 270, "unselected oils remain in their actual group");
    const photoMissing = await workspace({ photos: "without" });
    assert.equal(photoMissing.total, 11, "photo filtering sees beyond the first 250 products and honors chosen photos");
    assert.ok(photoMissing.products.every((item) => item.photos.length === 0));
    assert.equal((await workspace({ photos: "with" })).total, 259);
    const combined = await workspace({ type: "transmission", view: "errors", photos: "without" });
    assert.equal(combined.total, 2, "error, oil category and photo filters combine");
    assert.equal((await workspace({ sort: "errors_first" })).products[0].id, "page-269", "errors on later pages sort to the front");
    assert.equal((await workspace({ sort: "no_photos_first" })).products[0].id, "page-259");
    assert.equal((await workspace({ sort: "ready_first" })).products[0].included, true);
    assert.equal((await workspace({ sort: "price_desc" })).products[0].id, "page-269");
    assert.equal((await workspace({ sort: "price_asc" })).products[0].id, "page-0");
    assert.equal((await workspace({ sort: "stock_desc" })).products[0].id, "page-268");
    assert.equal((await workspace({ sort: "stock_asc" })).products[0].id, "page-2");
    assert.equal((await workspace({ sort: "name_desc" })).products[0].id, "page-269");
    assert.equal((await workspace({ sort: "name_asc" })).products[2].id, "page-2", "names use numeric Russian collation");
    const descendingNext = await workspace({ sort: "price_desc", offset: 250 });
    assert.equal(descendingNext.products[0].id, "page-19", "pagination applies after sorting the complete catalog");
    const realGroups = (await workspace()).groups;
    assert.equal(realGroups.length, 2);
    assert.equal((await workspace({ group: realGroups.find((item) => item.type === "transmission").key })).total, 10);
    assert.equal((await workspace({ group: "id:foreign-branch-group" })).total, 0);
    const apiFiltered = await apiRoute.GET(new Request("https://crm.example.ru/api/avito-autoload?photos=without&view=errors&sort=errors_first&type=transmission"));
    assert.equal(apiFiltered.status, 200);
    const apiFilteredData = await apiFiltered.json();
    assert.equal(apiFilteredData.total, 2); assert.equal(apiFilteredData.products[0].id, "page-269", "HTTP route forwards photo filtering and sort order");
    stockByProduct.clear();
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
  console.log("Avito autoload: catalog groups, whole-catalog sorting and filters, content templates, automatic titles, branch addresses, XML v3 and CSV, permissions, tenant isolation, encrypted tokens, export history, feed failure guards and API contract tests passed");
} finally {
  delete globalThis.__ecoAvitoTestDb;
  delete globalThis.__ecoAvitoTestContext;
  delete globalThis.__ecoAvitoTestTenant;
  rmSync(temp, { recursive: true, force: true });
}
