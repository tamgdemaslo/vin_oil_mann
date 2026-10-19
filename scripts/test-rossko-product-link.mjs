import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { resolve } from "node:path";
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const { completeRosskoProductLinkOem, defaultGreenlightSupplier, parseRosskoProductLink, rosskoProductFromSearch } = await jiti.import("../src/lib/rossko-product-link.ts");
const guid = "NSIN0023147296";
assert.equal(parseRosskoProductLink(`https://kgd.rossko.ru/product/?sid=private-session&text=${guid}`), guid);
assert.equal(parseRosskoProductLink(`https://kgd.rossko.ru/product/?sid=x&amp;text=${guid.toLowerCase()}`), guid);
assert.equal(parseRosskoProductLink("https://msk.rossko.ru/product/?text=NSII0009734515"), "NSII0009734515");
for (const url of [
  `https://evil.ru/product/?text=${guid}`, `https://rossko.ru.evil.ru/product/?text=${guid}`,
  `https://kgd.rossko.ru@evil.ru/product/?text=${guid}`, `http://kgd.rossko.ru/product/?text=${guid}`,
  `https://user:pass@kgd.rossko.ru/product/?text=${guid}`, `https://kgd.rossko.ru:1234/product/?text=${guid}`,
  `https://kgd.rossko.ru/orders/?text=${guid}`, "https://kgd.rossko.ru/product/?text=W81180",
  `https://kgd.rossko.ru/product/?text=${guid}&text=NSIN0000000000`, "not a url", null,
]) assert.throws(() => parseRosskoProductLink(url));
const linked = { guid, brand: "MANN-FILTER", partnumber: "W 811/80", name: "Фильтр масляный",
  stocks: { stock: [{ price: "", count: 2 }, { price: "0", count: 2 }, { price: "900", count: 0 }, { price: "612,40", count: 3 }, { price: "500", count: 8 }] } };
const analogue = { guid: "NSIN0000000001", brand: "OTHER", partnumber: "OTHER", name: "Аналог", stocks: { stock: { price: "1", count: 100 } } };
const result = rosskoProductFromSearch({ PartsList: { Part: [analogue, linked] } }, guid);
assert.equal(result.article, "W 811/80");
assert.equal(result.purchasePriceCents, 61240);
assert.equal(rosskoProductFromSearch({ PartsList: { Part: linked } }, guid).brand, "MANN-FILTER");
assert.equal(rosskoProductFromSearch({ PartsList: { Part: { ...analogue, crosses: { Part: linked } } } }, guid).guid, guid);
assert.equal(rosskoProductFromSearch({ PartsList: { Part: { ...linked, stocks: null } } }, guid).purchasePriceCents, null);
assert.throws(() => rosskoProductFromSearch({ PartsList: { Part: analogue } }, guid));
assert.throws(() => rosskoProductFromSearch({ PartsList: { Part: { ...linked, brand: "" } } }, guid));
assert.throws(() => rosskoProductFromSearch({ PartsList: { Part: [linked, { ...linked, partnumber: "different" }] } }, guid));
console.log("ROSSKO product links: parsing, exact identity, singleton/array/crosses, offer prices passed");

const withCrosses = { ...linked, crosses: { Part: [
  { guid: "NSIN0000000022", partnumber: "15208-65F0A", stocks: { stock: { id: "DO-NOT-IMPORT", price: "300" } } },
  { guid: "NSIN0000000023", partnumber: "1520865F0A" },
  { ...linked },
] } };
const enriched = rosskoProductFromSearch({ PartsList: { Part: [analogue, withCrosses] } }, guid);
assert.match(enriched.oemParts, /1520865F0A/);
assert.ok(!enriched.oemParts.includes("DO-NOT-IMPORT"));
assert.ok(!enriched.oemParts.includes("OTHER"));
assert.ok(!enriched.oemParts.includes("811"));
let calls = 0;
assert.equal((await completeRosskoProductLinkOem(enriched, async () => { calls++; throw new Error(); })).oemParts, enriched.oemParts);
assert.equal(calls, 0);
const fallback = await completeRosskoProductLinkOem(result, async query => {
  assert.equal(query, linked.partnumber);
  return { PartsList: { Part: withCrosses } };
});
assert.equal(fallback.oemParts, enriched.oemParts);
assert.equal((await completeRosskoProductLinkOem(result, async () => ({ PartsList: { Part: { ...withCrosses, brand: "OTHER" } } }))).oemParts, "");
assert.ok((await completeRosskoProductLinkOem(result, async () => ({ PartsList: { Part: analogue } }))).warning);
assert.ok((await completeRosskoProductLinkOem(result, async () => { throw new Error("timeout"); })).warning);
assert.ok((await completeRosskoProductLinkOem(result, async () => ({ PartsList: { Part: linked } }))).warning);
const supplier = { id: "local-supplier", name: 'ООО «Гринлайт»', displayName: "Greenlight" };
assert.equal(defaultGreenlightSupplier([supplier, { id: "other", name: "Other", displayName: "Other" }])?.id, supplier.id);
assert.equal(defaultGreenlightSupplier([{ ...supplier, displayName: "", name: "GREEN LIGHT" }])?.id, supplier.id);
assert.equal(defaultGreenlightSupplier([{ ...supplier, displayName: "", name: "Грин лайт" }])?.id, supplier.id);
assert.equal(defaultGreenlightSupplier([{ id: "other", name: "Greenlight Logistics", displayName: "" }]), null);
assert.equal(defaultGreenlightSupplier([supplier, { ...supplier, id: "ambiguous" }]), null);
assert.equal(defaultGreenlightSupplier([]), null);
console.log("ROSSKO link OEM: exact-product crosses, deduplication, fallback and failures; Greenlight selection passed");
