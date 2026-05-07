#!/usr/bin/env node
/**
 * Тест OpenAI: запрос требований к маслу по данным автомобиля (без VIN, без МойСклад).
 * Запуск: node scripts/test-openai-oil.mjs [марка] [модель] [год]
 * Пример: node scripts/test-openai-oil.mjs Auris "Hybrid ZZE150L" 2015
 * По умолчанию: Toyota Auris Hybrid (как в логах lookup).
 * Читает OPENAI_API_KEY и OPENAI_OIL_MODEL из .env.local
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import OpenAI from "openai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const make = process.argv[2] || "Toyota";
const model = process.argv[3] || "Auris / Hybrid (Ukp) SOL - ZZE150L-DHMNKW";
const year = process.argv[4] || "";

const vehicle = [
  make && `Марка: ${make}`,
  model && `Модель: ${model}`,
  year && `Год: ${year}`,
]
  .filter(Boolean)
  .join("\n");

const apiKey = process.env.OPENAI_API_KEY?.trim();
const modelId = process.env.OPENAI_OIL_MODEL?.trim() || "gpt-4o-mini";

if (!apiKey) {
  console.error("Нет OPENAI_API_KEY в .env.local");
  process.exit(1);
}

const systemContent = `Ты — эксперт по моторным маслам. По данным автомобиля верни JSON с требованиями к маслу.
Формат ответа (только валидный JSON, без markdown):
{
  "oil_capacity_liters": число или null,
  "oil_capacity_note": "с фильтром" или "без фильтра" или "",
  "sae_viscosities": ["5W-30"] или ["0W-20","5W-30"] — массив допустимых вязкостей SAE,
  "oem_approvals": ["VW 504 00","VW 507 00"] — допуски производителей,
  "acea": ["C3"],
  "api": ["SN"],
  "confidence": 0.0-1.0,
  "source_hint": "кратко на чём основано"
}
SAE всегда в формате XW-YY (например 5W-30). OEM — канонические обозначения (VW 504 00, MB 229.5, BMW LL-04, dexos2 и т.д.).`;

async function main() {
  console.log("--- Тест OpenAI (требования к маслу) ---");
  console.log("Модель API:", modelId);
  console.log("Данные авто:", vehicle || "(пусто)");
  console.log("");

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: modelId,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: `Данные автомобиля:\n${vehicle || "(только VIN)"}\n\nВерни JSON с требованиями к моторному маслу.` },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 8192,
  });

  let raw = completion.choices[0]?.message?.content;
  if (typeof raw !== "string" && Array.isArray(raw)) {
    raw = raw.map((p) => (p && typeof p === "object" && "text" in p ? p.text : "")).join("");
  }
  raw = (typeof raw === "string" ? raw : "").trim();
  const text = raw || "{}";
  const choice = completion.choices[0];
  const finishReason = choice?.finish_reason;
  console.log("--- Ответ API ---");
  console.log("  finish_reason:", finishReason);
  console.log("  длина текста:", (raw || "").length);
  if (process.env.DEBUG_OPENAI) {
    console.log("  [debug] choice.message:", JSON.stringify(choice?.message, null, 2));
    console.log("  [debug] usage:", completion.usage);
  }
  console.log("--- Сырой текст ---");
  console.log(text);
  console.log("");

  try {
    const parsed = JSON.parse(text);
    console.log("--- Распарсено ---");
    console.log("  oil_capacity_liters:", parsed.oil_capacity_liters);
    console.log("  oil_capacity_note:", parsed.oil_capacity_note ?? "—");
    console.log("  sae_viscosities:", parsed.sae_viscosities ?? []);
    console.log("  oem_approvals:", parsed.oem_approvals ?? []);
    console.log("  acea:", parsed.acea ?? []);
    console.log("  api:", parsed.api ?? []);
    console.log("  confidence:", parsed.confidence);
    console.log("  source_hint:", parsed.source_hint ?? "—");
  } catch (e) {
    console.error("Ошибка парсинга JSON:", e.message);
  }
  console.log("");
  console.log("Готово.");
}

main().catch((e) => {
  console.error("Ошибка:", e.message);
  if (e.status) console.error("status:", e.status);
  if (e.error) console.error("error:", e.error);
  process.exit(1);
});
