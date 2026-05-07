#!/usr/bin/env node
/**
 * Запрос UUID доп. полей товара МойСклад (entity/product/metadata/attributes).
 * Запуск: node scripts/moysklad-attributes-uuid.mjs
 * Читает MOYSKLAD_LOGIN, MOYSKLAD_PASSWORD из .env.local
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

const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";
const login = process.env.MOYSKLAD_LOGIN;
const password = process.env.MOYSKLAD_PASSWORD;

if (!login || !password) {
  console.error("Нет MOYSKLAD_LOGIN или MOYSKLAD_PASSWORD в .env.local");
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${login}:${password}`, "utf-8").toString("base64");
const res = await fetch(`${MOYSKLAD_BASE}/entity/product/metadata/attributes`, {
  headers: { Authorization: auth, Accept: "application/json;charset=utf-8" },
});

if (!res.ok) {
  console.error("HTTP", res.status, await res.text().then((t) => t.slice(0, 200)));
  process.exit(1);
}

const data = await res.json();
const rows = data.rows ?? [];
console.log("Доп. поля товара (entity/product/metadata/attributes):\n");
console.log("Название                          | UUID");
console.log("-".repeat(60));
for (const a of rows) {
  const name = (a.name ?? "").padEnd(32);
  const id = a.id ?? "";
  console.log(`${name} | ${id}`);
}
console.log("-".repeat(60));
console.log("Всего:", rows.length);
console.log("\nСкопируйте нужный UUID в .env.local, например:");
console.log("  MOYSKLAD_ATTR_OEM=<uuid поля OEM для масел>");
console.log("  MOYSKLAD_ATTR_SAE=  MOYSKLAD_ATTR_ACEA=  MOYSKLAD_ATTR_API=  MOYSKLAD_ATTR_VOLUME=");
