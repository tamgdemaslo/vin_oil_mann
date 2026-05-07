#!/usr/bin/env node
/**
 * Однократный запрос к API Cloud VIN Decoder. Использует API_CLOUD_TOKEN из .env.local
 * Запуск: node scripts/fetch-api-cloud-vin.mjs [VIN]
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, ".env.local");

let token = process.env.API_CLOUD_TOKEN;
if (!token) {
  try {
    const env = readFileSync(envPath, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*API_CLOUD_TOKEN\s*=\s*(.+)$/);
      if (m) {
        token = m[1].trim().replace(/^["']|["']$/g, "");
        break;
      }
    }
  } catch (_) {}
}

const vin = (process.argv[2] || "WBA5E7101FG155636").replace(/\s/g, "").toUpperCase();
if (!token) {
  console.error("Не найден API_CLOUD_TOKEN в .env.local или в окружении.");
  process.exit(1);
}

const url = `https://api-cloud.ru/api/vindecoder.php?type=vin&vin=${encodeURIComponent(vin)}&token=${encodeURIComponent(token)}`;

const res = await fetch(url, { headers: { Accept: "application/json" } });
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
