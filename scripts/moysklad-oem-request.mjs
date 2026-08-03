/**
 * Один запрос к API МойСклад по OEM (атрибут OEM PARTS). Запуск: node scripts/moysklad-oem-request.mjs
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

const OEM = process.argv[2] || "11428575211";
const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";
const MOYSKLAD_OEM_ATTRIBUTE_ID = "c6292524-0e67-11f1-0a80-066200111f95";

const login = process.env.MOYSKLAD_LOGIN;
const password = process.env.MOYSKLAD_PASSWORD;
if (!login || !password) {
  console.error("Нет MOYSKLAD_LOGIN или MOYSKLAD_PASSWORD в .env.local");
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${login}:${password}`, "utf-8").toString("base64");
const headers = { Authorization: auth, Accept: "application/json;charset=utf-8" };

const attrHref = `${MOYSKLAD_BASE}/entity/product/metadata/attributes/${MOYSKLAD_OEM_ATTRIBUTE_ID}`;
console.log("1) filter = exact (attr=value):");
let url = `${MOYSKLAD_BASE}/entity/product?filter=${encodeURIComponent(attrHref)}=${encodeURIComponent(OEM)}&limit=5`;
let res = await fetch(url, { headers });
let json = await res.json();
console.log("   Status:", res.status, "rows:", json.rows?.length ?? 0);
console.log("");
console.log("2) filter = partial (attr~value):");
url = `${MOYSKLAD_BASE}/entity/product?filter=${encodeURIComponent(attrHref)}~${encodeURIComponent(OEM)}&limit=5`;
res = await fetch(url, { headers });
json = await res.json();
console.log("   Status:", res.status, "rows:", json.rows?.length ?? 0);
if (json.rows?.length) json.rows.forEach((r, i) => console.log("   ", i + 1, r.name));
