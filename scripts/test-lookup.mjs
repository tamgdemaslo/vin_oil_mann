#!/usr/bin/env node
/**
 * Тест подбора по VIN (POST /api/lookup): Parts Catalogs + OpenAI допуск/объём + поиск в МойСклад.
 * Запуск: сначала npm run dev, затем в другом терминале:
 *   node scripts/test-lookup.mjs [VIN]
 *   node scripts/test-lookup.mjs WBA5E7101FG155636
 * По умолчанию VIN: WBA5E7101FG155636
 */

const VIN = (process.argv[2] || "WBA5E7101FG155636").replace(/\s/g, "").toUpperCase().replace(/-/g, "");
const BASE = process.env.LOOKUP_TEST_BASE || "http://127.0.0.1:3000";

async function main() {
  console.log("Lookup test (VIN -> допуск, объём, фильтры, МойСклад)");
  console.log("VIN:", VIN);
  console.log("API:", BASE + "/api/lookup");
  console.log("");

  const res = await fetch(`${BASE}/api/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vin: VIN }),
  }).catch((e) => {
    console.error("Ошибка запроса. Запустите сервер в другом терминале: npm run dev");
    console.error(e.message);
    process.exit(1);
  });

  if (!res.ok) {
    console.error("HTTP", res.status, res.statusText);
    const text = await res.text();
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  const data = await res.json();

  console.log("--- Расшифровка ---");
  if (data.decoded) {
    console.log("  Марка:", data.decoded.make ?? "—");
    console.log("  Модель:", data.decoded.model ?? "—");
    console.log("  Год:", data.decoded.modelYear ?? "—");
  } else {
    console.log("  (нет)");
  }

  console.log("");
  console.log("--- Масло / допуск ---");
  if (data.oilInfo) {
    console.log("  Допуск:", data.oilInfo.approval || "(пусто)");
    console.log("  Объём, л:", data.oilInfo.fillVolumeLiters || "(пусто)");
    console.log("  OEM фильтров: масл.", data.oilInfo.oilFilterOem ?? "—", "| топл.", data.oilInfo.fuelFilterOem ?? "—", "| возд.", data.oilInfo.airFilterOem ?? "—", "| салон", data.oilInfo.cabinFilterOem ?? "—");
  } else {
    console.log("  (нет)");
  }

  if (data.openaiError) console.log("  OpenAI ошибка:", data.openaiError);

  console.log("");
  console.log("--- МойСклад ---");
  if (data.moySkladError) console.log("  Ошибка/предупреждение:", data.moySkladError);
  const items = data.moySkladItems ?? [];
  const filters = items.filter((p) => /фильтр|filter/i.test(p.name));
  const oils = items.filter((p) => !filters.includes(p) && /(масл|oil|atf)/i.test(p.name));
  const other = items.filter((p) => !filters.includes(p) && !oils.includes(p));
  console.log("  Всего позиций:", items.length, "| Фильтры:", filters.length, "| Масла:", oils.length, "| Прочее:", other.length);
  if (filters.length) {
    console.log("  Фильтры (первые 3):");
    filters.slice(0, 3).forEach((p, i) => console.log("    ", i + 1, p.name, "|", p.price, p.currency, "|", p.quantity, "шт."));
  }
  if (oils.length) {
    console.log("  Масла (все или первые 10):");
    oils.slice(0, 10).forEach((p, i) => console.log("    ", i + 1, p.name, "|", p.price, p.currency, "|", p.quantity, "шт."));
    if (oils.length > 10) console.log("    ... и ещё", oils.length - 10, "масел");
  }
  if (other.length && other.length <= 5) {
    console.log("  Прочее:", other.map((p) => p.name).join("; "));
  }

  console.log("");
  if (!data.decoded && !data.oilInfo?.oilFilterOem) {
    console.log("Подсказка: расшифровка и OEM пустые — проверьте PARTS_CATALOGS_API_KEY в .env.local и что сервер запущен с ним (npm run dev).");
  }
  console.log("Готово.");
}

main();
