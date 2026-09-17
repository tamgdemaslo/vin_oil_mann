import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import React from "react";
import { renderToString } from "react-dom/server";

const jiti = createJiti(import.meta.url, { jsx: true, alias: { "@": resolve("src") } });
const { buildClientProductContent } = await jiti.import("../src/lib/client-product-content.ts");
const { productStructuredData, serializeJsonLd } = await jiti.import("../src/lib/client-site-seo.ts");
const { default: App } = await jiti.import("../src/app/client-site/ClientSiteApp.tsx");
const card = { id: "test-oil", name: "Test oil 5W-30", brand: "Test", sae: "5W-30", packageVolume: "4 л", apiSpec: "SP", oem: "MB 229.51", offers: [
  { branchId: "one", name: "First", price: 1200, availability: "IN_STOCK" },
  { branchId: "two", name: "Second", price: null, availability: "UNKNOWN" },
] };
const content = buildClientProductContent(card);
assert.match(content.description, /5W-30/);
assert.match(content.description, /4 л/);
assert.doesNotMatch(content.description, /синтетическое|одобрено|оригинал/i);
const preserved = buildClientProductContent({ ...card, description: "Описание редактора" });
assert.ok(preserved.paragraphs.includes("Описание редактора"));
assert.equal(productStructuredData(card).offers.length, 1);
assert.equal(productStructuredData(card).offers[0].priceCurrency, "RUB");
assert.ok(!serializeJsonLd({ text: "</script><script>alert(1)</script>" }).includes("<"));
const oil = { ...card, ...content, line: "Test oil", visc: "5W-30", spec: "API SP", type: "Бензин", volume: "4 л", oem: ["MB 229.51"], note: content.description, price: 1200, stock: 3, color: "#333" };
const productHtml = renderToString(React.createElement(App, { initialPath: "/product/test-oil", initialOils: [oil] }));
assert.ok(productHtml.includes("Характеристики этой позиции"), "Product description must be in server HTML");
assert.ok(!productHtml.includes("Загружаем каталог"));
const catalogHtml = renderToString(React.createElement(App, { initialPath: "/shop", initialOils: [oil] }));
assert.ok(catalogHtml.includes("/client-site/product/test-oil"), "Product must have crawlable link in server HTML");
const isolated = renderToString(React.createElement(App, { initialPath: "/shop", initialOils: [] }));
assert.ok(!isolated.includes("/client-site/product/test-oil"), "No cross-request catalog leakage");
const home = renderToString(React.createElement(App, { initialPath: "/" }));
assert.ok(!home.includes("Открываем сайт"));
console.log("Client SEO: SSR content, request isolation, editorial copy, offers and JSON-LD escaping passed");
