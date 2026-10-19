import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { parseRosskoProductLink, rosskoProductFromSearch } = await jiti.import("../src/lib/rossko-product-link.ts");
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
