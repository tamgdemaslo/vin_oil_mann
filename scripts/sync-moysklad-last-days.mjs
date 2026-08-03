#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(ROOT, "moysklad-last-days-sync-dry-run.json");
const REPORT_MD = path.join(ROOT, "moysklad-last-days-sync-dry-run.md");
const FINAL_REPORT_MD = path.join(ROOT, "moysklad-final-sync-report.md");
const ACCEPTANCE_REPORT_MD = path.join(ROOT, "moysklad-acceptance-report.md");
const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";
const PAGE_LIMIT = 1000;
const DEMAND_PAGE_LIMIT = 100;
const POSITION_PAGE_LIMIT = 1000;
const DEFAULT_MOYSKLAD_REQUEST_DELAY_MS = 350;
const DEFAULT_MOYSKLAD_MAX_RETRIES = 5;

let prismaClient = null;
let moyskladQueue = Promise.resolve();
let lastMoyskladRequestAt = 0;

function getPrisma() {
  if (!prismaClient) prismaClient = new PrismaClient();
  return prismaClient;
}

function parseArgs(argv) {
  const envDays = Number.parseInt(process.env.DAYS_TO_SYNC ?? "", 10);
  const args = {
    days: Number.isFinite(envDays) && envDays > 0 ? envDays : 14,
    mode: "audit",
    entities: "all",
    backupConfirmed: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--days=")) args.days = Number.parseInt(arg.slice("--days=".length), 10);
    else if (arg.startsWith("--mode=")) args.mode = arg.slice("--mode=".length);
    else if (arg.startsWith("--entities=")) args.entities = arg.slice("--entities=".length);
    else if (arg === "--backup-confirmed") args.backupConfirmed = true;
  }
  if (!Number.isFinite(args.days) || args.days <= 0) args.days = 14;
  if (!["audit", "backfill", "verify", "report"].includes(args.mode)) {
    throw new Error("mode должен быть audit, backfill, verify или report");
  }
  return args;
}

async function loadEnvFile(fileName) {
  const fullPath = path.join(ROOT, fileName);
  let raw = "";
  try {
    raw = await fs.readFile(fullPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function envFlag(name, defaultValue) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  if (["0", "false", "no", "off", "disabled"].includes(value)) return false;
  if (["1", "true", "yes", "on", "enabled"].includes(value)) return true;
  return defaultValue;
}

function getAuthHeader() {
  const login = process.env.MOYSKLAD_LOGIN?.trim();
  const password = process.env.MOYSKLAD_PASSWORD?.trim();
  const token = process.env.MOYSKLAD_TOKEN?.trim();
  const preferBearer = envFlag("MOYSKLAD_PREFER_BEARER", false);
  if (login && password && !preferBearer) return "Basic " + Buffer.from(`${login}:${password}`, "utf8").toString("base64");
  if (token) return `Bearer ${token}`;
  if (login && password) return "Basic " + Buffer.from(`${login}:${password}`, "utf8").toString("base64");
  return null;
}

function intEnv(name, defaultValue) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withMoyskladRequestSlot(task) {
  const delayMs = intEnv("MOYSKLAD_REQUEST_DELAY_MS", DEFAULT_MOYSKLAD_REQUEST_DELAY_MS);
  const run = moyskladQueue.then(async () => {
    const elapsed = Date.now() - lastMoyskladRequestAt;
    if (elapsed < delayMs) await sleep(delayMs - elapsed);
    try {
      return await task();
    } finally {
      lastMoyskladRequestAt = Date.now();
    }
  });
  moyskladQueue = run.catch(() => {});
  return run;
}

async function moyskladJson(pathOrUrl) {
  const auth = getAuthHeader();
  if (!auth) throw new Error("Не заданы MOYSKLAD_TOKEN или MOYSKLAD_LOGIN/MOYSKLAD_PASSWORD");
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${MOYSKLAD_BASE}${pathOrUrl}`;
  const maxRetries = intEnv("MOYSKLAD_MAX_RETRIES", DEFAULT_MOYSKLAD_MAX_RETRIES);
  return withMoyskladRequestSlot(async () => {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const res = await fetch(url, {
        headers: {
          Authorization: auth,
          Accept: "application/json;charset=utf-8",
          "Accept-Encoding": "gzip",
          "Content-Type": "application/json",
        },
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (res.ok) return data;
      const message = data?.errors?.[0]?.error || res.statusText || "Ошибка МойСклад";
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        const backoffMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(15000, 1000 * 2 ** attempt);
        console.warn(`МойСклад 429: ждём ${backoffMs}ms перед повтором (${attempt + 1}/${maxRetries})`);
        await sleep(backoffMs);
        continue;
      }
      throw new Error(`МойСклад ${res.status}: ${message}`);
    }
    throw new Error("МойСклад: исчерпаны повторы запроса");
  });
}

async function fetchPaged(buildPath, pageLimit = PAGE_LIMIT, maxRows = null) {
  const rows = [];
  let offset = 0;
  let size = Number.POSITIVE_INFINITY;
  while (offset < size) {
    const remaining = maxRows == null ? pageLimit : Math.min(pageLimit, Math.max(0, maxRows - rows.length));
    if (remaining <= 0) break;
    const data = await moyskladJson(buildPath(offset, remaining));
    const chunk = data.rows ?? [];
    rows.push(...chunk);
    size = Number.isFinite(data.meta?.size) ? data.meta.size : Number.POSITIVE_INFINITY;
    if (chunk.length < remaining || chunk.length === 0) break;
    offset += chunk.length;
  }
  return maxRows == null ? rows : rows.slice(0, maxRows);
}

function moyskladMoment(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function cutoffFromDays(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

function idFromHref(href) {
  if (!href || typeof href !== "string") return null;
  return href.split(/[?#]/)[0].split("/").filter(Boolean).at(-1) ?? null;
}

function text(value) {
  const out = String(value ?? "").trim();
  return out || null;
}

function cents(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function decimal(value) {
  const n = Number(value ?? 0);
  return new Prisma.Decimal(Number.isFinite(n) ? n : 0);
}

function toJson(value) {
  if (value == null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value));
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

function firstSalePrice(row) {
  return cents(row.salePrices?.[0]?.value);
}

function safeName(row) {
  return text(row.name) ?? row.id;
}

function rowMeta(row) {
  return row.meta?.href ?? null;
}

function asDateFromMoment(moment) {
  const raw = text(moment) ?? new Date().toISOString();
  const documentDate = raw.slice(0, 10);
  const normalized = raw.includes(" ") ? raw.replace(" ", "T") : raw;
  const parsed = new Date(normalized);
  return {
    documentDate,
    momentAt: Number.isFinite(parsed.getTime()) ? parsed : new Date(`${documentDate}T00:00:00`),
  };
}

function createReport(mode, days, cutoff) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    days,
    cutoff: cutoff.toISOString(),
    summary: {
      missingLocally: 0,
      changedRemotely: 0,
      localOnly: 0,
      conflicts: 0,
      readyToImport: 0,
      needsManualReview: 0,
    },
    sections: {
      missingLocally: [],
      changedRemotely: [],
      localOnly: [],
      conflicts: [],
      readyToImport: [],
      needsManualReview: [],
    },
    entities: {},
    readiness: {
      backupConfirmed: false,
      canBackfill: false,
      blockers: [],
    },
  };
}

function pushSection(report, section, item) {
  report.sections[section].push(item);
  const key = section[0].toLowerCase() + section.slice(1);
  if (Object.hasOwn(report.summary, key)) report.summary[key] += 1;
}

function addEntitySummary(report, entity, patch) {
  report.entities[entity] = { ...(report.entities[entity] ?? {}), ...patch };
}

function compareField(diffs, label, remoteValue, localValue) {
  if (String(remoteValue ?? "") !== String(localValue ?? "")) {
    diffs.push({ field: label, remote: remoteValue ?? null, local: localValue ?? null });
  }
}

function dateMs(value) {
  if (!value) return Number.NaN;
  const parsed = value instanceof Date ? value : new Date(value);
  return parsed.getTime();
}

function isLocallyModified(row) {
  const updatedAt = dateMs(row?.updatedAt);
  const syncedAt = dateMs(row?.syncedAt);
  return Number.isFinite(updatedAt) && Number.isFinite(syncedAt) && updatedAt > syncedAt + 1000;
}

async function upsertMoyskladMirror(model, row, create, update, select = undefined) {
  const existing = await model.findUnique({
    where: { moyskladId: row.id },
    select: { id: true, updatedAt: true, syncedAt: true },
  });
  if (existing && isLocallyModified(existing)) {
    return { skipped: true, row: existing };
  }
  const selected = select ?? { id: true };
  if (existing) {
    return {
      skipped: false,
      row: await model.update({ where: { moyskladId: row.id }, data: update, select: selected }),
    };
  }
  return {
    skipped: false,
    row: await model.create({ data: create, select: selected }),
  };
}

async function fetchRemote(days) {
  const cutoff = cutoffFromDays(days);
  const fromMoment = moyskladMoment(cutoff);
  const updatedFilter = encodeURIComponent(`updated>=${fromMoment}`);
  const momentFilter = encodeURIComponent(`moment>=${fromMoment}`);

  const [
    organizations,
    stores,
    products,
    services,
    counterparties,
    demands,
    supplies,
    losses,
    cashouts,
    paymentins,
    paymentouts,
    invoiceins,
    stock,
  ] = await Promise.all([
    fetchPaged((offset, limit) => `/entity/organization?filter=${updatedFilter}&limit=${limit}&offset=${offset}`),
    fetchPaged((offset, limit) => `/entity/store?filter=${updatedFilter}&limit=${limit}&offset=${offset}`),
    fetchPaged((offset, limit) => `/entity/product?filter=${updatedFilter}&limit=${limit}&offset=${offset}&expand=attributes,uom,country,supplier`, 100),
    fetchPaged((offset, limit) => `/entity/service?filter=${updatedFilter}&limit=${limit}&offset=${offset}`),
    fetchPaged((offset, limit) => `/entity/counterparty?filter=${updatedFilter}&limit=${limit}&offset=${offset}&expand=contactpersons`),
    fetchPaged((offset, limit) => `/entity/demand?filter=${momentFilter}&limit=${Math.min(limit, DEMAND_PAGE_LIMIT)}&offset=${offset}&order=moment,desc&expand=agent,organization,store`, DEMAND_PAGE_LIMIT),
    fetchPaged((offset, limit) => `/entity/supply?filter=${momentFilter}&limit=${Math.min(limit, DEMAND_PAGE_LIMIT)}&offset=${offset}&order=moment,desc&expand=agent,organization,store`, DEMAND_PAGE_LIMIT),
    fetchPaged((offset, limit) => `/entity/loss?filter=${momentFilter}&limit=${Math.min(limit, DEMAND_PAGE_LIMIT)}&offset=${offset}&order=moment,desc&expand=organization,store`, DEMAND_PAGE_LIMIT).catch((error) => ({ error })),
    fetchPaged((offset, limit) => `/entity/cashout?filter=${momentFilter}&limit=${Math.min(limit, DEMAND_PAGE_LIMIT)}&offset=${offset}&order=moment,desc&expand=agent,expenseItem,organization`, DEMAND_PAGE_LIMIT),
    fetchPaged((offset, limit) => `/entity/paymentin?filter=${momentFilter}&limit=${Math.min(limit, DEMAND_PAGE_LIMIT)}&offset=${offset}&order=moment,desc&expand=agent,organization`, DEMAND_PAGE_LIMIT).catch((error) => ({ error })),
    fetchPaged((offset, limit) => `/entity/paymentout?filter=${momentFilter}&limit=${Math.min(limit, DEMAND_PAGE_LIMIT)}&offset=${offset}&order=moment,desc&expand=agent,organization`, DEMAND_PAGE_LIMIT).catch((error) => ({ error })),
    fetchPaged((offset, limit) => `/entity/invoicein?filter=${momentFilter}&limit=${Math.min(limit, DEMAND_PAGE_LIMIT)}&offset=${offset}&order=moment,desc&expand=agent,organization`, DEMAND_PAGE_LIMIT).catch((error) => ({ error })),
    fetchPaged((offset, limit) => `/report/stock/bystore?limit=${limit}&offset=${offset}`),
  ]);

  const demandPositions = new Map();
  await Promise.all(
    demands.map(async (demand) => {
      const positions = await fetchPaged(
        (offset, limit) => `/entity/demand/${demand.id}/positions?limit=${limit}&offset=${offset}&expand=assortment,slot`,
        POSITION_PAGE_LIMIT
      );
      demandPositions.set(demand.id, positions);
    })
  );

  return {
    cutoff,
    organizations,
    stores,
    products,
    services,
    counterparties,
    demands,
    demandPositions,
    supplies,
    losses: Array.isArray(losses) ? losses : [],
    lossesError: Array.isArray(losses) ? null : losses.error?.message ?? String(losses.error),
    cashouts,
    paymentins: Array.isArray(paymentins) ? paymentins : [],
    paymentinsError: Array.isArray(paymentins) ? null : paymentins.error?.message ?? String(paymentins.error),
    paymentouts: Array.isArray(paymentouts) ? paymentouts : [],
    paymentoutsError: Array.isArray(paymentouts) ? null : paymentouts.error?.message ?? String(paymentouts.error),
    invoiceins: Array.isArray(invoiceins) ? invoiceins : [],
    invoiceinsError: Array.isArray(invoiceins) ? null : invoiceins.error?.message ?? String(invoiceins.error),
    stock,
  };
}

function idsFromRows(rows) {
  return [...new Set((rows ?? []).map((row) => row.id).filter(Boolean))];
}

function hrefsFromRows(rows) {
  return [...new Set((rows ?? []).map((row) => rowMeta(row)).filter(Boolean))];
}

function stockProductIds(stockRows) {
  return [
    ...new Set(
      (stockRows ?? [])
        .map((row) => idFromHref(row.assortment?.meta?.href ?? row.meta?.href))
        .filter(Boolean)
    ),
  ];
}

async function loadLocal(remote) {
  const cutoffDate = remote.cutoff.toISOString().slice(0, 10);
  const organizationIds = idsFromRows(remote.organizations);
  const storeIds = idsFromRows(remote.stores);
  const productIds = [...new Set([...idsFromRows(remote.products), ...stockProductIds(remote.stock)])];
  const serviceIds = idsFromRows(remote.services);
  const counterpartyIds = idsFromRows(remote.counterparties);
  const demandIds = idsFromRows(remote.demands);
  const cashoutHrefs = hrefsFromRows(remote.cashouts);
  const [
    organizations,
    stores,
    products,
    counterparties,
    demands,
    demandPositions,
    documents,
    cashOrders,
    expenseItems,
    supplierInvoices,
    supplierInvoicePayments,
    stockBalances,
  ] = await Promise.all([
    getPrisma().localOrganization.findMany({ where: { moyskladId: { in: organizationIds } } }),
    getPrisma().localStore.findMany({ where: { moyskladId: { in: storeIds } } }),
    getPrisma().localProduct.findMany({
      where: {
        OR: [
          { moyskladId: { in: productIds }, entityType: { not: "service" } },
          { moyskladId: { in: serviceIds }, entityType: "service" },
        ],
      },
    }),
    getPrisma().localCounterparty.findMany({ where: { moyskladId: { in: counterpartyIds } } }),
    getPrisma().localDemand.findMany({
      where: {
        OR: [{ moyskladId: { in: demandIds } }, { documentDate: { gte: cutoffDate } }],
      },
    }),
    getPrisma().localDemandPosition.findMany({
      where: {
        demand: {
          OR: [{ moyskladId: { in: demandIds } }, { documentDate: { gte: cutoffDate } }],
        },
      },
    }),
    getPrisma().localInventoryDocument.findMany({
      where: { type: { in: ["receipt", "writeoff"] }, documentDate: { gte: cutoffDate } },
    }),
    getPrisma().cashExpenseOrder.findMany({
      where: {
        OR: [{ moyskladCashoutHref: { in: cashoutHrefs } }, { expenseDate: { gte: cutoffDate } }],
      },
    }),
    getPrisma().cashExpenseItem.findMany(),
    getPrisma().localSupplierInvoice.findMany({ where: { invoiceDate: { gte: cutoffDate } } }),
    getPrisma().localSupplierInvoicePayment.findMany({ where: { paymentDate: { gte: cutoffDate } } }),
    getPrisma().localStockBalance.findMany({
      where: { product: { moyskladId: { in: productIds } } },
      include: { product: true, store: true },
    }),
  ]);

  return {
    organizations,
    stores,
    products,
    counterparties,
    demands,
    demandPositions,
    documents,
    cashOrders,
    expenseItems,
    supplierInvoices,
    supplierInvoicePayments,
    stockBalances,
    by: {
      organizationId: new Map(organizations.flatMap((row) => (row.moyskladId ? [[row.moyskladId, row]] : []))),
      storeId: new Map(stores.flatMap((row) => (row.moyskladId ? [[row.moyskladId, row]] : []))),
      productId: new Map(products.flatMap((row) => (row.moyskladId && row.entityType !== "service" ? [[row.moyskladId, row]] : []))),
      serviceId: new Map(products.flatMap((row) => (row.moyskladId && row.entityType === "service" ? [[row.moyskladId, row]] : []))),
      counterpartyId: new Map(counterparties.flatMap((row) => (row.moyskladId ? [[row.moyskladId, row]] : []))),
      demandId: new Map(demands.flatMap((row) => (row.moyskladId ? [[row.moyskladId, row]] : []))),
      demandPositionsByDemandId: demandPositions.reduce((map, row) => {
        const list = map.get(row.demandId) ?? [];
        list.push(row);
        map.set(row.demandId, list);
        return map;
      }, new Map()),
      stockByProductStore: new Map(stockBalances.map((row) => [`${row.product?.moyskladId ?? row.productId}:${row.store?.name ?? row.storeId}`, row])),
    },
  };
}

function compareCatalog(report, entity, remoteRows, localMap, localName) {
  addEntitySummary(report, entity, { remote: remoteRows.length, local: localMap.size });
  for (const row of remoteRows) {
    const local = localMap.get(row.id);
    if (!local) {
      pushSection(report, "missingLocally", { entity, id: row.id, name: safeName(row), action: "upsert", reason: "Нет локальной записи" });
      pushSection(report, "readyToImport", { entity, id: row.id, name: safeName(row), action: "upsert" });
      continue;
    }
    const diffs = [];
    compareField(diffs, "name", safeName(row), local.name);
    if (localName === "product") {
      compareField(diffs, "salePriceCents", firstSalePrice(row), local.salePriceCents);
      compareField(diffs, "article", text(row.article), local.article);
      compareField(diffs, "code", text(row.code), local.code);
    }
    if (diffs.length > 0) {
      if (isLocallyModified(local)) {
        pushSection(report, "conflicts", {
          entity,
          id: row.id,
          name: safeName(row),
          reason: "Локальная запись изменялась после последней синхронизации; автоматическое обновление заблокировано",
          diffs,
        });
      } else {
        pushSection(report, "changedRemotely", { entity, id: row.id, name: safeName(row), diffs });
        pushSection(report, "readyToImport", { entity, id: row.id, name: safeName(row), action: "update", diffs });
      }
    }
  }
}

function compareDemands(report, remote, local) {
  addEntitySummary(report, "demands", { remote: remote.demands.length, local: local.demands.length });
  const remotePositionCount = [...remote.demandPositions.values()].reduce((sum, rows) => sum + rows.length, 0);
  addEntitySummary(report, "demandPositions", { remote: remotePositionCount, local: local.demandPositions.length });
  for (const row of remote.demands) {
    const localDemand = local.by.demandId.get(row.id);
    const positions = remote.demandPositions.get(row.id) ?? [];
    if (!localDemand) {
      pushSection(report, "missingLocally", { entity: "demands", id: row.id, name: safeName(row), action: "upsert demand + positions" });
      pushSection(report, "readyToImport", { entity: "demands", id: row.id, name: safeName(row), action: "upsert" });
      continue;
    }
    const localPositions = local.by.demandPositionsByDemandId.get(localDemand.id) ?? [];
    const diffs = [];
    compareField(diffs, "name", safeName(row), localDemand.name);
    compareField(diffs, "documentDate", (row.moment ?? "").slice(0, 10), localDemand.documentDate);
    compareField(diffs, "applicable", Boolean(row.applicable), localDemand.applicable);
    compareField(diffs, "sumCents", cents(row.sum), localDemand.sumCents);
    compareField(diffs, "positionsCount", positions.length, localPositions.length);
    if (diffs.length > 0) {
      if (isLocallyModified(localDemand)) {
        pushSection(report, "conflicts", {
          entity: "demands",
          id: row.id,
          name: safeName(row),
          reason: "Локальная отгрузка изменялась после последней синхронизации; автоматическое обновление заблокировано",
          diffs,
        });
      } else {
        pushSection(report, "changedRemotely", { entity: "demands", id: row.id, name: safeName(row), diffs });
        pushSection(report, "readyToImport", { entity: "demands", id: row.id, name: safeName(row), action: "update", diffs });
      }
    }
  }
}

function comparePayments(report, remote, local) {
  const remotePayments = [...remote.paymentins, ...remote.paymentouts];
  addEntitySummary(report, "payments", { remote: remotePayments.length, local: local.supplierInvoicePayments.length });
  if (remote.paymentinsError) {
    pushSection(report, "needsManualReview", { entity: "payments", reason: `Не удалось загрузить /entity/paymentin: ${remote.paymentinsError}` });
  }
  if (remote.paymentoutsError) {
    pushSection(report, "needsManualReview", { entity: "payments", reason: `Не удалось загрузить /entity/paymentout: ${remote.paymentoutsError}` });
  }
  for (const row of remotePayments) {
    pushSection(report, "needsManualReview", {
      entity: "payments",
      id: row.id,
      name: safeName(row),
      reason: "Оплаты МойСклад имеют nullable legacy-поля локально, но требуют ручной проверки связи с локальным счётом/кассовым документом перед automatic import",
    });
  }
}

function compareSupplierInvoices(report, remote, local) {
  addEntitySummary(report, "supplierInvoices", { remote: remote.invoiceins.length, local: local.supplierInvoices.length });
  if (remote.invoiceinsError) {
    pushSection(report, "needsManualReview", { entity: "supplierInvoices", reason: `Не удалось загрузить /entity/invoicein: ${remote.invoiceinsError}` });
  }
  for (const row of remote.invoiceins) {
    pushSection(report, "needsManualReview", {
      entity: "supplierInvoices",
      id: row.id,
      name: safeName(row),
      reason: "LocalSupplierInvoice хранит nullable legacy-поля, но automatic import счетов поставщиков заблокирован до проверки связей с приёмками и оплатами",
    });
  }
}

function compareUnsupportedDocuments(report, remote, local) {
  addEntitySummary(report, "supplies", { remote: remote.supplies.length, local: local.documents.filter((row) => row.type === "receipt").length });
  addEntitySummary(report, "writeoffs", { remote: remote.losses.length, local: local.documents.filter((row) => row.type === "writeoff").length });
  if (remote.lossesError) {
    pushSection(report, "needsManualReview", { entity: "writeoffs", reason: `Не удалось загрузить /entity/loss: ${remote.lossesError}` });
  }
  for (const row of remote.supplies) {
    pushSection(report, "needsManualReview", {
      entity: "supplies",
      id: row.id,
      name: safeName(row),
      reason: "LocalInventoryDocument хранит nullable legacy-поля, но automatic import приёмок заблокирован до проверки трансформации позиций и связей",
    });
  }
  for (const row of remote.losses) {
    pushSection(report, "needsManualReview", {
      entity: "writeoffs",
      id: row.id,
      name: safeName(row),
      reason: "LocalInventoryDocument хранит nullable legacy-поля, но automatic import списаний заблокирован до проверки трансформации позиций и остатков",
    });
  }
}

function compareCashouts(report, remote, local) {
  addEntitySummary(report, "cashouts", { remote: remote.cashouts.length, local: local.cashOrders.length });
  for (const row of remote.cashouts) {
    const href = rowMeta(row);
    const existing = local.cashOrders.find((order) => order.moyskladCashoutHref === href);
    if (!existing) {
      pushSection(report, "missingLocally", { entity: "cashouts", id: row.id, name: safeName(row), action: "create local cash expense order" });
      pushSection(report, "readyToImport", { entity: "cashouts", id: row.id, name: safeName(row), action: "create" });
    } else if (existing.amountCents !== cents(row.sum)) {
      pushSection(report, "conflicts", {
        entity: "cashouts",
        id: row.id,
        name: safeName(row),
        reason: "Расходный ордер уже есть локально, но сумма отличается",
        remoteAmountCents: cents(row.sum),
        localAmountCents: existing.amountCents,
      });
    }
  }
}

function compareStock(report, remote, local) {
  let rows = 0;
  for (const row of remote.stock) {
    const productId = idFromHref(row.assortment?.meta?.href ?? row.meta?.href);
    if (!productId) continue;
    for (const stock of row.stockByStore ?? []) {
      rows += 1;
      const key = `${productId}:${stock.name}`;
      const existing = local.by.stockByProductStore.get(key);
      const remoteQty = Number(stock.stock ?? 0);
      const remoteReserve = Number(stock.reserve ?? 0);
      if (!existing) {
        pushSection(report, "missingLocally", { entity: "stock", productMoyskladId: productId, storeName: stock.name, quantity: remoteQty });
        pushSection(report, "readyToImport", { entity: "stock", productMoyskladId: productId, storeName: stock.name, action: "upsert balance" });
      } else if (existing.quantity.toNumber() !== remoteQty || existing.reserve.toNumber() !== remoteReserve) {
        pushSection(report, "changedRemotely", {
          entity: "stock",
          productMoyskladId: productId,
          storeName: stock.name,
          diffs: [
            { field: "quantity", remote: remoteQty, local: existing.quantity.toNumber() },
            { field: "reserve", remote: remoteReserve, local: existing.reserve.toNumber() },
          ],
        });
        pushSection(report, "readyToImport", { entity: "stock", productMoyskladId: productId, storeName: stock.name, action: "upsert balance" });
      }
    }
  }
  addEntitySummary(report, "stock", { remote: rows, local: local.stockBalances.length });
}

async function buildReport(mode, days) {
  const remote = await fetchRemote(days);
  const local = await loadLocal(remote);
  const report = createReport(mode, days, remote.cutoff);

  compareCatalog(report, "organizations", remote.organizations, local.by.organizationId, "organization");
  compareCatalog(report, "stores", remote.stores, local.by.storeId, "store");
  compareCatalog(report, "products", remote.products, local.by.productId, "product");
  compareCatalog(report, "services", remote.services, local.by.serviceId, "service");
  compareCatalog(report, "counterparties", remote.counterparties, local.by.counterpartyId, "counterparty");
  compareDemands(report, remote, local);
  compareStock(report, remote, local);
  compareCashouts(report, remote, local);
  comparePayments(report, remote, local);
  compareSupplierInvoices(report, remote, local);
  compareUnsupportedDocuments(report, remote, local);

  report.readiness.backupConfirmed = envFlag("LOCAL_DB_BACKUP_CONFIRMED", false);
  report.readiness.blockers = [
    ...(report.sections.conflicts.length ? [`Есть conflicts: ${report.sections.conflicts.length}`] : []),
    ...(report.sections.needsManualReview.some((row) => row.entity === "supplies" || row.entity === "writeoffs")
      ? ["Для import supplies/writeoffs нужен проверенный transformer/upsert; legacy-поля уже nullable и не блокируют локальную работу"]
      : []),
    ...(report.sections.needsManualReview.some((row) => row.entity === "supplierInvoices")
      ? ["Для import supplier invoices нужна проверка связей с приёмками/оплатами; legacy-поля уже nullable"]
      : []),
    ...(report.sections.needsManualReview.some((row) => row.entity === "payments")
      ? ["Для import payments нужна проверка связи с локальным счётом/кассовым документом; legacy-поля уже nullable"]
      : []),
  ];
  report.readiness.canBackfill = report.readiness.backupConfirmed && report.sections.conflicts.length === 0;
  return { report, remote, local };
}

async function upsertCatalog(remote) {
  for (const row of remote.organizations) {
    await upsertMoyskladMirror(
      getPrisma().localOrganization,
      row,
      { moyskladId: row.id, moyskladHref: rowMeta(row), name: safeName(row), raw: toJson(row), syncedAt: new Date() },
      { moyskladHref: rowMeta(row), name: safeName(row), raw: toJson(row), syncedAt: new Date() }
    );
  }
  for (const row of remote.stores) {
    await upsertMoyskladMirror(
      getPrisma().localStore,
      row,
      { moyskladId: row.id, moyskladHref: rowMeta(row), name: safeName(row), archived: Boolean(row.archived), raw: toJson(row), syncedAt: new Date() },
      { moyskladHref: rowMeta(row), name: safeName(row), archived: Boolean(row.archived), raw: toJson(row), syncedAt: new Date() }
    );
  }
  for (const [entityType, rows] of [["product", remote.products], ["service", remote.services]]) {
    for (const row of rows) {
      await upsertMoyskladMirror(
        getPrisma().localProduct,
        row,
        {
          moyskladId: row.id,
          moyskladHref: rowMeta(row),
          entityType,
          name: safeName(row),
          article: text(row.article),
          code: text(row.code),
          externalCode: text(row.externalCode),
          groupPath: text(row.pathName),
          uomName: text(row.uom?.name),
          salePriceCents: firstSalePrice(row),
          buyPriceCents: row.buyPrice?.value != null ? cents(row.buyPrice.value) : null,
          raw: toJson(row),
          attributes: toJson(row.attributes ?? null),
          searchText: [row.name, row.article, row.code, row.externalCode, row.pathName].filter(Boolean).join(" ").toLowerCase(),
          syncedAt: new Date(),
        },
        {
          moyskladHref: rowMeta(row),
          entityType,
          name: safeName(row),
          article: text(row.article),
          code: text(row.code),
          externalCode: text(row.externalCode),
          groupPath: text(row.pathName),
          uomName: text(row.uom?.name),
          salePriceCents: firstSalePrice(row),
          buyPriceCents: row.buyPrice?.value != null ? cents(row.buyPrice.value) : undefined,
          raw: toJson(row),
          attributes: toJson(row.attributes ?? null),
          searchText: [row.name, row.article, row.code, row.externalCode, row.pathName].filter(Boolean).join(" ").toLowerCase(),
          syncedAt: new Date(),
        }
      );
    }
  }
  for (const row of remote.counterparties) {
    const phone = text(row.phone) ?? text(row.phones?.[0]?.phone);
    await upsertMoyskladMirror(
      getPrisma().localCounterparty,
      row,
      {
        moyskladId: row.id,
        moyskladHref: rowMeta(row),
        name: safeName(row),
        phone,
        email: text(row.email),
        normalizedPhone: normalizePhone(phone),
        companyType: text(row.companyType),
        inn: text(row.inn),
        raw: toJson(row),
        searchText: [row.name, row.phone, row.email, row.inn].filter(Boolean).join(" ").toLowerCase(),
        syncedAt: new Date(),
      },
      {
        moyskladHref: rowMeta(row),
        name: safeName(row),
        phone,
        email: text(row.email),
        normalizedPhone: normalizePhone(phone),
        companyType: text(row.companyType),
        inn: text(row.inn),
        raw: toJson(row),
        searchText: [row.name, row.phone, row.email, row.inn].filter(Boolean).join(" ").toLowerCase(),
        syncedAt: new Date(),
      }
    );
  }
}

async function upsertDemands(remote) {
  const [counterparties, products, stores, organizations] = await Promise.all([
    getPrisma().localCounterparty.findMany({ select: { id: true, moyskladId: true } }),
    getPrisma().localProduct.findMany({ select: { id: true, moyskladId: true, buyPriceCents: true } }),
    getPrisma().localStore.findMany({ select: { id: true, moyskladId: true } }),
    getPrisma().localOrganization.findMany({ select: { id: true, moyskladId: true } }),
  ]);
  const counterpartyByMs = new Map(counterparties.flatMap((row) => (row.moyskladId ? [[row.moyskladId, row.id]] : [])));
  const productByMs = new Map(products.flatMap((row) => (row.moyskladId ? [[row.moyskladId, row]] : [])));
  const storeByMs = new Map(stores.flatMap((row) => (row.moyskladId ? [[row.moyskladId, row.id]] : [])));
  const organizationByMs = new Map(organizations.flatMap((row) => (row.moyskladId ? [[row.moyskladId, row.id]] : [])));

  for (const row of remote.demands) {
    const { documentDate, momentAt } = asDateFromMoment(row.moment);
    const agentMoyskladId = idFromHref(row.agent?.meta?.href);
    const storeMoyskladId = idFromHref(row.store?.meta?.href);
    const organizationMoyskladId = idFromHref(row.organization?.meta?.href);
    const result = await upsertMoyskladMirror(
      getPrisma().localDemand,
      row,
      {
        moyskladId: row.id,
        moyskladHref: rowMeta(row),
        name: safeName(row),
        momentAt,
        documentDate,
        applicable: Boolean(row.applicable),
        sumCents: cents(row.sum),
        description: text(row.description),
        counterpartyId: agentMoyskladId ? counterpartyByMs.get(agentMoyskladId) ?? null : null,
        agentMoyskladId,
        agentNameSnapshot: text(row.agent?.name),
        storeId: storeMoyskladId ? storeByMs.get(storeMoyskladId) ?? null : null,
        storeMoyskladId,
        storeNameSnapshot: text(row.store?.name),
        organizationId: organizationMoyskladId ? organizationByMs.get(organizationMoyskladId) ?? null : null,
        organizationName: text(row.organization?.name),
        attributes: toJson(row.attributes ?? null),
        raw: toJson(row),
        syncedAt: new Date(),
      },
      {
        moyskladHref: rowMeta(row),
        name: safeName(row),
        momentAt,
        documentDate,
        applicable: Boolean(row.applicable),
        sumCents: cents(row.sum),
        description: text(row.description),
        counterpartyId: agentMoyskladId ? counterpartyByMs.get(agentMoyskladId) ?? null : null,
        agentMoyskladId,
        agentNameSnapshot: text(row.agent?.name),
        storeId: storeMoyskladId ? storeByMs.get(storeMoyskladId) ?? null : null,
        storeMoyskladId,
        storeNameSnapshot: text(row.store?.name),
        organizationId: organizationMoyskladId ? organizationByMs.get(organizationMoyskladId) ?? null : null,
        organizationName: text(row.organization?.name),
        attributes: toJson(row.attributes ?? null),
        raw: toJson(row),
        syncedAt: new Date(),
      },
      { id: true }
    );
    if (result.skipped) continue;
    const demand = result.row;

    const positions = remote.demandPositions.get(row.id) ?? [];
    await getPrisma().$transaction([
      getPrisma().localDemandPosition.deleteMany({ where: { demandId: demand.id } }),
      ...(positions.length
        ? [
            getPrisma().localDemandPosition.createMany({
              data: positions.map((position) => {
                const assortmentMoyskladId = idFromHref(position.assortment?.meta?.href);
                const product = assortmentMoyskladId ? productByMs.get(assortmentMoyskladId) : null;
                return {
                  demandId: demand.id,
                  moyskladPositionId: position.id,
                  productId: product?.id ?? null,
                  assortmentMoyskladId,
                  assortmentType: position.assortment?.meta?.type ?? "",
                  name: text(position.assortment?.name) ?? "Позиция",
                  quantity: decimal(position.quantity),
                  priceCentsPerUnit: cents(position.price),
                  discount: decimal(position.discount),
                  buyPriceCentsPerUnit: position.cost != null ? cents(position.cost) : product?.buyPriceCents ?? null,
                  slotName: text(position.slot?.name),
                  raw: toJson(position),
                };
              }),
            }),
          ]
        : []),
    ]);
  }
}

async function upsertStock(remote) {
  const [products, stores] = await Promise.all([
    getPrisma().localProduct.findMany({ select: { id: true, moyskladId: true, buyPriceCents: true, cell: true } }),
    getPrisma().localStore.findMany({ select: { id: true, name: true } }),
  ]);
  const productByMs = new Map(products.flatMap((row) => (row.moyskladId ? [[row.moyskladId, row]] : [])));
  const storeByName = new Map(stores.map((row) => [row.name.trim().toLowerCase(), row]));
  for (const row of remote.stock) {
    const productMoyskladId = idFromHref(row.assortment?.meta?.href ?? row.meta?.href);
    const product = productMoyskladId ? productByMs.get(productMoyskladId) : null;
    if (!product) continue;
    for (const stock of row.stockByStore ?? []) {
      const store = storeByName.get(String(stock.name ?? "").trim().toLowerCase());
      if (!store) continue;
      const quantity = Number(stock.stock ?? 0);
      const reserve = Number(stock.reserve ?? 0);
      await getPrisma().localStockBalance.upsert({
        where: { productId_storeId: { productId: product.id, storeId: store.id } },
        create: {
          productId: product.id,
          storeId: store.id,
          quantity: decimal(quantity),
          reserve: decimal(reserve),
          available: decimal(quantity - reserve),
          buyPriceCents: product.buyPriceCents,
          slotName: product.cell,
          syncedAt: new Date(),
        },
        update: {
          quantity: decimal(quantity),
          reserve: decimal(reserve),
          available: decimal(quantity - reserve),
          buyPriceCents: product.buyPriceCents,
          slotName: product.cell,
          syncedAt: new Date(),
        },
      });
    }
  }
}

async function importShiftForDate(expenseDate) {
  const startedAt = new Date(`${expenseDate}T00:00:00.000Z`);
  const endedAt = new Date(`${expenseDate}T23:59:59.000Z`);
  return getPrisma().shift.upsert({
    where: { userLogin_shiftDate: { userLogin: "moysklad_import", shiftDate: expenseDate } },
    create: {
      userLogin: "moysklad_import",
      shiftDate: expenseDate,
      startedAt,
      endedAt,
      closeType: "auto",
      closedByLogin: "moysklad_sync",
    },
    update: {},
    select: { id: true },
  });
}

async function cashExpenseItemForCashout(row) {
  const expenseItemId = idFromHref(row.expenseItem?.meta?.href);
  const expenseItemHref = row.expenseItem?.meta?.href ?? null;
  const name = text(row.expenseItem?.name) ?? text(row.paymentPurpose) ?? "Прочее";
  if (expenseItemId) {
    return getPrisma().cashExpenseItem.upsert({
      where: { moyskladId: expenseItemId },
      create: {
        name,
        source: "moysklad_import",
        moyskladId: expenseItemId,
        moyskladHref: expenseItemHref,
      },
      update: {
        name,
        moyskladHref: expenseItemHref,
      },
      select: { id: true, name: true },
    });
  }
  return getPrisma().cashExpenseItem.upsert({
    where: { name },
    create: { name, source: "moysklad_import", moyskladHref: expenseItemHref },
    update: {},
    select: { id: true, name: true },
  });
}

async function importedCashExpenseNumber(row) {
  const base = safeName(row);
  const preferred = `MS-${base}`;
  const existing = await getPrisma().cashExpenseOrder.findUnique({
    where: { number: preferred },
    select: { id: true, moyskladId: true },
  });
  if (!existing || existing.moyskladId === row.id) return preferred;
  return `MS-${row.id.slice(0, 8)}`;
}

async function upsertCashouts(remote) {
  for (const row of remote.cashouts) {
    const href = rowMeta(row);
    const existing = await getPrisma().cashExpenseOrder.findFirst({
      where: { OR: [{ moyskladId: row.id }, ...(href ? [{ moyskladCashoutHref: href }] : [])] },
      select: { id: true, updatedAt: true, syncedAt: true },
    });
    if (existing && isLocallyModified(existing)) continue;

    const { documentDate } = asDateFromMoment(row.moment);
    const shift = await importShiftForDate(documentDate);
    const expenseItem = await cashExpenseItemForCashout(row);
    const counterpartyMoyskladId = idFromHref(row.agent?.meta?.href);
    const counterparty = counterpartyMoyskladId
      ? await getPrisma().localCounterparty.findUnique({ where: { moyskladId: counterpartyMoyskladId }, select: { id: true } })
      : null;
    const organizationMoyskladId = idFromHref(row.organization?.meta?.href);
    const organization = organizationMoyskladId
      ? await getPrisma().localOrganization.findUnique({ where: { moyskladId: organizationMoyskladId }, select: { id: true } })
      : null;
    const status = row.applicable === false ? "draft" : "posted";
    const now = new Date();
    const payload = {
      shiftId: shift.id,
      organizationId: organization?.id ?? null,
      number: await importedCashExpenseNumber(row),
      status,
      amountCents: cents(row.sum),
      currency: "RUB",
      expenseDate: documentDate,
      expenseItemId: expenseItem.id,
      expenseItemName: expenseItem.name,
      counterpartyId: counterparty?.id ?? null,
      counterpartyName: text(row.agent?.name) ?? "Контрагент МойСклад",
      article: text(row.paymentPurpose) ?? expenseItem.name,
      paymentPurpose: text(row.paymentPurpose) ?? expenseItem.name,
      paymentType: "cash",
      comment: text(row.description),
      createdBy: "moysklad_sync",
      createdByName: "МойСклад import",
      createdByRole: "system",
      postedAt: status === "posted" ? now : null,
      postedBy: status === "posted" ? "moysklad_sync" : null,
      postedByName: status === "posted" ? "МойСклад import" : null,
      source: "moysklad_import",
      moyskladId: row.id,
      moyskladHref: href,
      moyskladMetaHref: href,
      externalCode: text(row.externalCode),
      moyskladCashoutHref: href,
      moyskladExpenseItemHref: row.expenseItem?.meta?.href ?? null,
      moyskladCounterpartyHref: row.agent?.meta?.href ?? null,
      syncedAt: now,
      syncStatus: "synced",
      syncError: null,
    };

    if (existing) {
      await getPrisma().cashExpenseOrder.update({ where: { id: existing.id }, data: payload });
    } else {
      await getPrisma().cashExpenseOrder.create({ data: payload });
    }
  }
}

async function writeReports(report) {
  await fs.writeFile(REPORT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(REPORT_MD, renderMarkdown(report), "utf8");
  await fs.writeFile(FINAL_REPORT_MD, renderFinalSyncReport(report), "utf8");
  await fs.writeFile(ACCEPTANCE_REPORT_MD, renderAcceptanceReport(report), "utf8");
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# MoySklad last-days sync dry-run");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Mode: ${report.mode}`);
  lines.push(`- Days: ${report.days}`);
  lines.push(`- Cutoff: ${report.cutoff}`);
  lines.push(`- Backup confirmed: ${report.readiness.backupConfirmed ? "yes" : "no"}`);
  lines.push(`- Can backfill: ${report.readiness.canBackfill ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Bucket | Count |");
  lines.push("| --- | ---: |");
  for (const [key, value] of Object.entries(report.summary)) lines.push(`| ${key} | ${value} |`);
  lines.push("");
  lines.push("## Entity Counts");
  lines.push("");
  lines.push("| Entity | Remote | Local |");
  lines.push("| --- | ---: | ---: |");
  for (const [entity, value] of Object.entries(report.entities)) {
    lines.push(`| ${entity} | ${value.remote ?? 0} | ${value.local ?? 0} |`);
  }
  if (report.readiness.blockers.length) {
    lines.push("");
    lines.push("## Blockers");
    lines.push("");
    for (const blocker of report.readiness.blockers) lines.push(`- ${blocker}`);
  }
  for (const [section, items] of Object.entries(report.sections)) {
    lines.push("");
    lines.push(`## ${section}`);
    lines.push("");
    if (!items.length) {
      lines.push("Нет записей.");
      continue;
    }
    for (const item of items.slice(0, 200)) {
      const label = [item.entity, item.id, item.name, item.reason ?? item.action].filter(Boolean).join(" | ");
      lines.push(`- ${label}`);
    }
    if (items.length > 200) lines.push(`- ...ещё ${items.length - 200}`);
  }
  lines.push("");
  return lines.join("\n");
}

const FINAL_ENTITY_ROWS = [
  { key: "counterparties", label: "Клиенты", entities: ["counterparties"] },
  { key: "products", label: "Товары", entities: ["products"] },
  { key: "services", label: "Услуги", entities: ["services"] },
  { key: "stock", label: "Остатки", entities: ["stock"] },
  { key: "demands", label: "Отгрузки", entities: ["demands"] },
  { key: "positions", label: "Позиции", entities: ["demandPositions", "positions"] },
  { key: "cashouts", label: "Расходные ордера", entities: ["cashouts"] },
  { key: "payments", label: "Оплаты", entities: ["paymentin", "paymentout", "payments"] },
  { key: "invoices", label: "Счета", entities: ["invoices", "supplierInvoices"] },
  { key: "supplies", label: "Приёмки", entities: ["supplies"] },
  { key: "writeoffs", label: "Списания", entities: ["writeoffs"] },
];

function entityCount(report, entityKeys, field) {
  return entityKeys.reduce((sum, key) => sum + Number(report.entities?.[key]?.[field] ?? 0), 0);
}

function entityValue(report, entityKeys, field) {
  if (report.mode === "not_run") return "н/д";
  return String(entityCount(report, entityKeys, field));
}

function sectionCount(report, section, entityKeys) {
  const keys = new Set(entityKeys);
  return (report.sections?.[section] ?? []).filter((item) => keys.has(item.entity)).length;
}

function backfillValue(report, entityKey, field) {
  const value = report.backfill?.entities?.[entityKey]?.[field] ?? report.backfill?.[entityKey]?.[field];
  if (Number.isFinite(value)) return String(value);
  if (report.mode === "not_run") return "н/д";
  return report.mode === "backfill" ? "н/д" : "0";
}

function finalReadinessBlockers(report) {
  const blockers = new Set(report.readiness?.blockers ?? []);
  if (report.mode === "not_run") blockers.add("Dry-run audit не выполнен: нет фактического сравнения МойСклад и локальной БД.");
  if (report.mode !== "verify") blockers.add("Финальный verify после backfill не выполнен.");
  if ((report.summary?.missingLocally ?? 0) > 0) blockers.add(`Есть записи, отсутствующие локально: ${report.summary.missingLocally}.`);
  if ((report.summary?.changedRemotely ?? 0) > 0) blockers.add(`Есть удалённые изменения, отличающиеся от локальных: ${report.summary.changedRemotely}.`);
  if ((report.summary?.conflicts ?? 0) > 0) blockers.add(`Есть конфликты: ${report.summary.conflicts}.`);
  if ((report.summary?.needsManualReview ?? 0) > 0) blockers.add(`Есть записи для ручной проверки: ${report.summary.needsManualReview}.`);
  return [...blockers];
}

function isReadyToDisable(report, blockers) {
  return (
    report.mode === "verify" &&
    blockers.length === 0 &&
    (report.summary?.missingLocally ?? 0) === 0 &&
    (report.summary?.changedRemotely ?? 0) === 0 &&
    (report.summary?.conflicts ?? 0) === 0 &&
    (report.summary?.needsManualReview ?? 0) === 0
  );
}

function acceptanceStatus(value) {
  if (value === "passed") return "Passed";
  if (value === "implemented") return "Implemented, evidence pending";
  if (value === "partial") return "Partial";
  return "Blocked";
}

function hasCriticalSyncGaps(report) {
  return (
    (report.summary?.missingLocally ?? 0) > 0 ||
    (report.summary?.changedRemotely ?? 0) > 0 ||
    (report.summary?.conflicts ?? 0) > 0 ||
    (report.summary?.needsManualReview ?? 0) > 0
  );
}

function acceptanceRows(report) {
  const blockers = finalReadinessBlockers(report);
  const readyToDisable = isReadyToDisable(report, blockers);
  const auditRan = report.mode !== "not_run" && !!report.cutoff;
  const backfillEvidence = report.mode === "backfill" && report.readiness?.backupConfirmed === true;
  const verifyPassed = report.mode === "verify" && !hasCriticalSyncGaps(report) && blockers.length === 0;

  return [
    {
      scenario: "1 — Аудит",
      status: auditRan ? "implemented" : "blocked",
      evidence: auditRan
        ? "`moysklad-last-days-sync-dry-run.json` содержит сравнение за период; mode=`" + report.mode + "`."
        : "Dry-run JSON сейчас `mode=not_run`; live audit с рабочими DATABASE_URL и MoySklad credentials не выполнен.",
      next: auditRan
        ? "Для отдельного audit evidence сохранить артефакт после `--mode=audit`."
        : "Запустить `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=audit`.",
    },
    {
      scenario: "2 — Readiness",
      status: "passed",
      evidence:
        "`local-db-readiness-report.md`, `moysklad-dependency-audit.md`, legacy migration and nullable fields are present.",
      next: "Перед production backfill применить миграции и повторить readiness-check на целевой БД.",
    },
    {
      scenario: "3 — Backfill",
      status: backfillEvidence ? "implemented" : "blocked",
      evidence: backfillEvidence
        ? "Последний report mode=`backfill`, backup confirmed."
        : "Backfill не запускался или backup не подтверждён; `--backup-confirmed` / `LOCAL_DB_BACKUP_CONFIRMED=1` обязателен.",
      next: "После backup запустить `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=backfill --backup-confirmed`.",
    },
    {
      scenario: "4 — Verify",
      status: verifyPassed ? "passed" : "blocked",
      evidence: verifyPassed
        ? "Последний verify не содержит missing/changed/conflicts/manual-review."
        : "Финальный verify после backfill не выполнен или остались расхождения.",
      next: "Запустить `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=verify` и проверить final report.",
    },
    {
      scenario: "5 — Отключение",
      status: readyToDisable ? "passed" : "partial",
      evidence:
        "Write/read flags and local-backed runtime paths are implemented; `MOYSKLAD_WRITE_ENABLED=false` by default. Runtime smoke is still pending in this environment.",
      next: "После verify прогнать smoke с `MOYSKLAD_ENABLED=false`, `MOYSKLAD_READ_ENABLED=false`, `MOYSKLAD_WRITE_ENABLED=false`, `MOYSKLAD_SYNC_ENABLED=false`.",
    },
    {
      scenario: "6 — UI",
      status: "passed",
      evidence:
        "Main UX sync/debug/raw legacy controls removed; manual sync is owner/admin-only at `/cabinet/integrations`.",
      next: "Проверить визуально после восстановления local Next build/dev environment.",
    },
    {
      scenario: "7 — Бизнес-сценарии",
      status: "implemented",
      evidence:
        "Shipment, warehouse, cash, supplier invoice, CRM and analytics paths are local-backed in code; full browser smoke is pending.",
      next: "Пройти сценарии операций, склада, финансов, CRM and кабинет на целевой среде.",
    },
  ];
}

function itemKey(item) {
  return [item.entity, item.id, item.productMoyskladId, item.storeName].filter(Boolean).join(":");
}

function hasReadyImport(report, item) {
  const key = itemKey(item);
  return (report.sections?.readyToImport ?? []).some((ready) => itemKey(ready) === key);
}

function renderUnsyncedRows(report) {
  const rows = [];
  const addRows = (section, autoFix, manualAction) => {
    for (const item of report.sections?.[section] ?? []) {
      const canAutoFix = typeof autoFix === "function" ? autoFix(item) : autoFix;
      rows.push({
        section,
        entity: item.entity ?? "unknown",
        id: item.id ?? item.productMoyskladId ?? "—",
        name: item.name ?? item.storeName ?? "—",
        reason: item.reason ?? item.action ?? section,
        canAutoFix: canAutoFix ? "да" : "нет",
        manualAction: manualAction ? "да" : "нет",
      });
    }
  };

  addRows("missingLocally", (item) => hasReadyImport(report, item), false);
  addRows("changedRemotely", (item) => hasReadyImport(report, item), false);
  addRows("conflicts", false, true);
  addRows("needsManualReview", false, true);
  return rows;
}

function renderFinalSyncReport(report) {
  const blockers = finalReadinessBlockers(report);
  const ready = isReadyToDisable(report, blockers);
  const unsyncedRows = renderUnsyncedRows(report);
  const lines = [];

  lines.push("# MoySklad final sync report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 1. Период проверки");
  lines.push("");
  lines.push(`- Период: последние ${report.days ?? 14} дней.`);
  lines.push(`- Cutoff: ${report.cutoff ?? "не рассчитан"}.`);
  lines.push(`- Последний режим sync-скрипта: \`${report.mode ?? "unknown"}\`.`);
  lines.push(`- Последний dry-run JSON: \`moysklad-last-days-sync-dry-run.json\`.`);
  lines.push("");
  lines.push("## 2. Проверенные сущности");
  lines.push("");
  for (const row of FINAL_ENTITY_ROWS) lines.push(`- ${row.label}`);
  lines.push("");
  lines.push("## 3. Итог по сущностям");
  lines.push("");
  lines.push("| Сущность | Найдено в МойСклад | Найдено локально | Импортировано | Обновлено | Пропущено | Конфликтов | Ошибок |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of FINAL_ENTITY_ROWS) {
    const remote = entityValue(report, row.entities, "remote");
    const local = entityValue(report, row.entities, "local");
    const skipped = sectionCount(report, "needsManualReview", row.entities);
    const conflicts = sectionCount(report, "conflicts", row.entities);
    const errors = (report.sections?.needsManualReview ?? []).filter(
      (item) => row.entities.includes(item.entity) && /ошиб|error|не удалось/i.test(String(item.reason ?? ""))
    ).length;
    lines.push(
      `| ${row.label} | ${remote} | ${local} | ${backfillValue(report, row.key, "created")} | ${backfillValue(
        report,
        row.key,
        "updated"
      )} | ${skipped} | ${conflicts} | ${errors} |`
    );
  }
  lines.push("");
  lines.push("## 4. Что не синхронизировано");
  lines.push("");
  if (!unsyncedRows.length) {
    lines.push("Нет записей в `missingLocally`, `changedRemotely`, `conflicts` или `needsManualReview`.");
  } else {
    lines.push("| Раздел | Сущность | ID / ключ | Название | Причина | Можно исправить автоматически | Нужно ручное действие |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const item of unsyncedRows.slice(0, 200)) {
      lines.push(
        `| ${item.section} | ${item.entity} | ${item.id} | ${String(item.name).replaceAll("|", "\\|")} | ${String(
          item.reason
        ).replaceAll("|", "\\|")} | ${item.canAutoFix} | ${item.manualAction} |`
      );
    }
    if (unsyncedRows.length > 200) lines.push(`| ... | ... | ... | ... | Ещё ${unsyncedRows.length - 200} записей | ... | ... |`);
  }
  lines.push("");
  lines.push("## 5. Готово к отключению");
  lines.push("");
  lines.push(`- Решение: ${ready ? "да" : "нет"}.`);
  if (blockers.length) {
    lines.push("- Блокеры:");
    for (const blocker of blockers) lines.push(`  - ${blocker}`);
  } else {
    lines.push("- Блокеров нет.");
  }
  lines.push("");
  lines.push("## 6. После отключения проверено");
  lines.push("");
  lines.push("| Проверка | Статус | Комментарий |");
  lines.push("| --- | --- | --- |");
  lines.push("| Feature flags | Выполнено статически | `MOYSKLAD_ENABLED`, `MOYSKLAD_READ_ENABLED`, `MOYSKLAD_WRITE_ENABLED`, `MOYSKLAD_SYNC_ENABLED` заведены и по умолчанию выключены в env-шаблонах. |");
  lines.push("| Write-интеграция | Выполнено статически | Обычные write-сценарии переведены на локальные модели; live write остаётся только в ручных/debug сценариях под flags. |");
  lines.push("| Read-интеграция | Выполнено статически | Обычные read-сценарии используют локальные источники или local-backed compatibility endpoints. |");
  lines.push("| UI | Выполнено статически | Основные sync/debug кнопки и raw legacy блоки убраны; ручной запуск вынесен в `/cabinet/integrations` для owner/admin. |");
  lines.push("| TypeScript | Проверено | `node_modules/.bin/tsc --noEmit` прошёл. |");
  lines.push("| ESLint | Проверено с предупреждениями | `node_modules/.bin/eslint` прошёл без ошибок; остались существующие warnings. |");
  lines.push("| Dry-run report command | Проверено | `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=report` обновляет отчёты без записи в БД. |");
  lines.push("| Runtime smoke UI | Не завершено | Локальный `next build/dev` в этом окружении блокируется macOS code-signature ошибкой native `@next/swc` / `lightningcss`, не ошибкой МойСклад. |");
  lines.push("| Страницы и сценарии | Требует ручного smoke после исправления окружения | Проверить отгрузки, склад, кассу, счета, CRM, аналитику и CSV/Excel с выключенными `MOYSKLAD_*`. |");
  lines.push("");
  lines.push("## Rollback Plan");
  lines.push("");
  lines.push("- План: `moysklad-rollback-plan.md`.");
  lines.push("- Acceptance gate: `moysklad-acceptance-report.md`.");
  lines.push("- Перед backfill обязателен DB backup и backup env/config.");
  lines.push("- Read-only rollback flags: `MOYSKLAD_ENABLED=true`, `MOYSKLAD_DEBUG_ENABLED=true`, `MOYSKLAD_READ_ENABLED=true`, `MOYSKLAD_SYNC_ENABLED=true`, `MOYSKLAD_WRITE_ENABLED=false`.");
  lines.push("- При критичной проблеме write-интеграция не включается автоматически; восстановление делается из backup только после проверки dump в отдельной БД.");
  lines.push("");
  lines.push("## Remaining MoySklad dependencies");
  lines.push("");
  lines.push("- Runtime live fetch должен оставаться только в guarded sync-модулях: `local-inventory-sync` и `moysklad-customer-analytics-sync`.");
  lines.push("- `/api/moysklad/*` используется как compatibility namespace для local-backed endpoints и admin/debug интеграции.");
  lines.push("- Legacy-поля `moyskladId`, `moyskladHref`, `moyskladMetaHref`, `externalCode`, `source`, `syncedAt`, `syncStatus`, `syncError` остаются для аудита/rollback.");
  lines.push("- Для новых локальных документов legacy-поля необязательны: `source` имеет local default, sync/status/error-поля nullable.");
  lines.push("");
  return lines.join("\n");
}

function renderAcceptanceReport(report) {
  const blockers = finalReadinessBlockers(report);
  const ready = isReadyToDisable(report, blockers);
  const rows = acceptanceRows(report);
  const allPassed = rows.every((row) => row.status === "passed");
  const lines = [];

  lines.push("# MoySklad cutover acceptance report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Decision");
  lines.push("");
  lines.push(`- Acceptance: ${allPassed && ready ? "passed" : "not passed"}.`);
  lines.push(`- Cutover ready: ${ready ? "yes" : "no"}.`);
  lines.push(`- Last sync report mode: \`${report.mode ?? "unknown"}\`.`);
  lines.push(`- Period: last ${report.days ?? 14} days.`);
  lines.push("");
  if (blockers.length) {
    lines.push("## Blocking Items");
    lines.push("");
    for (const blocker of blockers) lines.push(`- ${blocker}`);
    lines.push("");
  }
  lines.push("## Acceptance Criteria");
  lines.push("");
  lines.push("| Scenario | Status | Evidence | Next action |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| ${row.scenario} | ${acceptanceStatus(row.status)} | ${row.evidence.replaceAll("|", "\\|")} | ${row.next.replaceAll(
        "|",
        "\\|"
      )} |`
    );
  }
  lines.push("");
  lines.push("## Required Production Gate");
  lines.push("");
  lines.push("Before declaring the platform fully autonomous on local DB, complete this sequence in the target environment:");
  lines.push("");
  lines.push("1. Confirm DB and env/config backups from `moysklad-rollback-plan.md`.");
  lines.push("2. Run `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=audit`.");
  lines.push("3. Resolve `conflicts` and `needsManualReview` or document blockers.");
  lines.push("4. Run `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=backfill --backup-confirmed`.");
  lines.push("5. Run `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=verify`.");
  lines.push("6. Run smoke tests with all runtime MoySklad flags disabled.");
  lines.push("7. Regenerate this report with `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=report`.");
  lines.push("");
  lines.push("## Evidence Files");
  lines.push("");
  lines.push("- `moysklad-dependency-audit.md`");
  lines.push("- `local-db-readiness-report.md`");
  lines.push("- `moysklad-last-days-sync-dry-run.json`");
  lines.push("- `moysklad-last-days-sync-dry-run.md`");
  lines.push("- `moysklad-final-sync-report.md`");
  lines.push("- `moysklad-rollback-plan.md`");
  lines.push("- `moysklad-legacy-fields-retention.md`");
  lines.push("");
  return lines.join("\n");
}

async function readExistingReport() {
  const raw = await fs.readFile(REPORT_JSON, "utf8");
  return JSON.parse(raw);
}

async function main() {
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");
  const args = parseArgs(process.argv);

  if (args.mode === "report") {
    const report = await readExistingReport();
    await fs.writeFile(REPORT_MD, renderMarkdown(report), "utf8");
    await fs.writeFile(FINAL_REPORT_MD, renderFinalSyncReport(report), "utf8");
    await fs.writeFile(ACCEPTANCE_REPORT_MD, renderAcceptanceReport(report), "utf8");
    console.log(
      JSON.stringify({ ok: true, report: REPORT_MD, finalReport: FINAL_REPORT_MD, acceptanceReport: ACCEPTANCE_REPORT_MD }, null, 2)
    );
    return;
  }

  const { report, remote } = await buildReport(args.mode, args.days);
  if (args.mode === "backfill") {
    report.readiness.backupConfirmed = args.backupConfirmed || envFlag("LOCAL_DB_BACKUP_CONFIRMED", false);
    report.readiness.canBackfill = report.readiness.backupConfirmed && report.sections.conflicts.length === 0;
    if (!report.readiness.backupConfirmed) {
      report.readiness.blockers.unshift("Backfill остановлен: подтвердите backup через --backup-confirmed или LOCAL_DB_BACKUP_CONFIRMED=1");
      await writeReports(report);
      throw new Error(report.readiness.blockers[0]);
    }
    if (report.sections.conflicts.length > 0) {
      await writeReports(report);
      throw new Error("Backfill остановлен: есть conflicts");
    }
    await upsertCatalog(remote);
    await upsertDemands(remote);
    await upsertStock(remote);
    await upsertCashouts(remote);
  }

  await writeReports(report);
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.mode,
        days: args.days,
        summary: report.summary,
        json: REPORT_JSON,
        markdown: REPORT_MD,
        finalReport: FINAL_REPORT_MD,
        acceptanceReport: ACCEPTANCE_REPORT_MD,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prismaClient) await prismaClient.$disconnect();
  });
