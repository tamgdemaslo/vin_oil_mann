import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadEnvFile(fileName) {
  const filePath = path.join(repoRoot, fileName);
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] != null) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const { PrismaClient } = await import("@prisma/client");

const prisma = new PrismaClient();
const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";
const MAX_PRODUCT_PHOTOS = Number.parseInt(process.env.MOYSKLAD_PHOTO_IMPORT_MAX_PER_PRODUCT ?? "12", 10);
const MAX_PHOTO_SIZE_BYTES = 8 * 1024 * 1024;
const REQUEST_DELAY_MS = Number.parseInt(process.env.MOYSKLAD_PHOTO_IMPORT_DELAY_MS ?? "250", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMoySkladAuthHeader() {
  const login = process.env.MOYSKLAD_LOGIN?.trim();
  const password = process.env.MOYSKLAD_PASSWORD?.trim();
  const token = process.env.MOYSKLAD_TOKEN?.trim();
  const preferBearer = process.env.MOYSKLAD_PREFER_BEARER === "1" || process.env.MOYSKLAD_PREFER_BEARER === "true";

  if (login && password && !preferBearer) {
    return "Basic " + Buffer.from(`${login}:${password}`, "utf-8").toString("base64");
  }
  if (token) return `Bearer ${token}`;
  if (login && password) {
    return "Basic " + Buffer.from(`${login}:${password}`, "utf-8").toString("base64");
  }
  return null;
}

const auth = getMoySkladAuthHeader();
if (!auth) {
  throw new Error("Не заданы MOYSKLAD_TOKEN или MOYSKLAD_LOGIN/MOYSKLAD_PASSWORD");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .replace(/Ё/g, "е")
    .toLocaleLowerCase("ru-RU");
}

function looksLikeMotorOil(product) {
  const text = normalize([
    product.name,
    product.groupPath,
    product.description,
    product.searchText,
    product.sae,
    product.acea,
    product.apiSpec,
  ].join(" "));
  const accessorySignal =
    /фильтр|filter|пробк|сливн|поддон|кольц|проклад|шайб|крышк|корпус|датчик|клипс|ламп|герметик|болт|гайк|присадк|additive/.test(text);
  if (accessorySignal) return false;
  if (text.includes("моторные масла") || text.includes("моторное масло")) return true;
  if (!/(масл|oil|engine)/.test(text)) return false;
  if (/трансмис|акпп|atf|gear|редуктор|гур|psf|тормозн|brake|антифриз|coolant/.test(text)) {
    return /мотор|двигател|engine/.test(text);
  }
  return /мотор|двигател|engine|\b\d{1,2}w[- ]?\d{2}\b/i.test(text);
}

function asRows(value) {
  return Array.isArray(value?.rows) ? value.rows : [];
}

function imageHrefCandidates(image) {
  return [
    image?.downloadHref,
    image?.original?.href,
    image?.miniature?.href,
    image?.tiny?.href,
    image?.meta?.downloadHref,
    image?.meta?.href,
  ].filter((href) => typeof href === "string" && href.startsWith("http"));
}

function imageFileName(image, index, product) {
  const raw = image?.filename ?? image?.fileName ?? image?.title ?? product.article ?? product.code ?? product.name;
  const base = String(raw ?? `photo-${index + 1}`)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return base || `photo-${index + 1}`;
}

async function moyskladJson(pathOrUrl) {
  await sleep(REQUEST_DELAY_MS);
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${MOYSKLAD_BASE}${pathOrUrl}`;
  const res = await fetch(url, {
    headers: {
      Authorization: auth,
      Accept: "application/json;charset=utf-8",
      "Accept-Encoding": "gzip",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function fetchImageBytes(hrefs) {
  let lastError = null;
  for (const href of hrefs) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const res = await fetch(href, {
        headers: {
          Authorization: auth,
          Accept: "*/*",
          "Accept-Encoding": "gzip",
        },
        cache: "no-store",
      });
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      if (!res.ok) {
        lastError = `${res.status} ${res.statusText}`;
        continue;
      }
      if (!contentType.startsWith("image/")) {
        lastError = `не изображение: ${contentType}`;
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength <= 0) {
        lastError = "пустой файл";
        continue;
      }
      if (buffer.byteLength > MAX_PHOTO_SIZE_BYTES) {
        lastError = `файл больше ${Math.round(MAX_PHOTO_SIZE_BYTES / 1024 / 1024)} МБ`;
        continue;
      }
      return { buffer, contentType, sourceHref: href };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError ?? "нет подходящей ссылки на изображение");
}

async function loadMoySkladImages(product) {
  const rawImages = asRows(product.raw?.images);
  if (rawImages.length > 0) return rawImages;

  if (!product.moyskladId) return [];
  try {
    const data = await moyskladJson(`/entity/product/${product.moyskladId}/images`);
    return asRows(data);
  } catch (error) {
    console.warn(`Не удалось получить список фото МС для ${product.name}: ${error.message}`);
    return [];
  }
}

async function importProductPhotos(product) {
  const existing = await prisma.localProductPhoto.count({ where: { productId: product.id } });
  if (existing > 0) return { status: "skipped", imported: 0, reason: "уже есть фото" };

  const images = await loadMoySkladImages(product);
  const fallbackImages = product.imageHref ? [{ tiny: { href: product.imageHref } }] : [];
  const sourceImages = images.length > 0 ? images : fallbackImages;
  if (sourceImages.length === 0) return { status: "missing", imported: 0, reason: "нет фото в МойСклад" };

  let imported = 0;
  for (const [index, image] of sourceImages.entries()) {
    if (existing + imported >= MAX_PRODUCT_PHOTOS) break;
    const hrefs = imageHrefCandidates(image);
    if (hrefs.length === 0) continue;
    const { buffer, contentType } = await fetchImageBytes(hrefs);
    await prisma.localProductPhoto.create({
      data: {
        productId: product.id,
        fileName: imageFileName(image, index, product),
        contentType,
        sizeBytes: buffer.byteLength,
        data: buffer,
      },
    });
    imported += 1;
  }

  return imported > 0
    ? { status: "imported", imported }
    : { status: "missing", imported: 0, reason: "не удалось скачать фото" };
}

async function deleteExactDuplicatePhotos() {
  const photos = await prisma.localProductPhoto.findMany({
    select: { id: true, productId: true, sizeBytes: true, data: true, createdAt: true },
    orderBy: [{ productId: "asc" }, { createdAt: "asc" }],
  });
  const seen = new Map();
  const duplicateIds = [];
  for (const photo of photos) {
    const hash = crypto.createHash("sha256").update(Buffer.from(photo.data)).digest("hex");
    const key = `${photo.productId}:${photo.sizeBytes}:${hash}`;
    if (seen.has(key)) {
      duplicateIds.push(photo.id);
    } else {
      seen.set(key, photo.id);
    }
  }
  if (duplicateIds.length > 0) {
    await prisma.localProductPhoto.deleteMany({ where: { id: { in: duplicateIds } } });
  }
  return duplicateIds.length;
}

async function main() {
  const deletedDuplicates = await deleteExactDuplicatePhotos();
  if (deletedDuplicates > 0) {
    console.log(`Удалено точных дублей фото: ${deletedDuplicates}.`);
  }

  const products = await prisma.localProduct.findMany({
    where: {
      archived: false,
      entityType: { not: "service" },
    },
    select: {
      id: true,
      moyskladId: true,
      name: true,
      article: true,
      code: true,
      groupPath: true,
      description: true,
      searchText: true,
      sae: true,
      acea: true,
      apiSpec: true,
      imageHref: true,
      raw: true,
      photos: { select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  const motorOils = products.filter(looksLikeMotorOil);
  const withPhotos = motorOils.filter((product) => product.photos.length > 0).length;
  console.log(`Найдено моторных масел: ${motorOils.length}. Уже с локальными фото: ${withPhotos}.`);

  const totals = { importedProducts: 0, importedPhotos: 0, skipped: 0, missing: 0, failed: 0 };
  for (const [index, product] of motorOils.entries()) {
    process.stdout.write(`[${index + 1}/${motorOils.length}] ${product.name} ... `);
    try {
      const result = await importProductPhotos(product);
      if (result.status === "imported") {
        totals.importedProducts += 1;
        totals.importedPhotos += result.imported;
        console.log(`импортировано фото: ${result.imported}`);
      } else if (result.status === "skipped") {
        totals.skipped += 1;
        console.log(`пропуск: ${result.reason}`);
      } else {
        totals.missing += 1;
        console.log(`нет фото: ${result.reason}`);
      }
    } catch (error) {
      totals.failed += 1;
      console.log(`ошибка: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(JSON.stringify(totals, null, 2));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
