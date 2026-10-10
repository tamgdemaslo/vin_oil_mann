import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import React from "react";
import { renderToString } from "react-dom/server";
import { NextRequest } from "next/server.js";

const keys = ["__NEXT_NO_MIDDLEWARE_URL_NORMALIZE", "CLIENT_SITE_ONLY", "PUBLIC_CLIENT_VIN_ORIGIN", "PUBLIC_CLIENT_SITE_HOSTS", "PUBLIC_CLIENT_SITE_ORIGIN", "PUBLIC_CLIENT_SITE_BASE_PATH", "PUBLIC_CLIENT_SITE_REDIRECT_LEGACY", "PUBLIC_BOOKING_ORIGIN", "APP_ORIGIN", "APP_IN_PROCESS_BACKGROUND_WORKERS_ENABLED"];
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
for (const key of keys) delete process.env[key];
const jiti = createJiti(import.meta.url, { jsx: true, alias: { "@": resolve("src") } });
const { proxy } = await jiti.import("../src/proxy.ts");
const domain = await jiti.import("../src/lib/client-site-domain.ts");
const { default: App } = await jiti.import("../src/app/client-site/ClientSiteApp.tsx");
const { buildBookingManagementUrl } = await jiti.import("../src/lib/booking/management-url.ts");
const { inProcessBackgroundWorkersEnabled } = await jiti.import("../src/lib/background-worker-policy.ts");

function request(path, host = "tamgdemaslo.ru", method = "GET", extra = {}) {
  return new NextRequest(`https://${host}${path}`, { method, headers: { host, ...extra } });
}

try {
  assert.equal(proxy(request("/")).headers.get("x-middleware-next"), "1", "Default CRM routing is preserved");
  assert.equal(domain.clientSiteRequestBasePath(new Headers({ host: "tamgdemaslo.ru" })), "/client-site");
  process.env.PUBLIC_CLIENT_SITE_HOSTS = "tamgdemaslo.ru,www.tamgdemaslo.ru";
  process.env.PUBLIC_CLIENT_SITE_ORIGIN = "https://tamgdemaslo.ru";
  process.env.PUBLIC_CLIENT_SITE_BASE_PATH = "";

  assert.equal(domain.clientSiteRequestBasePath(new Headers({ host: "tamgdemaslo.ru:443" })), "");
  assert.equal(domain.clientSiteRequestBasePath(new Headers({ host: "internal", "x-forwarded-host": "tamgdemaslo.ru, edge" })), "");
  assert.equal(domain.clientSiteRequestBasePath(new Headers({ host: "tamgdemaslo.ru", "x-forwarded-host": "crm" })), "", "Forwarded host cannot bypass public restrictions");
  assert.equal(domain.clientSiteRequestBasePath(new Headers({ host: "www.tamgdemaslocrm.ru" })), "/client-site");
  for (const [path, internal] of [["/", "/client-site"], ["/shop?brand=Eurol", "/client-site/shop?brand=Eurol"], ["/product/test-oil", "/client-site/product/test-oil"]]) {
    assert.equal(proxy(request(path)).headers.get("x-middleware-rewrite"), `https://tamgdemaslo.ru${internal}`);
  }
  for (const path of ["/booking", "/booking/manage/token", "/robots.txt", "/sitemap.xml", "/api/oils", "/api/public/oils/test/image/photo", "/team/ilya.webp", "/brand/logo-wordmark-light.svg", "/fonts/diagnostic/google-fonts.css"]) {
    assert.equal(proxy(request(path)).headers.get("x-middleware-next"), "1", `Public route: ${path}`);
  }
  for (const path of ["/api/auth/users", "/api/local-inventory/products", "/api/booking-admin/services", "/api/appointments", "/inventory", "/shipment", "/api/public/unapproved", "/_next/data/build/inventory.json"]) {
    assert.equal(proxy(request(path)).status, 404, `Private route blocked: ${path}`);
  }
  assert.equal(proxy(request("/api/public/booking", "tamgdemaslo.ru", "POST")).headers.get("x-middleware-next"), "1");
  assert.equal(proxy(request("/api/public/booking", "tamgdemaslo.ru", "DELETE")).status, 404);
  assert.equal(proxy(request("/shop", "tamgdemaslo.ru", "POST")).status, 404);
  for (const [legacy, target] of Object.entries(domain.CLIENT_SITE_OLD_PATHS)) {
    const response = proxy(request(`${legacy}?utm_source=test`));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), `https://tamgdemaslo.ru${target}?utm_source=test`);
  }
  assert.equal(proxy(request("/client-site/shop?brand=Eurol")).headers.get("location"), "https://tamgdemaslo.ru/shop?brand=Eurol");
  assert.equal(proxy(request("/shop?brand=Eurol", "www.tamgdemaslo.ru")).headers.get("location"), "https://tamgdemaslo.ru/shop?brand=Eurol");
  assert.equal(proxy(request("/client-site/shop", "www.tamgdemaslocrm.ru")).headers.get("x-middleware-next"), "1");
  process.env.PUBLIC_CLIENT_SITE_REDIRECT_LEGACY = "true";
  assert.equal(proxy(request("/client-site/shop?brand=Eurol", "www.tamgdemaslocrm.ru")).headers.get("location"), "https://tamgdemaslo.ru/shop?brand=Eurol");
  assert.equal(proxy(request("/inventory", "www.tamgdemaslocrm.ru")).headers.get("x-middleware-next"), "1");

  const { clientSiteUrl, pageMetadata } = await jiti.import("../src/lib/client-site-seo.ts");
  assert.equal(clientSiteUrl(), "https://tamgdemaslo.ru/");
  assert.equal(pageMetadata("/shop", "Catalog", "Oils").alternates.canonical, "https://tamgdemaslo.ru/shop");
  const oil = { id: "test-oil", name: "Test oil", brand: "Test", line: "Test", visc: "5W-30", spec: "API SP", type: "Бензин", volume: "4 л", oem: [], note: "", price: 1200, stock: 3, color: "#333", offers: [] };
  const rootHtml = renderToString(React.createElement(App, { initialPath: "/shop", initialOils: [oil], basePath: "" }));
  assert.ok(rootHtml.includes('href="/product/test-oil"'));
  assert.ok(!rootHtml.includes('href="/client-site'));
  const crmHtml = renderToString(React.createElement(App, { initialPath: "/shop", initialOils: [oil] }));
  assert.ok(crmHtml.includes('href="/client-site/product/test-oil"'), "CRM rendering remains isolated");
  process.env.APP_ORIGIN = "https://www.tamgdemaslocrm.ru";
  process.env.PUBLIC_BOOKING_ORIGIN = "https://tamgdemaslo.ru";
  assert.equal(buildBookingManagementUrl(request("/booking"), "secret-token"), "https://tamgdemaslo.ru/booking/manage/secret-token");

  process.env.APP_IN_PROCESS_BACKGROUND_WORKERS_ENABLED = "1";
  process.env.CLIENT_SITE_ONLY = "true";
  assert.equal(proxy(request("/shop", "preview.twc1.net")).headers.get("x-middleware-rewrite"), "https://preview.twc1.net/client-site/shop");
  assert.equal(proxy(request("/api/auth/login", "preview.twc1.net", "POST")).status, 404);
  process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE = "1";
  assert.equal(proxy(new NextRequest("http://127.0.0.1:3100/", { headers: { host: "tamgdemaslo.ru" } })).headers.get("x-middleware-rewrite"), "http://127.0.0.1:3100/client-site", "Internal rewrite preserves the raw server origin");
  assert.equal(inProcessBackgroundWorkersEnabled(), false, "Dedicated client app never starts CRM workers");
  process.env.PUBLIC_CLIENT_VIN_ORIGIN = "https://www.tamgdemaslocrm.ru";
  assert.equal(proxy(request("/api/vin/lookup", "preview.twc1.net", "POST")).headers.get("x-middleware-rewrite"), "https://www.tamgdemaslocrm.ru/api/vin/lookup");
  assert.equal(proxy(request("/api/public/booking", "preview.twc1.net", "POST")).headers.get("x-middleware-next"), "1", "Booking runs against the shared database");
  assert.equal(proxy(request("/api/auth/login", "preview.twc1.net", "POST")).status, 404, "Backend proxy never exposes CRM auth");
  console.log("Client domain: root routing, catalog SSR, canonical URLs, old redirects, booking links and private-route isolation passed");
} finally {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}
