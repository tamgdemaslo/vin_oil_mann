#!/usr/bin/env node
/**
 * Проверка AQSI из терминала: те же запросы и разбор, что в src/lib/aqsi.ts.
 * Запуск: node scripts/test-aqsi-orders-totals.mjs [YYYY-MM-DD]
 * По умолчанию дата — сегодня.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");

function loadEnv() {
  if (!fs.existsSync(envPath)) {
    console.error("Файл .env.local не найден");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

function sumFromPayments(payments) {
  let cash = 0,
    card = 0;
  for (const p of payments || []) {
    const amount = Number(p.amount ?? p.sum ?? p.total ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const typeNum = p.type != null ? Number(p.type) : NaN;
    if (typeNum === 0) cash += amount;
    else if (typeNum === 1) card += amount;
  }
  return { cash, card };
}

async function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const env = loadEnv();
  const apiKey = (env.AQSI_API_KEY || "").trim();
  if (!apiKey) {
    console.error("В .env.local не задан AQSI_API_KEY");
    process.exit(1);
  }
  const baseUrl = (env.AQSI_BASE_URL || "https://api.aqsi.ru/pub").trim().replace(/\/+$/, "");
  const ordersPath = (env.AQSI_ORDERS_PATH || "/v2/Receipts").trim();
  const urlBase = ordersPath.startsWith("http") ? ordersPath : `${baseUrl}${ordersPath.startsWith("/") ? ordersPath : "/" + ordersPath}`;
  const keyHeader = apiKey.startsWith("Application ") ? apiKey : `Application ${apiKey}`;

  let totalCash = 0,
    totalCard = 0;
  let page = 0,
    pagesTotal = 1;

  console.log("Дата:", date);
  console.log("URL:", urlBase);
  console.log("");

  do {
    const url = new URL(urlBase);
    url.searchParams.set("filtered.beginDate", `${date}T00:00:00`);
    url.searchParams.set("filtered.endDate", `${date}T23:59:59`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("page", String(page));

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "x-client-key": keyHeader },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Ошибка AQSI:", res.status, text.slice(0, 500));
      process.exit(1);
    }

    const data = await res.json();
    const rows = data.rows || data.items || data.data || [];
    if (data.pages != null) pagesTotal = Number(data.pages) || 1;

    for (const item of rows) {
      const payments = item.content?.checkClose?.payments || item.payments || item.paymentList || [];
      const { cash, card } = sumFromPayments(payments);
      totalCash += cash;
      totalCard += card;
    }

    console.log("Страница", page + 1, "/", pagesTotal, "— чеков:", rows.length);
    page += 1;
  } while (page < pagesTotal);

  console.log("");
  console.log("Итого за", date);
  console.log("  Наличные по заказам (cashTotal):", totalCash);
  console.log("  Карта по заказам (cardTotal):", totalCard);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
