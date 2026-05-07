#!/usr/bin/env node
/**
 * Тест Parts Catalogs API (api.parts-catalogs.com) — как в проекте "vin pin".
 * Запуск: node scripts/test-parts-catalogs.mjs [VIN]
 * Ключ из .env.local: PARTS_CATALOGS_API_KEY
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvLocal() {
  try {
    const path = join(root, ".env.local");
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*PARTS_CATALOGS_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  } catch (_) {}
  return null;
}

const VIN = process.argv[2] || "WBA5E7101FG155636";
const key = process.env.PARTS_CATALOGS_API_KEY || loadEnvLocal();
const base = (process.env.PARTS_CATALOGS_API_BASE || "https://api.parts-catalogs.com/v1").replace(/\/$/, "");

if (!key) {
  console.error("Не найден PARTS_CATALOGS_API_KEY. Задайте в .env.local или: PARTS_CATALOGS_API_KEY=xxx node scripts/test-parts-catalogs.mjs");
  process.exit(1);
}

const cleanVin = VIN.replace(/\s/g, "").toUpperCase().replace(/-/g, "");

console.log("Parts Catalogs API test (vin pin)");
console.log("VIN:", cleanVin);
console.log("Base:", base);
console.log("Key:", key.slice(0, 12) + "...");
console.log("");

async function request(path, params = {}) {
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const search = new URLSearchParams(params).toString();
  const fullUrl = search ? `${url}${url.includes("?") ? "&" : "?"}${search}` : url;
  const res = await fetch(fullUrl, { headers: { Accept: "application/json", Authorization: key } });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

try {
  console.log("1. GET /car/info?q=VIN");
  const { status, data } = await request("/car/info", { q: cleanVin });
  console.log("   Status:", status);
  if (status !== 200) {
    console.log("   Response:", JSON.stringify(data, null, 2).slice(0, 500));
    process.exit(1);
  }
  const items = Array.isArray(data) ? data : [data];
  const first = items[0];
  if (!first) {
    console.log("   Нет данных по авто");
    process.exit(1);
  }
  const catalogId = first.catalogId ?? first.catalog_id;
  const carId = first.carId ?? first.car_id;
  console.log("   title:", first.title);
  console.log("   catalogId:", catalogId);
  console.log("   carId:", carId?.slice(0, 20) + "...");
  console.log("");

  console.log("2. GET /catalogs/{catalogId}/groups2/?carId=...");
  const { status: gStatus, data: groupsData } = await request(`/catalogs/${catalogId}/groups2/`, { carId });
  console.log("   Status:", gStatus);
  const groups = Array.isArray(groupsData) ? groupsData : (groupsData?.items ?? groupsData?.groups ?? []);
  console.log("   Групп:", groups.length);
  const withParts = groups.filter((g) => g.hasParts).length;
  const withSub = groups.filter((g) => g.hasSubgroups).length;
  console.log("   С запчастями (hasParts):", withParts, ", с подгруппами:", withSub);
  if (groups.length > 0) console.log("   Ключи первой группы:", Object.keys(groups[0]).join(", "));
  console.log("");

  const firstWithSub = groups.find((g) => g.hasSubgroups);
  if (firstWithSub) {
    const parentId = firstWithSub.id ?? firstWithSub.groupId;
    console.log("3. GET /catalogs/.../groups2/?carId=...&groupId=... (подгруппы первой группы)");
    const { status: subStatus, data: subData } = await request(`/catalogs/${catalogId}/groups2/`, { carId, groupId: parentId });
    console.log("   Status:", subStatus);
    const subGroups = Array.isArray(subData) ? subData : (subData?.items ?? subData?.groups ?? []);
    console.log("   Подгрупп:", subGroups.length);
    const subWithParts = subGroups.filter((g) => g.hasParts).length;
    const subWithSub = subGroups.filter((g) => g.hasSubgroups).length;
    console.log("   С запчастями:", subWithParts, ", с подгруппами:", subWithSub);
    if (subGroups.length > 0) {
      const one = subGroups[0];
      console.log("   Ключи первой подгруппы:", Object.keys(one).join(", "));
      const groupWithParts = subGroups.find((g) => g.hasParts);
      if (groupWithParts) {
        const gid = groupWithParts.id ?? groupWithParts.groupId;
        console.log("4. GET parts2 для группы с hasParts (id=" + gid?.slice(0, 12) + "...)");
        const { status: pStatus, data: pData } = await request(`/catalogs/${catalogId}/parts2`, { carId, groupId: gid });
        console.log("   Status:", pStatus, ", partGroups:", pData?.partGroups?.length ?? 0);
        if (pStatus !== 200) console.log("   Response:", JSON.stringify(pData).slice(0, 300));
        const parts = (pData?.partGroups ?? []).flatMap((pg) => pg.parts ?? []);
        console.log("   Запчастей:", parts.length);
        if (parts.length > 0) console.log("   Пример:", parts[0].number ?? parts[0].name);
      }
    }
    console.log("");
  }

  console.log("Готово. Для полного подбора фильтров запустите приложение (npm run dev) и введите VIN на странице.");
} catch (e) {
  console.error("Ошибка:", e.message);
  process.exit(1);
}
