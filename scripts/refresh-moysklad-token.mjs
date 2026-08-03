#!/usr/bin/env node
/**
 * Запрос нового токена JSON API МойСклад по логину/паролю из .env.local.
 * Документация: POST /security/token + Authorization: Basic …
 * Внимание: ранее выданные токены этого пользователя будут отозваны.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env.local");

function parseEnv(content) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function main() {
  if (!fs.existsSync(envPath)) {
    console.error("Нет файла .env.local в корне проекта.");
    process.exit(1);
  }
  const env = parseEnv(fs.readFileSync(envPath, "utf8"));
  const login = env.MOYSKLAD_LOGIN?.trim();
  const password = env.MOYSKLAD_PASSWORD?.trim();
  if (!login || !password) {
    console.error("В .env.local задайте MOYSKLAD_LOGIN и MOYSKLAD_PASSWORD.");
    process.exit(1);
  }

  const basic = Buffer.from(`${login}:${password}`, "utf8").toString("base64");
  const url = "https://api.moysklad.ru/api/remap/1.2/security/token";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json;charset=utf-8",
      "Accept-Encoding": "gzip",
    },
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error("Не JSON в ответе:", text.slice(0, 500));
    process.exit(1);
  }

  if (!res.ok) {
    const err = data?.errors?.[0]?.error ?? text.slice(0, 300);
    console.error("Ошибка МойСклад:", err);
    process.exit(1);
  }

  const token = data?.access_token;
  if (!token) {
    console.error("В ответе нет access_token:", JSON.stringify(data));
    process.exit(1);
  }

  console.log("\nНовый MOYSKLAD_TOKEN (скопируйте в .env.local, затем перезапустите dev):\n");
  console.log(`MOYSKLAD_TOKEN=${token}\n`);
  console.log(
    "Ранее выданные токены этого пользователя в МойСклад отозваны (поведение API при выпуске нового)."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
