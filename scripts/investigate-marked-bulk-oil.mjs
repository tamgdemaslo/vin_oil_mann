#!/usr/bin/env node
/**
 * Read-only audit for marked motor oil sold by volume.
 *
 * The script reads local shipment/product data and AQSI receipts/orders for one
 * date. It intentionally does not mutate local DB, MoySklad, AQSI, OFD or GIS MT.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const GS = "\u001d";
const AQSI_UNIT_CODE_LITER = 41;
const AQSI_UNIT_CODE_PIECE = 0;
const AQSI_MARKING_TYPE_AUTO_FLUIDS = 34;
const PROBLEM_NAMES = ["Bardahl XTS 5W-30", "Bardahl XTS 5W-40"];
const args = process.argv.slice(2);
const COMPACT_OUTPUT = args.includes("--compact");
const BRIEF_OUTPUT = args.includes("--brief");
const TARGET_DATE = args.find((arg) => !arg.startsWith("--")) || localDateString(new Date());

function loadEnvFile(file) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) return;
  for (const line of fs.readFileSync(fullPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = match[2].replace(/^["']|["']$/g, "").trim();
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousDateString(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isLikelyFilterOrHardware(name) {
  const lower = normalizeName(name);
  return (
    /\bфильтр\b|\bfilter\b/i.test(lower) ||
    /маслян(ый|ого|ом)?\s+фильтр|фильтр\s+маслян/i.test(lower) ||
    /уплотнител|сливн\w*\s+пробк|пробк\w*\s+сливн|кольцо\s+сливн|прокладк|хомут|шайб|болт\s|гайк\s|поддон(\s|$)|пробка(\s|$)/i.test(lower)
  );
}

function isLikelyMarkedMotorOilProductName(name) {
  const lower = normalizeName(name);
  if (!lower || isLikelyFilterOrHardware(lower)) return false;
  return /моторное\s+масло|масло\s+моторное|трансмиссионн\w*\s+масл|масл\w*\s+трансмиссионн|трансмиссионн\w*\s+жидк|engine\s+oil|transmission\s+(oil|fluid)|gear\s+oil|auto\s*fluids?|atf|cvt|dct|dsg|dexron|mercon|gl-?\s*[45]|5w|0w|10w|15w|20w|sae|dexos|longlife|gf-|acea|api\s+[a-z]{1,2}/i.test(
    lower
  );
}

function isLikelyMeasuredMotorOilPourProductName(name) {
  const lower = normalizeName(name);
  if (!isLikelyMarkedMotorOilProductName(lower)) return false;
  return /розлив|разлив|бочк|налив|bulk/i.test(lower);
}

function isLiterUnitName(value) {
  const lower = normalizeName(value ?? "");
  return /^(л|л\.|литр|литра|литров|l|liter|litre)$/i.test(lower);
}

function isLikelyBulkMotorOilProductCandidate(context) {
  if (!context) return false;
  const text = `${context.productName ?? ""} ${context.groupPath ?? ""}`;
  if (!isLikelyMarkedMotorOilProductName(text)) return false;
  return /розлив|разлив|бочк|налив|bulk/i.test(text);
}

function isLikelyBulkMotorOilProductContext(context) {
  return isLikelyBulkMotorOilProductCandidate(context) && isLiterUnitName(context?.uomName);
}

function productMarkingContext(product, fallbackName = "") {
  return {
    productName: product?.name ?? fallbackName,
    groupPath: product?.groupPath,
    uomName: product?.uomName,
  };
}

function isMeasuredMotorOilQuantity(name, quantity, context) {
  if (!isLikelyMarkedMotorOilProductName(name)) return false;
  if (isLikelyBulkMotorOilProductContext(context)) return true;
  if (isLikelyMeasuredMotorOilPourProductName(name)) return true;
  return Number.isFinite(quantity) && quantity > 0 && !Number.isInteger(quantity);
}

function decimalToNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asMoney(cents) {
  return Math.round(Number(cents ?? 0)) / 100;
}

function safeJson(value, depth = 0) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return depth > 2 ? `[${value.length} items]` : value.slice(0, 10).map((item) => safeJson(item, depth + 1));
  }
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 60)) {
    if (/token|password|authorization|api.?key/i.test(key)) continue;
    out[key] = depth > 2 ? summarizeValue(raw) : safeJson(raw, depth + 1);
  }
  return out;
}

function summarizeValue(value) {
  if (value == null) return value;
  if (typeof value === "string") return value.length > 180 ? `${value.slice(0, 180)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return `{${Object.keys(value).slice(0, 10).join(", ")}}`;
  return String(value);
}

function collectStrings(value, pathPrefix = "", out = []) {
  if (value == null) return out;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push({ path: pathPrefix, value: String(value) });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${pathPrefix}[${index}]`, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      collectStrings(item, pathPrefix ? `${pathPrefix}.${key}` : key, out);
    }
  }
  return out;
}

function findRawHints(value, patterns) {
  return collectStrings(value)
    .filter((entry) => patterns.some((pattern) => pattern.test(entry.path) || pattern.test(entry.value)))
    .slice(0, 80);
}

function extractGtinFromCode(code) {
  const normalized = String(code ?? "").replace(/\\u001d|\\x1d|\[gs\]|\(gs\)|\{gs\}|<gs>|<fnc1>|\[fnc1\]/gi, GS);
  const match = normalized.match(/01(\d{14})/);
  return match?.[1] ?? null;
}

function hasGs(code) {
  const value = String(code ?? "");
  return value.includes(GS) || /\\u001d|\\x1d|\[gs\]|\(gs\)|\{gs\}|<gs>|<fnc1>|\[fnc1\]/i.test(value);
}

function maskCode(code) {
  const value = String(code ?? "");
  if (!value) return null;
  const visible = value.replace(/\u001d/g, "<GS>");
  if (visible.length <= 18) return visible;
  return `${visible.slice(0, 18)}...${visible.slice(-8)}`;
}

function customerType(counterparty) {
  if (!counterparty) return "не указан";
  const companyType = normalizeName(counterparty.companyType);
  const typeName = normalizeName(counterparty.counterpartyTypeName);
  const legalTitle = normalizeName(counterparty.legalTitle);
  if (companyType.includes("individual") || typeName.includes("физ") || !counterparty.inn) return "физлицо";
  if (companyType.includes("entrepreneur") || typeName.includes("ип") || legalTitle.startsWith("ип ")) return "ИП";
  if (counterparty.inn || counterparty.kpp || legalTitle) return "юрлицо";
  return "не определён";
}

function normalizeAqsiList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const key of ["rows", "items", "data", "list", "receipts", "orders", "result"]) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function buildAqsiUrl(baseUrl, pathOrUrl) {
  return pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${baseUrl.replace(/\/+$/, "")}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

async function aqsiFetchJson(url, apiKey, init = {}) {
  const keyHeader = apiKey.startsWith("Application ") ? apiKey : `Application ${apiKey}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-client-key": keyHeader,
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, text: text.slice(0, 500) };
  }
  if (!text.trim()) return { ok: true, data: null };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, text: text.slice(0, 500) };
  }
}

async function loadAqsiForDate(dateString) {
  const apiKey = process.env.AQSI_API_KEY?.trim();
  if (!apiKey) return { enabled: false, error: "AQSI_API_KEY is not configured" };

  const baseUrl = process.env.AQSI_BASE_URL?.trim() || "https://api.aqsi.ru/pub";
  const receiptsPath = process.env.AQSI_ORDERS_PATH?.trim() || "/v2/Receipts";
  const pendingPath = process.env.AQSI_PENDING_ORDER_PATH?.trim() || "/v2/Orders/simple";
  const paths = [
    { type: "receipts", path: receiptsPath, dateParams: true },
    { type: "pendingOrders", path: pendingPath, dateParams: false },
  ];
  const result = { enabled: true, baseUrl, paths: [] };

  for (const entry of paths) {
    const url = new URL(buildAqsiUrl(baseUrl, entry.path));
    if (entry.dateParams) {
      url.searchParams.set("filtered.beginDate", `${dateString}T00:00:00`);
      url.searchParams.set("filtered.endDate", `${dateString}T23:59:59`);
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("page", "0");
    }
    const fetched = await aqsiFetchJson(url.toString(), apiKey);
    if (!fetched.ok) {
      result.paths.push({ type: entry.type, ok: false, status: fetched.status, error: fetched.text });
      continue;
    }
    const rows = normalizeAqsiList(fetched.data);
    result.paths.push({ type: entry.type, ok: true, count: rows.length, rows });
  }

  return result;
}

function aqsiPositionsFromRecord(record) {
  const positions =
    record?.content?.positions ??
    record?.content?.checkPositions ??
    record?.positions ??
    record?.items ??
    record?.goods ??
    record?.receipt?.positions ??
    [];
  return Array.isArray(positions) ? positions : [];
}

function summarizeAqsiPosition(position) {
  const itemCode = position.itemCode ?? position.item_code ?? position.markingCode ?? position.marking_code ?? position.nomenclatureCode;
  const quantity = position.quantity ?? position.qty ?? position.count;
  const unitCode = position.unitCode ?? position.unit_code ?? position.measure ?? position.measureCode;
  const unitOfMeasurement = position.unitOfMeasurement ?? position.unit ?? position.measureName;
  const isWeight = position.isWeight ?? position.is_weight;
  return {
    text: position.text ?? position.name ?? position.title ?? null,
    quantity,
    price: position.price ?? position.sum ?? position.amount ?? null,
    paymentSubjectType: position.paymentSubjectType ?? position.payment_subject_type ?? null,
    markingType: position.markingType ?? position.marking_type ?? null,
    itemCodeMasked: maskCode(itemCode),
    itemCodeLength: itemCode ? String(itemCode).length : 0,
    itemCodeHasGs: hasGs(itemCode),
    gtin: extractGtinFromCode(itemCode),
    unitOfMeasurement,
    unitCode,
    isWeight,
    looksPartialLiter:
      Number(unitCode) === AQSI_UNIT_CODE_LITER ||
      normalizeName(unitOfMeasurement).includes("litre") ||
      normalizeName(unitOfMeasurement).includes("литр") ||
      Number(isWeight) === 1,
    looksPiece:
      Number(unitCode) === AQSI_UNIT_CODE_PIECE ||
      normalizeName(unitOfMeasurement).includes("piece") ||
      normalizeName(unitOfMeasurement).includes("шт"),
    raw: safeJson(position, 1),
  };
}

function findAqsiMatches(aqsi, demand, positionNames) {
  if (!aqsi?.enabled) return [];
  const demandId = demand.id;
  const demandName = demand.name;
  const matches = [];

  for (const pathResult of aqsi.paths ?? []) {
    if (!pathResult.ok) continue;
    for (const record of pathResult.rows ?? []) {
      const strings = collectStrings(record).map((entry) => entry.value);
      const hasDemandRef = strings.some((value) => value === demandId || value === demandName || value.includes(demandId) || value.includes(demandName));
      const positions = aqsiPositionsFromRecord(record);
      const positionMatches = positions
        .map((position) => summarizeAqsiPosition(position))
        .filter((position) => {
          const text = normalizeName(position.text);
          return positionNames.some((name) => text && normalizeName(name).includes(text) || text.includes(normalizeName(name))) || position.itemCodeLength > 0;
        });

      if (hasDemandRef || positionMatches.length > 0) {
        matches.push({
          source: pathResult.type,
          recordId: record.id ?? record.uid ?? record.uuid ?? null,
          number: record.number ?? record.documentNumber ?? record.receiptNumber ?? null,
          status: record.status ?? record.state ?? record.operationStatus ?? null,
          dateTime: record.dateTime ?? record.createdAt ?? record.created_at ?? record.closeDate ?? null,
          hasDemandRef,
          positions: positionMatches,
          rawHints: findRawHints(record, [/itemCode|marking|unitCode|unitOfMeasurement|isWeight|paymentSubjectType|markingType|Bardahl|5W-30|5W-40/i]),
        });
      }
    }
  }

  return matches;
}

function inferProductScenario(product) {
  const name = product?.name ?? "";
  const uom = product?.uomName ?? "";
  const group = product?.groupPath ?? "";
  const markedByName = isLikelyMarkedMotorOilProductName(name);
  const bulkByName = isLikelyMeasuredMotorOilPourProductName(name) || /розлив|разлив|бочк|налив/i.test(`${group} ${uom}`);
  const literUnit = isLiterUnitName(uom) || /литр|litre|liter/i.test(String(uom));
  if (!markedByName) return "Не маркируется/не моторное масло по текущей эвристике";
  if (bulkByName && literUnit) return "Масло на разлив из бочки по названию/группе и единице";
  if (bulkByName && !literUnit) return "Опасно: похоже на разлив, но единица не литр";
  if (markedByName) return "Обычная маркированная упаковка по текущей эвристике";
  return "Требует настройки";
}

function productSummary(product) {
  if (!product) return null;
  const markingSettings =
    product.markingSettings && typeof product.markingSettings === "object"
      ? {
          ...product.markingSettings,
          activeBarrelMarkingCode: maskCode(product.markingSettings.activeBarrelMarkingCode),
        }
      : null;
  return {
    id: product.id,
    moyskladId: product.moyskladId,
    name: product.name,
    article: product.article,
    code: product.code,
    externalCode: product.externalCode,
    entityType: product.entityType,
    groupPath: product.groupPath,
    uomName: product.uomName,
    brand: product.brand,
    sae: product.sae,
    packageVolume: product.packageVolume,
    volume: product.volume == null ? null : String(product.volume),
    barcodeEan13: product.barcodeEan13,
    gtinFromBarcode: product.barcodeEan13,
    markingEnabled: product.markingEnabled,
    markingMode: product.markingMode,
    markingStatus: product.markingStatus,
    markingSettings,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    inferredScenario: inferProductScenario(product),
    stockBalances: product.stockBalances?.map((balance) => ({
      store: balance.store?.name ?? balance.storeId,
      quantity: String(balance.quantity),
      available: String(balance.available),
      reserve: String(balance.reserve),
    })),
    rawHints: findRawHints(product.raw, [/mark|маркир|gtin|код|единиц|uom|measure|объем|объ.м|volume|каталог|national|bottle|barrel|боч|розлив|разлив/i]),
    attributesHints: findRawHints(product.attributes, [/mark|маркир|gtin|код|единиц|uom|measure|объем|volume|каталог|national|bottle|barrel|боч|розлив|разлив/i]),
  };
}

function compactProduct(product) {
  if (!product) return null;
  return {
    id: product.id,
    moyskladId: product.moyskladId,
    name: product.name,
    code: product.code,
    article: product.article,
    groupPath: product.groupPath,
    uomName: product.uomName,
    brand: product.brand,
    sae: product.sae,
    packageVolume: product.packageVolume,
    volume: product.volume,
    barcodeEan13: product.barcodeEan13,
    markingEnabled: product.markingEnabled,
    markingMode: product.markingMode,
    markingStatus: product.markingStatus,
    markingSettings: product.markingSettings,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    inferredScenario: product.inferredScenario,
    stockBalances: product.stockBalances,
    risk:
      /Опасно/i.test(product.inferredScenario ?? "")
        ? "bulk-looking product is not configured in liters"
        : product.inferredScenario,
  };
}

function compactAqsiMatch(match) {
  return {
    source: match.source,
    recordId: match.recordId,
    number: match.number,
    status: match.status,
    dateTime: match.dateTime,
    hasDemandRef: match.hasDemandRef,
    positions: (match.positions ?? []).map((position) => ({
      text: position.text,
      quantity: position.quantity,
      price: position.price,
      paymentSubjectType: position.paymentSubjectType,
      markingType: position.markingType,
      itemCodeMasked: position.itemCodeMasked,
      itemCodeLength: position.itemCodeLength,
      itemCodeHasGs: position.itemCodeHasGs,
      gtin: position.gtin,
      unitOfMeasurement: position.unitOfMeasurement,
      unitCode: position.unitCode,
      isWeight: position.isWeight,
      looksPartialLiter: position.looksPartialLiter,
      looksPiece: position.looksPiece,
    })),
  };
}

function compactReport(report) {
  const productIdsInToday = new Set(
    report.todayTargetDemands.flatMap((demand) => demand.positions.map((position) => position.productId).filter(Boolean))
  );
  const problemProducts = report.problemProducts
    .filter((product) => {
      const text = `${product.name} ${product.groupPath} ${product.createdAt} ${product.updatedAt}`;
      return productIdsInToday.has(product.id) || /XTS 5W-30|XTS 5W-40/i.test(text);
    })
    .map(compactProduct);

  const oldWorkingCandidates = report.oldBulkSalesSample
    .filter((position) => /литр|^л$/i.test(String(position.unitFromProduct ?? "")) || position.measuredPourByCurrentCode)
    .slice(0, 12)
    .map((position) => ({
      shipmentNumber: position.shipmentNumber,
      shipmentDate: position.shipmentDate,
      name: position.name,
      quantity: position.quantity,
      unitFromProduct: position.unitFromProduct,
      product: compactProduct(position.product),
    }));

  return {
    generatedAt: report.generatedAt,
    targetDate: report.targetDate,
    scope: report.scope,
    aqsi: report.aqsi,
    problemProducts,
    todayTargetDemands: report.todayTargetDemands.map((demand) => ({
      id: demand.id,
      moyskladId: demand.moyskladId,
      number: demand.number,
      momentAt: demand.momentAt,
      documentDate: demand.documentDate,
      customer: demand.customer,
      customerType: demand.customerType,
      hasFiscalReceiptInAqsi: demand.aqsiMatches.length > 0,
      hasClosingDocument: demand.hasClosingDocument,
      closingDocuments: demand.closingDocuments,
      revisions: demand.revisions,
      positions: demand.positions.map((position) => ({
        id: position.id,
        productId: position.productId,
        name: position.name,
        quantity: position.quantity,
        unitFromProduct: position.unitFromProduct,
        price: position.price,
        discount: position.discount,
        amount: position.amount,
        markingRequiredByCurrentCode: position.markingRequiredByCurrentCode,
        measuredPourByCurrentCode: position.measuredPourByCurrentCode,
        expectedAqsiUnitCodeByCurrentCode: position.expectedAqsiUnitCodeByCurrentCode,
        expectedAqsiMarkingTypeByCurrentCode: position.expectedAqsiMarkingTypeByCurrentCode,
        product: compactProduct(position.product),
      })),
      aqsiMatches: demand.aqsiMatches.map(compactAqsiMatch),
    })),
    oldWorkingCandidates,
  };
}

function briefReport(report, aqsi) {
  const demandRefs = report.todayTargetDemands.map((demand) => ({
    id: demand.id,
    number: demand.number,
  }));
  const aqsiMarkedReceipts = [];

  if (aqsi?.enabled) {
    for (const pathResult of aqsi.paths ?? []) {
      if (!pathResult.ok) continue;
      for (const record of pathResult.rows ?? []) {
        const strings = collectStrings(record).map((entry) => entry.value);
        const refs = demandRefs.filter((ref) =>
          strings.some((value) => value === ref.id || value.includes(ref.id) || value === ref.number)
        );
        const positions = aqsiPositionsFromRecord(record)
          .map((position) => summarizeAqsiPosition(position))
          .filter((position) => position.itemCodeLength > 0 || /Bardahl|5W-30|5W-40/i.test(position.text ?? ""));
        if (positions.length === 0) continue;
        aqsiMarkedReceipts.push({
          source: pathResult.type,
          recordId: record.id ?? record.uid ?? record.uuid ?? null,
          number: record.number ?? record.documentNumber ?? record.receiptNumber ?? null,
          createdAt: record.createdAt ?? record.created_at ?? record.dateTime ?? record.closeDate ?? null,
          refs,
          positions: positions.map((position) => ({
            text: position.text,
            quantity: position.quantity,
            price: position.price,
            paymentSubjectType: position.paymentSubjectType,
            markingType: position.markingType,
            itemCodeMasked: position.itemCodeMasked,
            itemCodeLength: position.itemCodeLength,
            itemCodeHasGs: position.itemCodeHasGs,
            gtin: position.gtin,
            unitOfMeasurement: position.unitOfMeasurement,
            unitCode: position.unitCode,
            isWeight: position.isWeight,
            looksPartialLiter: position.looksPartialLiter,
            looksPiece: position.looksPiece,
          })),
        });
      }
    }
  }

  return {
    generatedAt: report.generatedAt,
    targetDate: report.targetDate,
    scope: report.scope,
    aqsi: report.aqsi,
    localRows: report.todayTargetDemands.flatMap((demand) =>
      demand.positions.map((position) => ({
        shipmentId: demand.id,
        shipmentNumber: demand.number,
        momentAt: demand.momentAt,
        postedAt: demand.revisions.find((revision) => revision.eventType === "POSTED")?.createdAt ?? null,
        customer: demand.customer,
        customerType: demand.customerType,
        closingDocument: demand.hasClosingDocument,
        productId: position.productId,
        productName: position.name,
        quantity: position.quantity,
        unitFromProduct: position.unitFromProduct,
        productGroupPath: position.product?.groupPath ?? null,
        productScenario: position.product?.inferredScenario ?? null,
        localStock: position.product?.stockBalances ?? [],
        expectedByCurrentPaymentCode: {
          markingRequired: position.markingRequiredByCurrentCode,
          measuredPour: position.measuredPourByCurrentCode,
          aqsiUnitCode: position.expectedAqsiUnitCodeByCurrentCode,
          aqsiUnitMeaning: position.expectedAqsiUnitCodeByCurrentCode === AQSI_UNIT_CODE_LITER ? "liter" : "piece",
          markingType: position.expectedAqsiMarkingTypeByCurrentCode,
        },
        blockerNeeded:
          position.markingRequiredByCurrentCode &&
          /розлив|разлив|боч/i.test(`${position.product?.groupPath ?? ""} ${position.unitFromProduct ?? ""}`) &&
          !position.measuredPourByCurrentCode,
      }))
    ),
    aqsiMarkedReceipts,
    repeatedAqsiCodes: Object.values(
      aqsiMarkedReceipts
        .flatMap((receipt) =>
          receipt.positions.map((position) => ({
            code: position.itemCodeMasked,
            gtin: position.gtin,
            receiptNumber: receipt.number,
            text: position.text,
            quantity: position.quantity,
          }))
        )
        .filter((entry) => entry.code)
        .reduce((acc, entry) => {
          acc[entry.code] ??= { code: entry.code, gtin: entry.gtin, uses: [] };
          acc[entry.code].uses.push({
            receiptNumber: entry.receiptNumber,
            text: entry.text,
            quantity: entry.quantity,
          });
          return acc;
        }, {})
    ).filter((entry) => entry.uses.length > 1),
  };
}

async function main() {
  const prisma = new PrismaClient();
  const yesterday = previousDateString(TARGET_DATE);

  const problemProducts = await prisma.localProduct.findMany({
    where: {
      OR: [
        ...PROBLEM_NAMES.map((name) => ({ name: { contains: name, mode: "insensitive" } })),
        { name: { contains: "Bardahl", mode: "insensitive" } },
        { brand: { contains: "Bardahl", mode: "insensitive" } },
      ],
    },
    include: { stockBalances: { include: { store: true } } },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });

  const newlyTouchedBardahlProducts = problemProducts.filter((product) => {
    const created = product.createdAt?.toISOString().slice(0, 10);
    const updated = product.updatedAt?.toISOString().slice(0, 10);
    return created === TARGET_DATE || created === yesterday || updated === TARGET_DATE || updated === yesterday;
  });

  const likelyBulkProducts = await prisma.localProduct.findMany({
    where: {
      OR: [
        { name: { contains: "розлив", mode: "insensitive" } },
        { name: { contains: "разлив", mode: "insensitive" } },
        { name: { contains: "боч", mode: "insensitive" } },
        { groupPath: { contains: "розлив", mode: "insensitive" } },
        { groupPath: { contains: "разлив", mode: "insensitive" } },
        { groupPath: { contains: "боч", mode: "insensitive" } },
      ],
    },
    include: { stockBalances: { include: { store: true } } },
    orderBy: [{ name: "asc" }],
    take: 80,
  });

  const todayDemands = await prisma.localDemand.findMany({
    where: {
      documentDate: TARGET_DATE,
      applicable: true,
    },
    include: {
      counterparty: true,
      positions: {
        include: { product: { include: { stockBalances: { include: { store: true } } } } },
        orderBy: { name: "asc" },
      },
      closingDocuments: true,
      revisions: { orderBy: { createdAt: "desc" }, take: 5 },
    },
    orderBy: { momentAt: "asc" },
  });

  const targetProductIds = new Set(problemProducts.map((product) => product.id));
  const problemNameRegex = /bardahl|5w-30|5w-40|розлив|разлив|боч/i;
  const targetDemands = todayDemands
    .map((demand) => {
      const positions = demand.positions.filter((position) => {
        const product = position.product;
        const name = `${position.name} ${product?.name ?? ""} ${product?.brand ?? ""} ${product?.groupPath ?? ""}`;
        const quantity = decimalToNumber(position.quantity) ?? 0;
        return (
          targetProductIds.has(position.productId ?? "") ||
          problemNameRegex.test(name) ||
          isMeasuredMotorOilQuantity(position.name, quantity, productMarkingContext(product, position.name)) ||
          isLikelyMeasuredMotorOilPourProductName(product?.name ?? "") ||
          isLikelyMeasuredMotorOilPourProductName(product?.groupPath ?? "")
        );
      });
      return { demand, positions };
    })
    .filter((entry) => entry.positions.length > 0);

  const oldBulkSales = await prisma.localDemandPosition.findMany({
    where: {
      demand: {
        documentDate: { lt: TARGET_DATE },
        applicable: true,
      },
      OR: [
        { name: { contains: "розлив", mode: "insensitive" } },
        { name: { contains: "разлив", mode: "insensitive" } },
        { name: { contains: "боч", mode: "insensitive" } },
        { product: { groupPath: { contains: "розлив", mode: "insensitive" } } },
        { product: { groupPath: { contains: "разлив", mode: "insensitive" } } },
        { product: { groupPath: { contains: "боч", mode: "insensitive" } } },
      ],
    },
    include: {
      demand: true,
      product: { include: { stockBalances: { include: { store: true } } } },
    },
    orderBy: { demand: { momentAt: "desc" } },
    take: 80,
  });

  const aqsi = await loadAqsiForDate(TARGET_DATE);

  const report = {
    generatedAt: new Date().toISOString(),
    targetDate: TARGET_DATE,
    scope: {
      todayApplicableDemandCount: todayDemands.length,
      todayTargetDemandCount: targetDemands.length,
      problemProductsCount: problemProducts.length,
      newlyTouchedBardahlProductsCount: newlyTouchedBardahlProducts.length,
      likelyBulkProductsCount: likelyBulkProducts.length,
      oldBulkSalesSampleCount: oldBulkSales.length,
    },
    problemProducts: problemProducts.map(productSummary),
    newlyTouchedBardahlProducts: newlyTouchedBardahlProducts.map(productSummary),
    likelyBulkProducts: likelyBulkProducts.map(productSummary),
    todayTargetDemands: targetDemands.map(({ demand, positions }) => {
      const positionNames = positions.map((position) => position.name);
      const aqsiMatches = findAqsiMatches(aqsi, demand, positionNames);
      return {
        id: demand.id,
        moyskladId: demand.moyskladId,
        number: demand.name,
        momentAt: demand.momentAt,
        documentDate: demand.documentDate,
        applicable: demand.applicable,
        customer: demand.counterparty?.name ?? demand.agentNameSnapshot,
        customerType: customerType(demand.counterparty),
        hasFiscalReceiptInLocalDb: aqsiMatches.length > 0,
        hasClosingDocument: demand.closingDocuments.length > 0,
        closingDocuments: demand.closingDocuments.map((document) => ({
          id: document.id,
          type: document.type,
          number: document.number,
          status: document.status,
          documentDate: document.documentDate,
          issuedAt: document.issuedAt,
        })),
        revisions: demand.revisions.map((revision) => ({
          eventType: revision.eventType,
          statusBefore: revision.statusBefore,
          statusAfter: revision.statusAfter,
          createdByName: revision.createdByName,
          createdAt: revision.createdAt,
        })),
        positions: positions.map((position) => {
          const quantity = decimalToNumber(position.quantity) ?? 0;
          const measuredPour = isMeasuredMotorOilQuantity(position.name, quantity, productMarkingContext(position.product, position.name));
          return {
            id: position.id,
            productId: position.productId,
            name: position.name,
            quantity,
            unitFromProduct: position.product?.uomName ?? null,
            price: asMoney(position.priceCentsPerUnit),
            discount: decimalToNumber(position.discount),
            amount: Math.round(quantity * asMoney(position.priceCentsPerUnit) * (1 - (decimalToNumber(position.discount) ?? 0) / 100) * 100) / 100,
            product: productSummary(position.product),
            markingRequiredByCurrentCode: position.assortmentType !== "service" && isLikelyMarkedMotorOilProductName(position.name),
            measuredPourByCurrentCode: measuredPour,
            expectedAqsiUnitCodeByCurrentCode: measuredPour ? AQSI_UNIT_CODE_LITER : AQSI_UNIT_CODE_PIECE,
            expectedAqsiMarkingTypeByCurrentCode: isLikelyMarkedMotorOilProductName(position.name) ? AQSI_MARKING_TYPE_AUTO_FLUIDS : null,
            rawHints: findRawHints(position.raw, [/mark|маркир|gtin|код|единиц|uom|measure|объем|volume|itemCode|bottle|barrel|боч|розлив|разлив/i]),
          };
        }),
        aqsiMatches,
        rawHints: findRawHints(demand.raw, [/payment|receipt|check|чек|ofd|фиск|касс|aqsi|mark|маркир|Bardahl|5W-30|5W-40/i]),
      };
    }),
    oldBulkSalesSample: oldBulkSales.map((position) => ({
      shipmentId: position.demandId,
      shipmentNumber: position.demand?.name,
      shipmentDate: position.demand?.documentDate,
      momentAt: position.demand?.momentAt,
      productId: position.productId,
      name: position.name,
      quantity: decimalToNumber(position.quantity),
      unitFromProduct: position.product?.uomName ?? null,
      price: asMoney(position.priceCentsPerUnit),
      product: productSummary(position.product),
      measuredPourByCurrentCode: isMeasuredMotorOilQuantity(
        position.name,
        decimalToNumber(position.quantity) ?? 0,
        productMarkingContext(position.product, position.name)
      ),
    })),
    aqsi: aqsi.enabled
      ? {
          enabled: true,
          paths: aqsi.paths?.map((entry) => ({
            type: entry.type,
            ok: entry.ok,
            count: entry.count,
            status: entry.status,
            error: entry.error,
          })),
        }
      : aqsi,
  };

  await prisma.$disconnect();
  const output = BRIEF_OUTPUT ? briefReport(report, aqsi) : COMPACT_OUTPUT ? compactReport(report) : report;
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
