import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createJiti } from "jiti";
import { PrismaClient } from "@prisma/client";

const database = new URL(process.env.LOYALTY_TEST_DATABASE_URL);
const origin = new URL(process.env.LOYALTY_TEST_APP_URL ?? "http://127.0.0.1:3673");
const localhost = (url) => ["127.0.0.1", "localhost"].includes(url.hostname);
assert.ok(localhost(database) && database.pathname === "/eco_loyalty_api_test" && localhost(origin));
process.env.DATABASE_URL = database.toString();
process.env.SESSION_SECRET = "loyalty-isolated-test-session-secret";
const db = new PrismaClient();
const { encryptIntegrationSecret } = await createJiti(import.meta.url).import("../src/lib/messenger/messenger-crypto.ts");
const mockPayloads = [];
const mock = createServer(async (request, response) => {
  if (request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    mockPayloads.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ status: "Отложен", uid: "mock-order" }));
});
await new Promise((resolve, reject) => mock.once("error", reject).listen(0, "127.0.0.1", resolve));

const suffix = randomUUID().slice(0, 8);
const group = "test-loyalty-" + suffix;
const branchId = (key) => group + "-" + key;
const clientId = (branch, key) => branchId(branch) + "-client-" + key;
const productId = (branch, key) => branchId(branch) + "-product-" + key;
const groupId = (branch, key) => branchId(branch) + "-group-" + key;
const old = new Date(Date.now() - 346 * 86_400_000);
const today = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
const oldDate = old.toISOString().slice(0, 10);
const farExpiry = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const meta = (type, id) => ({ meta: { href: `local://${type}/${id}`, type, mediaType: "application/json" } });
const input = (branch, client, positions, extra = {}) => ({
  organization: meta("organization", branchId(branch) + "-org"),
  store: meta("store", branchId(branch) + "-store"),
  agent: client ? meta("counterparty", client) : undefined, positions, ...extra,
});
const row = (branch, product, price, quantity = 1, discount = 0) => ({
  assortment: meta(product === "work" ? "service" : "product", productId(branch, product)), price, quantity, discount,
});
class BrowserSession {
  #cookies = new Map();
  async call(path, body, { method = body ? "POST" : "GET", status = 200 } = {}) {
    const response = await fetch(new URL(path, origin), {
      method, headers: { cookie: [...this.#cookies].map((entry) => entry.join("=")).join("; "),
        ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    for (const header of response.headers.getSetCookie()) {
      const match = /^([^=]+)=([^;]*)/.exec(header);
      if (match) this.#cookies.set(match[1], match[2]);
    }
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path} ${text.slice(0, 450)}`);
    return JSON.parse(text);
  }
}
const session = async (key, branch) => {
  const s = new BrowserSession();
  await s.call("/api/auth/login", { login: "loyalty-" + key, password: "local-test-key" });
  await s.call("/api/session/active-branch", { branchId: branch === "all" ? branch : branchId(branch) });
  return s;
};
const readCard = (s, id) => s.call("/api/loyalty/clients/" + id);
const adjust = (s, branch, id, points, extra = {}, status = 200) => s.call("/api/loyalty/clients/" + id, {
  action: "adjust", branchId: branchId(branch), points, reason: "Тестовое начисление", requestKey: randomUUID(), ...extra,
}, { status });
const quote = (s, id, positions, points = 0) => s.call("/api/loyalty/quote", { counterpartyId: id, positions, points });
const post = (s, branch, id, positions, extra = {}, status = 200) =>
  s.call("/api/demands", input(branch, id, positions, { applicable: true, postingKey: randomUUID(), ...extra }), { status });
const reopen = (s, id, extra = {}, status = 200) => s.call(`/api/shipments/${id}/reopen`, {
  idempotencyKey: randomUUID(), reasonCode: "other", comment: "Контрольная отмена", ...extra,
}, { status });

try {
  await db.businessGroup.create({ data: { id: group, name: "Loyalty test", slug: group } });
  for (const key of ["g", "d"]) {
    const branch = branchId(key);
    await db.localOrganization.create({ data: { id: branch + "-org", name: key } });
    await db.branch.create({ data: { id: branch, businessGroupId: group, slug: key, name: key === "g" ? "Гагарина" : "Дачная",
      shortName: key, legacyOrganizationId: branch + "-org" } });
    await db.localStore.create({ data: { id: branch + "-store", branchId: branch, name: "Склад", organizationId: branch + "-org" } });
    for (const item of ["oil", "filter", "work"]) {
      const service = item === "work";
      await db.localCatalogGroup.create({ data: { id: groupId(key, item), branchId: branch,
        name: item === "oil" ? "Масла" : item === "filter" ? "Фильтры" : "Работы", normalizedName: item, kind: service ? "service" : "product" } });
      await db.localProduct.create({ data: { id: productId(key, item), branchId: branch, name: item,
        entityType: service ? "service" : "product", groupId: groupId(key, item), groupPath: item === "oil" ? "Масла" : null } });
      if (!service) await db.localStockBalance.create({ data: { branchId: branch, storeId: branch + "-store",
        productId: productId(key, item), quantity: 1000, available: 1000, buyPriceCents: 150 } });
    }
  }
  for (const key of ["owner", "g", "d", "manager"]) {
    const role = key === "owner" ? "owner" : key === "manager" ? "admin" : "master";
    const user = await db.user.upsert({ where: { login: "loyalty-" + key },
      create: { login: "loyalty-" + key, name: key, authRole: role }, update: { authRole: role } });
    await db.businessGroupMembership.deleteMany({ where: { userId: user.id } });
    await db.branchMembership.deleteMany({ where: { userId: user.id } });
    if (key === "owner") await db.businessGroupMembership.create({ data: { userId: user.id, businessGroupId: group, role: "group_owner" } });
    await db.branchMembership.create({ data: { branchId: branchId(key === "d" || key === "manager" ? "d" : "g"),
      userId: user.id, roleId: role === "master" ? "master" : role === "admin" ? "administrator" : "branch_owner", isDefaultBranch: true } });
  }
  const personal = async (branch, key, name, phone, extra = {}) =>
    db.localCounterparty.create({ data: { id: clientId(branch, key), branchId: branchId(branch), name, displayName: name,
      phone, normalizedPhone: phone.replace(/\D/g, ""), companyType: "individual", ...extra } });
  const a = (await personal("g", "a", "Иван Петров", "+7 911 100-00-01")).id;
  const a2 = (await personal("d", "a", "  Иван  Петров ", "8 911 100 00 01")).id;
  const family = (await personal("d", "family", "Анна Петрова", "+79111000001")).id;
  const b = (await personal("g", "b", "Михаил Иванов", "+79111000002")).id;
  const fresh = (await personal("g", "fresh", "Тест Должник", "+79111000003")).id;
  const legal = (await personal("g", "legal", "ООО Тест", "+79111000004", { companyType: "legal" })).id;
  const [ownerG, ownerD, ownerAll, masterG, masterD, manager] = await Promise.all([
    session("owner", "g"), session("owner", "d"), session("owner", "all"),
    session("g", "g"), session("d", "d"), session("manager", "d"),
  ]);

  const historic = await post(masterG, "g", a, [row("g", "work", 1000)]);
  assert.equal(await db.loyaltyOperation.count({ where: { businessGroupId: group } }), 0);
  assert.equal((await readCard(masterG, a)).status, "disabled");
  const { rules } = await ownerAll.call("/api/loyalty/settings");
  assert.equal(rules.enabled, false);
  await ownerAll.call("/api/loyalty/settings", { ...rules, enabled: true }, { method: "PUT" });
  assert.equal((await readCard(masterG, a)).status, "new");
  assert.equal((await masterG.call("/api/demands/" + historic.id)).header.sum, 100_000);
  const anonymous = await post(masterG, "g", undefined, [row("g", "work", 1000)]);
  assert.equal((await masterG.call("/api/demands/" + anonymous.id)).header.loyalty, undefined);
  const anonymousId = "system:anonymous-retail:" + branchId("g");
  const retail = await post(masterG, "g", anonymousId, [row("g", "work", 1000)]);
  assert.equal((await masterG.call("/api/demands/" + retail.id)).header.loyalty, undefined);
  assert.equal((await quote(masterG, legal, [row("g", "work", 100)])).status, "ineligible");

  await adjust(ownerG, "g", a, 3500);
  await adjust(ownerG, "g", a, 500, { expires: farExpiry });
  const positionsG = [row("g", "work", 10000)];
  const base = (await quote(masterG, a, positionsG)).quote;
  assert.deepEqual([base.balance, base.maximum, base.cashCents], [4000, 3000, 1_000_000]);
  const redeem = (await quote(masterG, a, positionsG, 3000)).quote;
  assert.deepEqual([redeem.spent, redeem.cashCents, redeem.earned], [3000, 700_000, 350]);
  const postKey = randomUUID();
  const options = { postingKey: postKey, loyalty: { points: 3000, token: redeem.token } };
  const posted = await Promise.all([post(masterG, "g", a, positionsG, options), post(masterG, "g", a, positionsG, options)]);
  assert.equal(posted[0].id, posted[1].id);
  assert.equal((await readCard(masterG, a)).balance, 1350);
  assert.equal((await quote(masterD, a2, [row("d", "work", 4000)])).status, "confirm");
  await masterD.call("/api/loyalty/clients/" + a2, { action: "confirm", branchId: branchId("d") });
  const dachnaya = await readCard(masterD, a2);
  assert.equal(dachnaya.balance, 1350);
  assert.ok(!dachnaya.history.some((entry) => entry.shipmentId === posted[0].id));
  await masterD.call("/api/demands/" + posted[0].id, undefined, { status: 404 });
  const review = await readCard(masterD, family);
  assert.equal(review.status, "review");
  assert.equal(review.candidates, undefined);
  assert.equal((await readCard(manager, family)).candidates.length, 1);
  await manager.call("/api/loyalty/clients/" + family, {
    action: "resolve", branchId: branchId("d"), separate: true, reason: "Другой член семьи",
  });
  assert.equal((await readCard(masterD, family)).balance, 0);
  await db.localCounterparty.update({ where: { id: a2 }, data: { phone: "+7 911 200-01-23", name: "Иван Другой", displayName: "Иван Другой" } });
  assert.equal((await readCard(masterD, a2)).balance, 1350);

  const positionsD = [row("d", "work", 4000)];
  const crossBranch = (await quote(masterD, a2, positionsD, 1200)).quote;
  const crossBranchSale = await post(masterD, "d", a2, positionsD, { loyalty: { points: 1200, token: crossBranch.token } });
  assert.equal((await readCard(masterG, a)).balance, 1350 - crossBranch.spent + crossBranch.earned);
  await reopen(ownerD, crossBranchSale.id);
  assert.equal((await readCard(masterG, a)).balance, 1350);
  const [qg, qd] = await Promise.all([quote(masterG, a, positionsG, 1200), quote(masterD, a2, positionsD, 1200)]);
  const race = await Promise.allSettled([
    post(masterG, "g", a, positionsG, { loyalty: { points: 1200, token: qg.quote.token } }),
    post(masterD, "d", a2, positionsD, { loyalty: { points: 1200, token: qd.quote.token } }),
  ]);
  assert.equal(race.filter((item) => item.status === "fulfilled").length, 1);
  assert.match(race.find((item) => item.status === "rejected").reason.message, /409|изменились/);
  const compensation = await Promise.allSettled([adjust(masterG, "g", a, 600, { shipmentId: posted[0].id }),
    adjust(masterG, "g", a, 600, { shipmentId: posted[0].id })]);
  assert.equal(compensation.filter((item) => item.status === "fulfilled").length, 1);
  await masterG.call("/api/loyalty/campaigns", { action: "run", id: randomUUID(), branchId: branchId("g") }, { status: 403 });
  const events = await db.loyaltyOperation.findMany({ where: { shipmentId: posted[0].id } });
  const spend = events.find((event) => event.kind === "PURCHASE_SPEND");
  const spentLot = await db.loyaltyLot.findUnique({ where: { id: spend.allocation[0].lotId } });
  assert.notEqual(spentLot.expiresAt, null);
  assert.equal(spend.allocation[0].points, 500);
  await db.loyaltyLot.update({ where: { id: spentLot.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

  await reopen(ownerG, posted[0].id);
  assert.equal(await db.loyaltyOperation.count({ where: { shipmentId: posted[0].id, kind: "RESTORATION_EXPIRED" } }), 1);
  const organization = { id: branchId("g") + "-org" };
  await db.localOrganization.update({ where: organization, data: { isActive: false } });
  const replay = await post(masterG, "g", a, positionsG, options);
  await db.localOrganization.update({ where: organization, data: { isActive: true } });
  assert.equal(replay.id, posted[0].id);
  assert.equal((await masterG.call("/api/demands/" + replay.id)).header.applicable, false);
  await ownerG.call("/api/demands/" + replay.id, {
    applicable: true, agent: meta("counterparty", b), postingKey: randomUUID(),
  }, { method: "PUT" });
  assert.equal((await readCard(ownerG, b)).balance, 500);
  assert.equal(await db.loyaltySale.count({ where: { shipmentId: replay.id } }), 2);

  await ownerAll.call("/api/loyalty/settings", {
    ...rules, enabled: true, groupRates: { [groupId("g", "oil")]: 300, [groupId("g", "filter")]: 700, [groupId("d", "oil")]: 0 },
  }, { method: "PUT" });
  await adjust(ownerG, "g", fresh, 4000);
  const mixed = [row("g", "oil", 3750, 2, 20), row("g", "filter", 2000), row("g", "work", 2000)];
  const mixQuote = (await quote(masterG, fresh, mixed, 3000)).quote;
  assert.deepEqual([mixQuote.cashCents, mixQuote.earned], [700_000, 294]);
  const noEarn = await quote(masterD, a2, [row("d", "oil", 1000)], 100);
  assert.equal(noEarn.quote.earned, 0);
  assert.ok(noEarn.quote.spent > 0);
  const mix = await post(masterG, "g", fresh, mixed, { loyalty: { points: 3000, token: mixQuote.token } });
  const detail = (await masterG.call("/api/demands/" + mix.id)).header;
  assert.deepEqual([detail.sum, detail.loyalty.earned], [700_000, 294]);

  await db.aqsiCashRegister.create({ data: { branchId: branchId("g"), businessGroupId: group, organizationId: branchId("g") + "-org",
    name: "Mock AQSI", credentialsEncrypted: encryptIntegrationSecret(JSON.stringify({ apiKey: "mock-only" })),
    settingsJson: { baseUrl: "http://127.0.0.1:" + mock.address().port, deviceId: "123", shopId: "321" } } });
  const firstReceipt = await masterG.call(`/api/demands/${mix.id}/payment`, {});
  const secondReceipt = await masterG.call(`/api/demands/${mix.id}/payment`, {});
  assert.equal(firstReceipt.fiscalizationRecordId, secondReceipt.fiscalizationRecordId);
  assert.equal(mockPayloads.length, 1);
  assert.equal(mockPayloads[0].content.positions.reduce((sum, line) => sum + Math.round(line.quantity * line.price * 100), 0), 700_000);
  assert.equal(await db.loyaltyOperation.count({ where: { shipmentId: mix.id } }), 2);
  await reopen(ownerG, mix.id, {}, 400);

  await ownerAll.call("/api/loyalty/settings", { ...rules, enabled: true, productRate: 1000 }, { method: "PUT" });
  await adjust(ownerG, "g", fresh, 1294, { remove: true });
  const oilId = detail.loyalty.lines.find((line) => line.beforeCents === 600_000).id;
  const endpoint = `/api/loyalty/returns/${mix.id}`;
  const returnRequest = { branchId: branchId("g"), receipt: "МОК-001", reason: "Тест возврата", requestKey: randomUUID(), lines: [{ id: oilId, quantityMilli: 1000 }] };
  const partial = await ownerG.call(endpoint, { ...returnRequest, preview: true });
  assert.deepEqual([partial.cashCents, partial.restored, partial.earnedReversed], [210_000, 900, 63]);
  const saved = await ownerG.call(endpoint, { ...returnRequest, token: partial.token, preview: false });
  assert.equal((await ownerG.call(endpoint, { ...returnRequest, token: partial.token, preview: false })).id, saved.id);
  await ownerG.call(endpoint, { ...returnRequest, lines: [{ id: oilId, quantityMilli: 1100 }], preview: true }, { status: 409 });
  const report = await ownerG.call(`/api/loyalty/report?from=${today}&to=${today}`);
  assert.equal(report.before - report.cash, report.spentCents);
  const remainder = {
    ...returnRequest, receipt: "МОК-002", requestKey: randomUUID(), lines: detail.loyalty.lines.map(({ id, quantityMilli }) => ({
      id, quantityMilli: quantityMilli - (id === oilId ? 1000 : 0),
    })),
  };
  const rest = await ownerG.call(endpoint, { ...remainder, preview: true });
  await ownerG.call(endpoint, { ...remainder, token: rest.token, preview: false });
  assert.deepEqual([partial.cashCents + rest.cashCents, partial.restored + rest.restored, partial.earnedReversed + rest.earnedReversed],
    [700_000, 3000, 294]);
  const net = await ownerG.call(`/api/loyalty/report?from=${today}&to=${today}`);
  assert.deepEqual([report.before - net.before, report.cash - net.cash, report.spent - net.spent, report.earned - net.earned],
    [rest.beforeCents, rest.cashCents, rest.restored, rest.earnedReversed]);

  const debtSale = await post(masterG, "g", fresh, [row("g", "work", 10000)]);
  const available = (await readCard(ownerG, fresh)).available;
  await adjust(ownerG, "g", fresh, available, { remove: true });
  await reopen(ownerG, debtSale.id);
  assert.equal((await readCard(ownerG, fresh)).balance, -500);
  await adjust(ownerG, "g", fresh, 650);
  assert.equal((await readCard(ownerG, fresh)).balance, 150);

  await db.localProduct.update({
    where: { id: productId("g", "oil") },
    data: { markingEnabled: true, markingMode: "PACKAGED_MARKED_GOOD", markingStatus: "PACKAGED_READY", uomName: "шт" },
  });
  const markedRows = [row("g", "oil", 10.02, 2, 25)];
  const markedQuote = (await quote(masterG, fresh, markedRows, 1)).quote;
  const marked = await post(masterG, "g", fresh, markedRows, { loyalty: { points: 1, token: markedQuote.token } });
  const markedLine = (await masterG.call("/api/demands/" + marked.id)).header.loyalty.lines[0].id;
  const codes = ["0104601234567890215ABCDE1234567\x1d93abcd", "0104601234567890215ABCDE1234568\x1d93abcd"];
  await masterG.call(`/api/demands/${marked.id}/payment`, { markingCodes: { [markedLine]: codes } });
  const fiscalPositions = mockPayloads.at(-1).content.positions;
  assert.equal(fiscalPositions.length, 2);
  const markedEndpoint = `/api/loyalty/returns/${marked.id}`;
  const markedRequest = { ...returnRequest, receipt: "МОК-М1", requestKey: randomUUID() };
  const { units } = await ownerG.call(markedEndpoint);
  const markedUnits = units[markedLine].sort((a, b) => b.cashCents - a.cashCents);
  assert.deepEqual(markedUnits.map(({ cashCents }) => cashCents), [702, 701]);
  assert.equal(fiscalPositions.reduce((sum, line) => sum + Math.round(line.price * 100), 0), markedQuote.cashCents);
  await ownerG.call(markedEndpoint, { ...markedRequest, lines: [{ id: markedLine, quantityMilli: 1000 }], preview: true }, { status: 409 });
  for (const [index, unit] of markedUnits.entries()) {
    const request = {
      ...markedRequest, requestKey: randomUUID(), receipt: "МОК-М" + index,
      lines: [{ id: markedLine, quantityMilli: 1000, unitKeys: [unit.key] }],
    };
    const preview = await ownerG.call(markedEndpoint, { ...request, preview: true });
    assert.equal(preview.cashCents, unit.cashCents);
    const savedReturn = await ownerG.call(markedEndpoint, { ...request, token: preview.token, preview: false });
    assert.equal((await ownerG.call(markedEndpoint, { ...request, token: preview.token, preview: false })).id, savedReturn.id);
    await ownerG.call(markedEndpoint, { ...request, preview: true }, { status: 409 });
  }
  assert.ok((await ownerG.call(markedEndpoint)).units[markedLine].every(({ returned }) => returned));

  for (let index = 0; index < 37; index++) {
    const client = await personal("g", "campaign-" + index, "Акция Клиент " + index, "+79112222" + String(index).padStart(3, "0"));
    await db.localDemand.create({ data: { branchId: branchId("g"), counterpartyId: client.id, name: "История акции",
      documentDate: oldDate, momentAt: old, applicable: true, sumCents: 95000 } });
  }
  const campaign = { action: "preview", id: randomUUID(), branchId: branchId("g"), mode: "filter", points: 50,
    filters: { tab: "review", scenario: "single_visit", search: "Акция Клиент" }, serviceDate: today, keys: [], reason: "Тест акции" };
  const recipients = await ownerG.call("/api/loyalty/campaigns", campaign);
  assert.equal(recipients.recipients, 37);
  assert.equal(recipients.total, 1850);
  const retryCampaign = { ...campaign, id: randomUUID() };
  assert.equal((await ownerG.call("/api/loyalty/campaigns", retryCampaign)).recipients, 37);
  const run = { action: "run", id: campaign.id, branchId: branchId("g") };
  const first = await ownerG.call("/api/loyalty/campaigns", run);
  assert.deepEqual([first.counts.done, first.counts.pending], [30, 7]);
  const final = await ownerG.call("/api/loyalty/campaigns", run);
  assert.equal(final.counts.done, 37);
  assert.equal(final.deliveryStatus, "unavailable");
  assert.equal((await ownerG.call("/api/loyalty/campaigns", run)).counts.done, 37);
  assert.equal(await db.loyaltyOperation.count({ where: { campaignId: campaign.id, kind: "CAMPAIGN" } }), 37);
  const retryRows = await db.loyaltyCampaignRecipient.findMany({
    where: { campaignId: retryCampaign.id }, select: { counterpartyId: true }, take: 35, orderBy: { counterpartyId: "asc" },
  });
  await db.loyaltyCampaignRecipient.updateMany({
    where: { campaignId: retryCampaign.id, counterpartyId: { in: retryRows.map(({ counterpartyId }) => counterpartyId) } },
    data: { status: "error", error: "Временная тестовая ошибка" },
  });
  const retry = { ...run, id: retryCampaign.id };
  const pending = await ownerG.call("/api/loyalty/campaigns", retry);
  assert.deepEqual([pending.counts.done, pending.counts.error], [2, 35]);
  const retryPage = await ownerG.call("/api/loyalty/campaigns", retry);
  assert.deepEqual([retryPage.counts.done, retryPage.counts.error], [32, 5]);
  assert.ok(retryPage.errorCursor);
  const retryLast = await ownerG.call("/api/loyalty/campaigns", { ...retry, errorCursor: retryPage.errorCursor });
  assert.equal(retryLast.counts.done, 37);
  assert.equal(retryLast.errorCursor, undefined);
  const all = await ownerG.call("/api/loyalty/campaigns", { ...campaign, id: randomUUID(), mode: "all" });
  assert.ok(all.skips.some((item) => item.error.includes("уже включён")));

  console.log("CRM HTTP: activation, retail, identity and roles, cross-branch race, replay, compensation, expiry, repost, group rates, mock AQSI, ordinary and marked partial returns, reports, debt and paged campaign retries: PASS");
} finally {
  mock.close();
  await db.$disconnect();
}
