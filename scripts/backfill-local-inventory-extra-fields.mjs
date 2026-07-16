import { PrismaClient } from "@prisma/client";
import XLSX from "xlsx";

const prisma = new PrismaClient();

const DEFAULT_COUNTERPARTIES_XLSX = "/Volumes/KINGSTON/БД/outputs/kontragenty_2026-05-22.xlsx";
const DEFAULT_PRODUCTS_XLSX = "/Volumes/KINGSTON/БД/outputs/stock_with_remainders_2026-05-22.xlsx";

function readRows(path) {
  const workbook = XLSX.readFile(path, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
}

function clean(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function crossReferenceKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "")
    .replace(/[^0-9a-zа-яё]/gi, "");
}

function splitCrossReferences(value) {
  const result = [];
  for (const chunk of String(value ?? "").split(/[,;\r\n\t]+/g)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const words = trimmed.split(/\s+/).filter(Boolean);
    const spacedArticle = words.length > 1 && /^[a-zа-яё]$/i.test(words[0]) && words.slice(1).every((word) => /^[\d./-]+$/.test(word));
    const splitSpaces = words.length > 1 && !spacedArticle && words.every((word) => crossReferenceKey(word).length >= 3);
    result.push(...(splitSpaces ? words : [trimmed]));
  }
  return result;
}

function mergeCrossReferences(...values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    for (const item of splitCrossReferences(value)) {
      const display = item.replace(/[\s-]+/g, "").toUpperCase();
      const key = crossReferenceKey(display);
      if (key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      result.push(display);
    }
  }
  return result.length ? `${result.join("; ")};` : null;
}

function parseNumber(value) {
  const text = clean(value);
  if (!text) return null;
  const n = Number(text.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function cents(value) {
  const n = parseNumber(value);
  return n == null ? null : Math.round(n * 100);
}

function boolRu(value) {
  const text = clean(value)?.toLowerCase();
  if (!text) return null;
  if (["да", "yes", "true", "1"].includes(text)) return true;
  if (["нет", "no", "false", "0"].includes(text)) return false;
  return null;
}

function normalizeKey(value) {
  return clean(value)?.toLowerCase().replace(/\s+/g, " ") ?? "";
}

function normalizePhone(value) {
  const digits = clean(value)?.replace(/\D/g, "") ?? "";
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

function isUsableNameKey(value) {
  return value.length >= 3 && /[a-zа-яё]/i.test(value) && !/^[+()\d\s.-]+$/.test(value);
}

function filledScore(data) {
  return Object.values(data).filter((value) => value != null && value !== "").length;
}

function dateValue(value) {
  const text = clean(value);
  if (!text) return null;
  const parts = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (parts) return new Date(`${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}T00:00:00`);
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function counterpartyCompanyType(label) {
  const text = clean(label)?.toLowerCase() ?? "";
  if (text.includes("физ")) return "individual";
  if (text.includes("ип") || text.includes("предприним")) return "entrepreneur";
  return "legal";
}

function productUpdateData(row) {
  const mannPoman = clean(row["Наиминование по Mann"]) ?? clean(row["Наименование по Mann"]);
  return {
    groupPath: clean(row["Группы"]),
    code: clean(row["Код"]),
    name: clean(row["Наименование"]),
    externalCode: clean(row["Внешний код"]),
    article: clean(row["Артикул"]),
    uomName: clean(row["Единица измерения"]),
    salePriceCents: cents(row["Цена продажи"]) ?? undefined,
    currencyName: clean(row["Валюта (Цена продажи)"]),
    buyPriceCents: cents(row["Закупочная цена"]),
    minimumBalance: parseNumber(row["Неснижаемый остаток"]),
    barcodeEan13: clean(row["Штрихкод EAN13"]),
    barcodeEan8: clean(row["Штрихкод EAN8"]),
    barcodeCode128: clean(row["Штрихкод Code128"]),
    description: clean(row["Описание"]),
    minPriceCents: cents(row["Минимальная цена"]),
    minPriceCurrencyName: clean(row["Валюта (Минимальная цена)"]),
    countryName: clean(row["Страна"]),
    vatLabel: clean(row["НДС"]),
    supplierName: clean(row["Поставщик"]),
    weight: parseNumber(row["Вес"]),
    volume: parseNumber(row["Объем"]),
    modificationCode: clean(row["Код модификации"]),
    tnvedCode: clean(row["Код ТН ВЭД"]),
    sae: clean(row["SAE"]),
    oem: clean(row["OEM"]),
    acea: clean(row["ACEA"]),
    apiSpec: clean(row["API"]),
    packageVolume: clean(row["Объем.1"]),
    avito: boolRu(row["Авито"]),
    brand: clean(row["Brand"]),
    atf: clean(row["ATF"]),
    ilsac: clean(row["ILSAC"]),
    aceaExtra: clean(row["ACEA (!)"]),
    oemAtf: clean(row["OEM ATF"]),
    rosskoPartNumber: clean(row["rossko_part_number"]),
    rosskoBrand: clean(row["rossko_brand"]),
    rosskoMin: clean(row["rossko_min"]),
    supplierAttribute: clean(row["Supplier"]),
    oemParts: mergeCrossReferences(clean(row["OEM PARTS"]), mannPoman),
    cell: clean(row["Ячейка"]),
    mannCharacteristicName: clean(row["Характеристика:Нименование по Mann"]),
  };
}

function counterpartyUpdateData(row) {
  const typeName = clean(row["Тип контрагента"]);
  return {
    name: clean(row["Наиминование"]),
    legalLastName: clean(row["Фамилия"]),
    legalFirstName: clean(row["Имя"]),
    legalMiddleName: clean(row["Отчество"]),
    legalAddress: clean(row["Юридический адрес"]),
    inn: clean(row["ИНН"]),
    kpp: clean(row["КПП"]),
    okpo: clean(row["ОКПО"]),
    phone: clean(row["Телефон"]),
    fax: clean(row["Факс"]),
    email: clean(row["E-mail"]),
    bik: clean(row["БИК"]),
    bankName: clean(row["Банк"]),
    bankLocation: clean(row["Местонахождение"]),
    correspondentAccount: clean(row["К/с"]),
    checkingAccount: clean(row["Р/с"]),
    ogrn: clean(row["ОГРН"]),
    ogrnip: clean(row["ОГРНИП"]),
    certificateNumber: clean(row["Номер свидетельства"]),
    certificateDate: dateValue(row["Дата свидетельства"]),
    counterpartyTypeName: typeName,
    companyType: typeName ? counterpartyCompanyType(typeName) : undefined,
  };
}

function pruneUndefined(data) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

function buildSearchText(values) {
  return Object.values(values)
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
}

async function runLimited(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

async function backfillProducts(path) {
  const rows = readRows(path);
  const products = await prisma.localProduct.findMany({
    select: {
      id: true,
      name: true,
      article: true,
      code: true,
      externalCode: true,
      raw: true,
    },
  });
  const byExternalCode = new Map();
  const byCode = new Map();
  const byArticle = new Map();
  const byName = new Map();
  for (const product of products) {
    const raw = product.raw && typeof product.raw === "object" ? product.raw : {};
    const externalCode = clean(product.externalCode) ?? clean(raw.externalCode);
    if (externalCode) byExternalCode.set(externalCode, product);
    if (product.code) byCode.set(product.code, product);
    if (product.article) byArticle.set(product.article, product);
    const nameKey = normalizeKey(product.name);
    if (nameKey) byName.set(nameKey, product);
  }

  const updates = [];
  for (const row of rows) {
    const data = pruneUndefined(productUpdateData(row));
    const product =
      (data.externalCode && byExternalCode.get(data.externalCode)) ||
      (data.code && byCode.get(data.code)) ||
      (data.article && byArticle.get(data.article)) ||
      (data.name && byName.get(normalizeKey(data.name)));
    if (!product) continue;
    delete data.name;
    data.searchText = buildSearchText({ name: product.name, article: product.article, code: product.code, ...data });
    updates.push({ id: product.id, data });
  }
  let done = 0;
  await runLimited(updates, 8, async ({ id, data }) => {
    await prisma.localProduct.update({ where: { id }, data });
    done += 1;
    if (done % 25 === 0) console.log(`products ${done}/${updates.length}`);
  });
  const matched = updates.length;
  return { rows: rows.length, matched };
}

async function backfillCounterparties(path) {
  const rows = readRows(path);
  const counterparties = await prisma.localCounterparty.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      normalizedPhone: true,
      legalTitle: true,
      companyType: true,
    },
  });
  const byPhone = new Map();
  const byName = new Map();
  for (const counterparty of counterparties) {
    const phone = normalizePhone(counterparty.phone) || counterparty.normalizedPhone || "";
    if (phone) byPhone.set(phone, counterparty);
    const nameKey = normalizeKey(counterparty.name);
    if (isUsableNameKey(nameKey)) byName.set(nameKey, counterparty);
  }

  const updatesById = new Map();
  for (const row of rows) {
    const data = pruneUndefined(counterpartyUpdateData(row));
    const normalizedPhone = normalizePhone(data.phone);
    const nameKey = normalizeKey(data.name);
    const counterparty =
      (normalizedPhone.length >= 10 && byPhone.get(normalizedPhone)) ||
      (isUsableNameKey(nameKey) && byName.get(nameKey));
    if (!counterparty) continue;
    delete data.name;
    if (data.phone) data.normalizedPhone = normalizedPhone || null;
    data.searchText = buildSearchText({
      name: counterparty.name,
      phone: counterparty.phone,
      email: counterparty.email,
      legalTitle: counterparty.legalTitle,
      companyType: counterparty.companyType,
      ...data,
    });
    const existing = updatesById.get(counterparty.id);
    if (!existing || filledScore(data) > filledScore(existing.data)) {
      updatesById.set(counterparty.id, { id: counterparty.id, data });
    }
  }
  const updates = [...updatesById.values()];
  let done = 0;
  await runLimited(updates, 8, async ({ id, data }) => {
    await prisma.localCounterparty.update({ where: { id }, data });
    done += 1;
    if (done % 25 === 0) console.log(`counterparties ${done}/${updates.length}`);
  });
  const matched = updates.length;
  return { rows: rows.length, matched };
}

async function main() {
  const productsPath = process.argv[2] || DEFAULT_PRODUCTS_XLSX;
  const counterpartiesPath = process.argv[3] || DEFAULT_COUNTERPARTIES_XLSX;
  const [products, counterparties] = await Promise.all([
    backfillProducts(productsPath),
    backfillCounterparties(counterpartiesPath),
  ]);
  console.log(JSON.stringify({ products, counterparties }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
