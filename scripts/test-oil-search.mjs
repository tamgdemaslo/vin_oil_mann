#!/usr/bin/env node
/**
 * Тест поиска масел только по допуску (без VIN, без OpenAI).
 * Запуск: npm run dev, затем в другом терминале:
 *   node scripts/test-oil-search.mjs [допуск] [SAE]
 *   node scripts/test-oil-search.mjs "BMW Longlife-04" 5W-30
 *   node scripts/test-oil-search.mjs "BMW LL-04"
 * По умолчанию: approval=BMW Longlife-04, sae=5W-30
 */

const approval = process.argv[2] || "BMW Longlife-04";
const sae = process.argv[3] || "5W-30";
const BASE = process.env.LOOKUP_TEST_BASE || "http://127.0.0.1:3000";

const params = new URLSearchParams();
if (approval) params.set("approval", approval);
if (sae) params.set("sae", sae);
const url = `${BASE}/api/oil-search?${params.toString()}`;

async function main() {
  console.log("Тест поиска масел по допуску (только МойСклад)");
  console.log("  approval:", approval);
  console.log("  sae:", sae);
  console.log("  URL:", url);
  console.log("");

  const res = await fetch(url).catch((e) => {
    console.error("Ошибка запроса. Запустите сервер: npm run dev");
    console.error(e.message);
    process.exit(1);
  });

  if (!res.ok) {
    console.error("HTTP", res.status, res.statusText);
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      if (err.error) console.error("Ошибка:", err.error);
      if (err.stack) console.error(err.stack);
    } catch {
      console.error(text.slice(0, 500));
    }
    process.exit(1);
  }

  const data = await res.json();
  console.log("--- Результат ---");
  console.log("  Найдено масел:", data.count ?? 0);
  if (data.oils?.length) {
    data.oils.forEach((p, i) => {
      console.log("  ", i + 1, p.name, "|", p.price, p.currency, "| score", p.score);
    });
  }
  if (data.error) console.log("  Ошибка:", data.error);
  console.log("");
  console.log("Готово.");
}

main();
