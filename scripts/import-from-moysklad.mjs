#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";
const PAGE_LIMIT = 1000;

function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function getAuthHeader() {
  const token = process.env.MOYSKLAD_TOKEN?.trim();
  if (token) return `Bearer ${token}`;
  const login = process.env.MOYSKLAD_LOGIN?.trim();
  const password = process.env.MOYSKLAD_PASSWORD?.trim();
  if (login && password) return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
  return "";
}

async function moyskladFetch(pathOrUrl) {
  const auth = getAuthHeader();
  if (!auth) throw new Error("Не заданы MOYSKLAD_TOKEN или MOYSKLAD_LOGIN/MOYSKLAD_PASSWORD");
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${MOYSKLAD_BASE}${pathOrUrl}`;
  const res = await fetch(url, {
    headers: {
      Authorization: auth,
      Accept: "application/json;charset=utf-8",
      "Accept-Encoding": "gzip",
    },
  });
  if (!res.ok) throw new Error(`МойСклад ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchPaged(pathFactory, maxRows = null) {
  const out = [];
  let offset = 0;
  while (maxRows == null || out.length < maxRows) {
    const remaining = maxRows == null ? PAGE_LIMIT : Math.min(PAGE_LIMIT, maxRows - out.length);
    const data = await moyskladFetch(pathFactory(offset, remaining));
    const rows = data.rows ?? [];
    out.push(...rows);
    const size = data.meta?.size;
    if (rows.length < remaining || rows.length === 0 || (typeof size === "number" && out.length >= size)) break;
    offset += rows.length;
  }
  return out;
}

function attrValue(row, names) {
  const normalized = names.map((name) => name.toLowerCase());
  for (const attr of row.attributes ?? []) {
    const name = String(attr.name ?? "").trim().toLowerCase();
    if (!normalized.some((needle) => name === needle || name.includes(needle))) continue;
    const value = attr.value;
    if (value == null) return null;
    if (typeof value === "object") return String(value.name ?? value.value ?? "").trim() || null;
    return String(value).trim() || null;
  }
  return null;
}

function cents(value) {
  return value == null ? null : Math.round(Number(value) || 0);
}

function searchText(parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

async function seedAttributeDefinitions() {
  const definitions = [
    ["vin номер", 10, false, false],
    ["модель авто", 20, false, false],
    ["год", 30, false, false],
    ["гос. номер", 40, false, false],
    ["пробег", 50, false, false],
    ["Объем", 60, true, false],
    ["Моторное масло", 70, true, false],
    ["Эко пользователь", 1000, false, true],
  ];
  for (const [name, order, required, isSystem] of definitions) {
    await prisma.demandAttributeDefinition.upsert({
      where: { name },
      update: { type: "string", order, required, isSystem },
      create: { name, type: "string", order, required, isSystem },
    });
  }
}

async function importOrganizations() {
  const rows = await fetchPaged((offset, limit) => `/entity/organization?limit=${limit}&offset=${offset}`);
  for (const row of rows) {
    await prisma.localOrganization.upsert({
      where: { moyskladId: row.id },
      update: {
        moyskladHref: row.meta?.href ?? null,
        name: row.name?.trim() || row.id,
        isActive: !row.archived,
        raw: row,
        syncedAt: new Date(),
      },
      create: {
        moyskladId: row.id,
        moyskladHref: row.meta?.href ?? null,
        name: row.name?.trim() || row.id,
        isActive: !row.archived,
        raw: row,
      },
    });
  }
  return rows.length;
}

async function importStores() {
  const rows = await fetchPaged((offset, limit) => `/entity/store?limit=${limit}&offset=${offset}`);
  for (const row of rows) {
    const name = row.name?.trim() || row.id;
    await prisma.localStore.upsert({
      where: { moyskladId: row.id },
      update: {
        moyskladHref: row.meta?.href ?? null,
        name,
        isMain: name.toLowerCase().includes("основной"),
        archived: Boolean(row.archived),
        raw: row,
        syncedAt: new Date(),
      },
      create: {
        moyskladId: row.id,
        moyskladHref: row.meta?.href ?? null,
        name,
        isMain: name.toLowerCase().includes("основной"),
        archived: Boolean(row.archived),
        raw: row,
      },
    });
  }
  return rows.length;
}

async function importProducts(entityType) {
  const expand = entityType === "product" ? "&expand=attributes,supplier,images" : "";
  const rows = await fetchPaged((offset, limit) => `/entity/${entityType}?limit=${limit}&offset=${offset}${expand}`);
  for (const row of rows) {
    const salePrice = row.salePrices?.[0];
    const sae = attrValue(row, ["SAE"]);
    const oem = attrValue(row, ["OEM"]);
    const acea = attrValue(row, ["ACEA"]);
    const apiSpec = attrValue(row, ["API"]);
    const params = attrValue(row, ["Параметры"]);
    const packageVolume = attrValue(row, ["Объем"]);
    const brand = attrValue(row, ["Brand"]);
    const oemParts = attrValue(row, ["OEM PARTS"]);
    const mannName = attrValue(row, ["Наименование по Mann", "Наиминование по Mann"]);
    const cell = attrValue(row, ["Ячейка"]);
    const imageHref = row.images?.rows?.[0]?.tiny?.href ?? row.images?.rows?.[0]?.miniature?.href ?? null;
    await prisma.localProduct.upsert({
      where: { moyskladId: row.id },
      update: {
        moyskladHref: row.meta?.href ?? null,
        entityType,
        name: row.name?.trim() || row.id,
        article: row.article?.trim() || null,
        code: row.code?.trim() || null,
        salePriceCents: cents(salePrice?.value) ?? 0,
        buyPriceCents: cents(row.buyPrice?.value),
        currencyName: salePrice?.currency?.name ?? "руб.",
        sae,
        oem,
        acea,
        apiSpec,
        packageVolume,
        brand,
        oemParts,
        mannName,
        params,
        cell,
        imageHref,
        attributes: row.attributes ?? null,
        searchText: searchText([row.name, row.article, row.code, sae, oem, acea, apiSpec, params, packageVolume, brand, oemParts, mannName, cell]),
        archived: Boolean(row.archived),
        raw: row,
        syncedAt: new Date(),
      },
      create: {
        moyskladId: row.id,
        moyskladHref: row.meta?.href ?? null,
        entityType,
        name: row.name?.trim() || row.id,
        article: row.article?.trim() || null,
        code: row.code?.trim() || null,
        salePriceCents: cents(salePrice?.value) ?? 0,
        buyPriceCents: cents(row.buyPrice?.value),
        currencyName: salePrice?.currency?.name ?? "руб.",
        sae,
        oem,
        acea,
        apiSpec,
        packageVolume,
        brand,
        oemParts,
        mannName,
        params,
        cell,
        imageHref,
        attributes: row.attributes ?? null,
        searchText: searchText([row.name, row.article, row.code, sae, oem, acea, apiSpec, params, packageVolume, brand, oemParts, mannName, cell]),
        archived: Boolean(row.archived),
        raw: row,
      },
    });
  }
  return rows.length;
}

async function importCounterparties() {
  const rows = await fetchPaged((offset, limit) => `/entity/counterparty?limit=${limit}&offset=${offset}`);
  for (const row of rows) {
    const phonesRaw = [row.phone, ...(row.phones ?? []).map((item) => typeof item === "string" ? item : item.phone)].filter(Boolean);
    const phone = row.phone?.trim() || phonesRaw[0] || null;
    await prisma.localCounterparty.upsert({
      where: { moyskladId: row.id },
      update: {
        moyskladHref: row.meta?.href ?? null,
        name: row.name?.trim() || row.id,
        phone,
        email: row.email?.trim() || null,
        normalizedPhone: phone ? phone.replace(/\D/g, "") : null,
        phonesRaw,
        companyType: row.companyType ?? null,
        legalTitle: row.legalTitle?.trim() || null,
        searchText: searchText([row.name, phone, row.email, row.legalTitle, row.companyType, phonesRaw.join(" ")]),
        archived: Boolean(row.archived),
        raw: row,
        syncedAt: new Date(),
      },
      create: {
        moyskladId: row.id,
        moyskladHref: row.meta?.href ?? null,
        name: row.name?.trim() || row.id,
        phone,
        email: row.email?.trim() || null,
        normalizedPhone: phone ? phone.replace(/\D/g, "") : null,
        phonesRaw,
        companyType: row.companyType ?? null,
        legalTitle: row.legalTitle?.trim() || null,
        searchText: searchText([row.name, phone, row.email, row.legalTitle, row.companyType, phonesRaw.join(" ")]),
        archived: Boolean(row.archived),
        raw: row,
      },
    });
  }
  return rows.length;
}

async function importStock() {
  const rows = await fetchPaged((offset, limit) => `/report/stock/bystore?limit=${limit}&offset=${offset}`);
  const [products, stores] = await Promise.all([
    prisma.localProduct.findMany({ select: { id: true, moyskladId: true, buyPriceCents: true, cell: true } }),
    prisma.localStore.findMany({ select: { id: true, name: true } }),
  ]);
  const productByMoyskladId = new Map(products.map((row) => [row.moyskladId, row]));
  const storeByName = new Map(stores.map((row) => [row.name.toLowerCase(), row]));
  let count = 0;
  for (const row of rows) {
    const moyskladId = row.assortment?.meta?.href?.split("/").pop() ?? row.meta?.href?.split("/").pop();
    const product = moyskladId ? productByMoyskladId.get(moyskladId) : null;
    if (!product) continue;
    for (const stock of row.stockByStore ?? []) {
      const store = storeByName.get(String(stock.name ?? "").toLowerCase());
      if (!store) continue;
      const quantity = Number(stock.stock ?? 0);
      const reserve = Number(stock.reserve ?? 0);
      await prisma.localStockBalance.upsert({
        where: { productId_storeId: { productId: product.id, storeId: store.id } },
        update: {
          quantity,
          reserve,
          available: Math.max(0, quantity - reserve),
          buyPriceCents: product.buyPriceCents,
          slotName: product.cell,
          syncedAt: new Date(),
        },
        create: {
          productId: product.id,
          storeId: store.id,
          quantity,
          reserve,
          available: Math.max(0, quantity - reserve),
          buyPriceCents: product.buyPriceCents,
          slotName: product.cell,
        },
      });
      count += 1;
    }
  }
  return count;
}

async function main() {
  loadEnvLocal();
  await seedAttributeDefinitions();
  console.log("Импорт организаций...");
  const organizations = await importOrganizations();
  console.log("Импорт складов...");
  const stores = await importStores();
  console.log("Импорт товаров...");
  const products = await importProducts("product");
  console.log("Импорт услуг...");
  const services = await importProducts("service");
  console.log("Импорт контрагентов...");
  const counterparties = await importCounterparties();
  console.log("Импорт остатков...");
  const stock = await importStock();
  console.log({ organizations, stores, products, services, counterparties, stock });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
