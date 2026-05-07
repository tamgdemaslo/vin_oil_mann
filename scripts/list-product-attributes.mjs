#!/usr/bin/env node
/**
 * Вывести в терминал список доп. полей товара МойСклад (UUID + имя).
 * Запуск: node scripts/list-product-attributes.mjs
 * Берёт логин/пароль из .env.local (MOYSKLAD_LOGIN, MOYSKLAD_PASSWORD).
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");

if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const login = process.env.MOYSKLAD_LOGIN;
const password = process.env.MOYSKLAD_PASSWORD;

if (!login || !password) {
  console.error("Нет MOYSKLAD_LOGIN или MOYSKLAD_PASSWORD в .env.local");
  process.exit(1);
}

const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";
const auth = "Basic " + Buffer.from(`${login}:${password}`, "utf-8").toString("base64");
const headers = {
  Authorization: auth,
  Accept: "application/json;charset=utf-8",
};

async function main() {
  const url = `${MOYSKLAD_BASE}/entity/product/metadata/attributes`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error("HTTP", res.status, res.statusText);
    const text = await res.text();
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  const data = await res.json();
  const attrs = data?.rows ?? [];

  console.log("Атрибуты товара МойСклад (UUID — имя):");
  for (const a of attrs) {
    const id = a.id || (a.meta?.href ? String(a.meta.href).split("/").pop() : "");
    const name = a.name || "";
    console.log(`${id} — ${name}`);
  }
}

main().catch((e) => {
  console.error("Ошибка запроса атрибутов:", e?.message || e);
  process.exit(1);
});

