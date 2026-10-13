import { gzipSync, gunzipSync } from "node:zlib";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { AVITO_DEFAULT_SETTINGS, AVITO_MAX_ADS, avitoFeedStats, avitoSettingsIssues, avitoStockAllowed, buildAvitoCsv, buildAvitoListing, inferAvitoOilType } from "./domain";
import { AVITO_CHANNEL, avitoAdId, avitoAudit, avitoScope, decodeAvitoValue, newAvitoFeedToken, readAvitoValue, writeAvitoValue, type AvitoSnapshot, type StoredAvitoProfile, type AvitoScope } from "./storage";
import { AvitoAutoloadError, avitoOverridesSchema, type avitoCredentialsSaveSchema, type avitoListingSaveSchema, type avitoSelectionSchema, type avitoSettingsSaveSchema } from "./schemas";
import { AvitoAutoloadClient } from "./avito-client";
import type { AvitoFeedStats, AvitoHistoryItem, AvitoIntegrationData, AvitoListing, AvitoOverrides, AvitoProductSource, AvitoRemoteStatus, AvitoSettings, AvitoSettingsView, AvitoWorkspaceData } from "./types";

const MAX_CSV_BYTES = 50 * 1024 * 1024;
const productSelect = {
  id: true, name: true, article: true, groupPath: true, entityType: true, uomName: true, brand: true, sae: true, packageVolume: true,
  acea: true, aceaExtra: true, apiSpec: true, atf: true, oem: true, oemAtf: true, description: true, salePriceCents: true, archived: true, avito: true, updatedAt: true,
  photos: { where: { purpose: "AVITO" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, fileName: true, contentType: true, sizeBytes: true } },
} satisfies Prisma.LocalProductSelect;

const never = { status: "never" as const, checkedAt: null, message: null, accountId: null };

export async function getAvitoProfile(scope = avitoScope()) { return readAvitoValue<StoredAvitoProfile>(scope, "profile"); }

export function avitoFeedUrl(profile: StoredAvitoProfile) {
  return profile.settings.publicBaseUrl ? `${profile.settings.publicBaseUrl}/api/avito-autoload/feeds/${profile.feedToken}/feed.csv` : null;
}

function normalizeOrigin(value: string) {
  if (!value) return "";
  let url: URL;
  try { url = new URL(value); } catch { throw new AvitoAutoloadError("Укажите полный адрес платформы, например https://crm.example.ru"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "") || url.port && url.port !== "443") {
    throw new AvitoAutoloadError("Нужен HTTPS-адрес платформы без пути, параметров и логина");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || !host.includes(".") || /^[\d.:\[\]]+$/.test(host) || host.endsWith(".local")) throw new AvitoAutoloadError("Для Авито нужен публичный домен платформы");
  return url.origin;
}

async function settingsView(scope: AvitoScope, profile: StoredAvitoProfile | null, canEdit: boolean, defaults: Partial<AvitoSettings> = {}): Promise<AvitoSettingsView> {
  const [clientId, clientSecret, snapshot] = await Promise.all([
    readAvitoValue<string>(scope, "client_id"), readAvitoValue<string>(scope, "client_secret"), readAvitoValue<AvitoSnapshot>(scope, "snapshot"),
  ]);
  const settings = { ...AVITO_DEFAULT_SETTINGS, ...defaults, ...profile?.settings };
  return {
    ...settings, configured: Boolean(profile && settings.publicBaseUrl && !avitoSettingsIssues(settings).length), clientIdConfigured: Boolean(clientId), clientSecretConfigured: Boolean(clientSecret),
    feedUrl: canEdit && profile ? avitoFeedUrl(profile) : null, connection: profile?.connection ?? never, lastExportAt: snapshot?.createdAt ?? null,
  };
}

/** Connection setup does not read the product catalog or expose stored secrets. */
export async function getAvitoIntegration(options: { branchName: string; canEdit: boolean; canEditSecrets: boolean; address?: string; phone?: string }): Promise<AvitoIntegrationData> {
  const scope = avitoScope();
  const profile = await getAvitoProfile(scope);
  const [settings, stores, snapshot] = await Promise.all([
    settingsView(scope, profile, options.canEdit, { name: `Авито — ${options.branchName}`, address: options.address ?? "", phone: options.phone ?? "" }),
    prisma.localStore.findMany({ where: { branchId: scope.branchId, archived: false }, select: { id: true, name: true }, orderBy: [{ isMain: "desc" }, { name: "asc" }] }),
    readAvitoValue<AvitoSnapshot>(scope, "snapshot"),
  ]);
  return { branchName: options.branchName, canEdit: options.canEdit, canEditSecrets: options.canEditSecrets, settings, stores, reviewedAds: snapshot?.adIds.length ?? 0 };
}

export async function saveAvitoCredentials(input: z.infer<typeof avitoCredentialsSaveSchema>, defaults: { branchName: string; address?: string; phone?: string }) {
  const scope = avitoScope();
  if (!input.clientId && !input.clientSecret) throw new AvitoAutoloadError("Введите Client ID и Client Secret для подключения Авито");
  await prisma.$transaction(async (db) => {
    const [current, existingId, existingSecret] = await Promise.all([
      readAvitoValue<StoredAvitoProfile>(scope, "profile", db), readAvitoValue<string>(scope, "client_id", db), readAvitoValue<string>(scope, "client_secret", db),
    ]);
    if (!(input.clientId || existingId) || !(input.clientSecret || existingSecret)) throw new AvitoAutoloadError("Для первого подключения нужны оба поля: Client ID и Client Secret");
    const profile: StoredAvitoProfile = current
      ? { ...current, connection: never }
      : { version: 1, settings: { ...AVITO_DEFAULT_SETTINGS, name: `Авито — ${defaults.branchName}`, address: defaults.address ?? "", phone: defaults.phone ?? "", publicBaseUrl: normalizeOrigin(input.publicBaseUrl ?? "") }, feedToken: newAvitoFeedToken(scope), connection: never };
    if (input.clientId) await writeAvitoValue(scope, "client_id", input.clientId, db);
    if (input.clientSecret) await writeAvitoValue(scope, "client_secret", input.clientSecret, db);
    await writeAvitoValue(scope, "profile", profile, db);
    await avitoAudit(scope, "credentials_saved", "ok", "Ключи API Авито сохранены", {}, db);
  });
}

async function loadListings(scope: AvitoScope, settings: AvitoSettings, selectedOnly = false, ids?: string[]) {
  const where: Prisma.LocalProductWhereInput = {
    branchId: scope.branchId, entityType: "product", ...(ids ? { id: { in: ids } } : {}),
    ...(selectedOnly ? { avito: true } : { OR: [
      { avito: true }, { archived: false, OR: ["масл", "oil", "трансмис", "atf", "cvt", "dct"].map((value) => ({ groupPath: { contains: value, mode: "insensitive" as const } })) },
    ] }),
  };
  const [products, credentialRows] = await Promise.all([
    prisma.localProduct.findMany({ where, select: productSelect, orderBy: [{ name: "asc" }, { id: "asc" }], take: AVITO_MAX_ADS + 1 }),
    prisma.integrationCredential.findMany({
      where: { branchId: scope.branchId, organizationId: scope.organizationId, businessGroupId: scope.businessGroupId, channel: AVITO_CHANNEL, status: "active", OR: [{ key: { startsWith: "listing:" } }, { key: { startsWith: "status:" } }] },
      select: { key: true, encryptedValue: true },
    }),
  ]);
  if (products.length > AVITO_MAX_ADS) throw new AvitoAutoloadError("В одном разделе автозагрузки может быть не больше 50 000 товаров", 422, "AVITO_TOO_MANY_PRODUCTS");
  const productIds = products.map((product) => product.id);
  const stocks = productIds.length ? await prisma.localStockBalance.findMany({
    where: { branchId: scope.branchId, productId: { in: productIds }, store: { branchId: scope.branchId, archived: false }, ...(settings.storeIds.length ? { storeId: { in: settings.storeIds } } : {}) },
    select: { productId: true, available: true },
  }) : [];
  const available = new Map<string, number>();
  for (const stock of stocks) available.set(stock.productId, (available.get(stock.productId) ?? 0) + Number(stock.available));
  const credentials = new Map<string, unknown>();
  for (const row of credentialRows) {
    const value = decodeAvitoValue<unknown>(row.encryptedValue);
    if (value === null) throw new Error("Не удалось прочитать сохранённую карточку Авито");
    credentials.set(row.key, value);
  }
  const listings: AvitoListing[] = [];
  for (const product of products) {
    const saved = credentials.get(`listing:${product.id}`);
    const overrides = saved ? avitoOverridesSchema.parse(saved) : {};
    if (!inferAvitoOilType(product) && !overrides.type && !product.avito) continue;
    const source: AvitoProductSource = {
      ...product, available: available.get(product.id) ?? 0, updatedAt: product.updatedAt.toISOString(),
      photos: product.photos.map((photo) => ({ id: photo.id, name: photo.fileName ?? "Фотография", contentType: photo.contentType, size: photo.sizeBytes, url: `/api/local-inventory/products/${encodeURIComponent(product.id)}/photos/${encodeURIComponent(photo.id)}` })),
    };
    listings.push(buildAvitoListing(source, overrides, settings, avitoAdId(scope, product.id), credentials.get(`status:${product.id}`) as AvitoRemoteStatus | undefined ?? null));
  }
  return listings;
}

async function history(scope: AvitoScope): Promise<AvitoHistoryItem[]> {
  const rows = await prisma.integrationAuditLog.findMany({
    where: { branchId: scope.branchId, organizationId: scope.organizationId, channel: AVITO_CHANNEL }, orderBy: { createdAt: "desc" }, take: 50,
    select: { id: true, action: true, status: true, message: true, metadataJson: true, createdAt: true },
  });
  return rows.map((row) => {
    const meta = row.metadataJson && typeof row.metadataJson === "object" && !Array.isArray(row.metadataJson) ? row.metadataJson as Record<string, unknown> : {};
    return {
      id: row.id, action: row.action, status: row.status, message: row.message, createdAt: row.createdAt.toISOString(),
      stats: meta.stats as AvitoFeedStats | undefined ?? null, downloadUrl: typeof meta.csvGzip === "string" ? `/api/avito-autoload/exports/${row.id}` : null,
      reportId: typeof meta.reportId === "string" ? meta.reportId : null,
    };
  });
}

export async function getAvitoWorkspace(options: { branchName: string; canEdit: boolean; canEditSecrets: boolean; address?: string; phone?: string; search?: string; offset?: number; type?: string; view?: string }): Promise<AvitoWorkspaceData> {
  const scope = avitoScope();
  const profile = await getAvitoProfile(scope);
  const view = await settingsView(scope, profile, options.canEdit, { address: options.address ?? "", phone: options.phone ?? "", name: `Авито — ${options.branchName}` });
  const [all, stores, items, snapshot] = await Promise.all([
    loadListings(scope, view),
    prisma.localStore.findMany({ where: { branchId: scope.branchId, archived: false }, select: { id: true, name: true }, orderBy: [{ isMain: "desc" }, { name: "asc" }] }),
    history(scope), readAvitoValue<AvitoSnapshot>(scope, "snapshot"),
  ]);
  const query = options.search?.trim().toLocaleLowerCase("ru-RU") ?? "";
  const filtered = all.filter((listing) => {
    if (query && ![listing.name, listing.article, listing.values.brand].some((value) => value?.toLocaleLowerCase("ru-RU").includes(query))) return false;
    if (["motor", "transmission"].includes(options.type ?? "") && listing.type !== options.type) return false;
    const invalid = listing.issues.some((issue) => issue.severity === "error");
    switch (options.view) {
      case "selected": return listing.enabled;
      case "errors": return invalid;
      case "ready": return !invalid && !listing.archived;
      case "published": return ["active", "old"].includes(listing.remote?.status ?? "");
      default: return true;
    }
  });
  const offset = Math.max(0, options.offset ?? 0);
  return {
    branchName: options.branchName, canEdit: options.canEdit, canEditSecrets: options.canEditSecrets, settings: view,
    products: filtered.slice(offset, offset + 250), stores, history: items, stats: avitoFeedStats(all, view, snapshot?.adIds), total: filtered.length, limit: 250,
  };
}

export async function saveAvitoSettings(input: z.infer<typeof avitoSettingsSaveSchema>) {
  const scope = avitoScope();
  const current = await getAvitoProfile(scope);
  const settings = { ...input.settings, publicBaseUrl: normalizeOrigin(input.settings.publicBaseUrl), storeIds: [...new Set(input.settings.storeIds)] };
  if (settings.enabled && (!settings.publicBaseUrl || avitoSettingsIssues(settings).length)) throw new AvitoAutoloadError("Перед включением укажите публичный адрес платформы и адрес объявления");
  if (settings.storeIds.length) {
    const count = await prisma.localStore.count({ where: { branchId: scope.branchId, archived: false, id: { in: settings.storeIds } } });
    if (count !== settings.storeIds.length) throw new AvitoAutoloadError("Выберите действующие склады текущего филиала");
  }
  const credentialsChanged = Boolean(input.clientId || input.clientSecret);
  const profile: StoredAvitoProfile = {
    version: 1, settings, feedToken: !current || input.rotateFeedToken ? newAvitoFeedToken(scope) : current.feedToken,
    connection: credentialsChanged ? never : current?.connection ?? never,
  };
  await prisma.$transaction(async (db) => {
    await writeAvitoValue(scope, "profile", profile, db);
    if (input.clientId) await writeAvitoValue(scope, "client_id", input.clientId, db);
    if (input.clientSecret) await writeAvitoValue(scope, "client_secret", input.clientSecret, db);
    await avitoAudit(scope, "settings_saved", "ok", "Настройки Авито сохранены", { enabled: settings.enabled, keysChanged: credentialsChanged, feedTokenRotated: Boolean(input.rotateFeedToken) }, db);
  });
}

export async function saveAvitoListing(input: z.infer<typeof avitoListingSaveSchema>) {
  const scope = avitoScope();
  await prisma.$transaction(async (db) => {
    const product = await db.localProduct.findFirst({ where: { branchId: scope.branchId, id: input.id, entityType: "product" }, select: { id: true, archived: true, updatedAt: true } });
    if (!product) throw new AvitoAutoloadError("Товар не найден в текущем филиале", 404);
    if (product.archived && input.enabled) throw new AvitoAutoloadError("Архивный товар нельзя включить в выгрузку");
    if (product.updatedAt.toISOString() !== input.sourceUpdatedAt) throw new AvitoAutoloadError("Товар изменился после открытия редактора. Обновите список и повторите сохранение", 409, "AVITO_PRODUCT_CHANGED");
    if (input.overrides.photoIds?.length) {
      const count = await db.localProductPhoto.count({ where: { branchId: scope.branchId, productId: input.id, purpose: "AVITO", id: { in: [...new Set(input.overrides.photoIds)] } } });
      if (count !== input.overrides.photoIds.length) throw new AvitoAutoloadError("Выберите фотографии Авито этого товара");
    }
    if (input.overrides.avitoId) {
      const bound = await db.integrationCredential.findMany({ where: { branchId: scope.branchId, organizationId: scope.organizationId, channel: AVITO_CHANNEL, status: "active", key: { startsWith: "listing:" } }, select: { key: true, encryptedValue: true } });
      if (bound.some((row) => row.key !== `listing:${input.id}` && decodeAvitoValue<AvitoOverrides>(row.encryptedValue)?.avitoId === input.overrides.avitoId)) throw new AvitoAutoloadError("Этот номер объявления уже привязан к другому товару");
    }
    const updated = await db.localProduct.updateMany({ where: { branchId: scope.branchId, id: input.id, updatedAt: product.updatedAt }, data: { avito: input.enabled } });
    if (updated.count !== 1) throw new AvitoAutoloadError("Товар изменился. Обновите список", 409, "AVITO_PRODUCT_CHANGED");
    await writeAvitoValue(scope, `listing:${input.id}`, input.overrides, db);
    await avitoAudit(scope, "listing_saved", "ok", "Карточка объявления сохранена", { productId: input.id, enabled: input.enabled }, db);
  });
}

export async function selectAvitoProducts(input: z.infer<typeof avitoSelectionSchema>) {
  const scope = avitoScope();
  const ids = [...new Set(input.ids)];
  const profile = await getAvitoProfile(scope);
  const products = await loadListings(scope, profile?.settings ?? AVITO_DEFAULT_SETTINGS, false, ids);
  if (products.length !== ids.length || input.enabled && products.some((product) => product.archived || product.issues.some((issue) => issue.field === "type" && issue.severity === "error"))) {
    throw new AvitoAutoloadError("Включать можно только действующие масла текущего филиала с выбранным типом");
  }
  await prisma.$transaction(async (db) => {
    await db.localProduct.updateMany({ where: { branchId: scope.branchId, id: { in: ids }, entityType: "product" }, data: { avito: input.enabled } });
    await avitoAudit(scope, "selection_saved", "ok", input.enabled ? "Товары включены в выгрузку" : "Товары исключены из выгрузки", { count: ids.length, enabled: input.enabled }, db);
  });
}

export async function prepareAvitoFeed(profile: StoredAvitoProfile, scope: AvitoScope, allowEmpty: boolean, automatic = false) {
  if (!profile.settings.publicBaseUrl) throw new AvitoAutoloadError("Укажите публичный адрес платформы в настройках");
  if (avitoSettingsIssues(profile.settings).length) throw new AvitoAutoloadError("Исправьте адрес и контактные настройки");
  const [listings, previous] = await Promise.all([loadListings(scope, profile.settings, true), readAvitoValue<AvitoSnapshot>(scope, "snapshot")]);
  const stats = avitoFeedStats(listings, profile.settings, previous?.adIds);
  if (stats.invalid) throw new AvitoAutoloadError(`Исправьте ${stats.invalid} объявлений с ошибками. Они не будут молча исключены из файла`, 422, "AVITO_INVALID_LISTINGS", { stats });
  // Automatic withdrawal is allowed only for an explicit stock rule or an
  // already-reviewed empty snapshot. Changing the selection to zero needs review.
  const automaticStockWithdrawal = Boolean(automatic && previous && profile.settings.onlyInStock && listings.some((listing) => listing.enabled) && listings.every((listing) => listing.archived || !avitoStockAllowed(listing.source, listing.values.volume, profile.settings)));
  if (!stats.included && !allowEmpty && !automaticStockWithdrawal && !(automatic && previous?.adIds.length === 0)) {
    throw new AvitoAutoloadError(previous?.adIds.length ? "Файл станет пустым и снимет прежние объявления. Подтвердите пустую выгрузку" : "Выберите хотя бы один товар с доступным остатком", 422, "AVITO_EMPTY_FEED", { stats });
  }
  if (allowEmpty && !previous) throw new AvitoAutoloadError("Для первой выгрузки нужен хотя бы один товар");
  const csv = buildAvitoCsv(listings, profile.settings, (id) => `${profile.settings.publicBaseUrl}/api/avito-autoload/feeds/${profile.feedToken}/photos/${encodeURIComponent(id)}`);
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) throw new AvitoAutoloadError("Файл превышает 50 МБ. Уменьшите число товаров или объём описаний");
  const included = listings.filter((listing) => listing.included);
  const snapshot: AvitoSnapshot = { createdAt: new Date().toISOString(), adIds: included.map((listing) => listing.adId), productIds: included.map((listing) => listing.id), photoIds: [...new Set(included.flatMap((listing) => listing.photos.map((photo) => photo.id)))] };
  return { csv, stats, snapshot };
}

export async function generateAvitoExport(allowEmpty = false) {
  const scope = avitoScope();
  const profile = await getAvitoProfile(scope);
  if (!profile) throw new AvitoAutoloadError("Сначала сохраните настройки Авито");
  const result = await prepareAvitoFeed(profile, scope, allowEmpty);
  const exportRow = await prisma.$transaction(async (db) => {
    await writeAvitoValue(scope, "snapshot", result.snapshot, db);
    return avitoAudit(scope, "feed_generated", "ok", `Подготовлена выгрузка: ${result.stats.included} объявлений`, {
      stats: result.stats, csvGzip: gzipSync(result.csv).toString("base64"), catalogVersion: "2026-10-12",
    }, db);
  });
  return { id: exportRow.id, stats: result.stats, downloadUrl: `/api/avito-autoload/exports/${exportRow.id}` };
}

export async function downloadAvitoExport(id: string) {
  const scope = avitoScope();
  const row = await prisma.integrationAuditLog.findFirst({ where: { id, branchId: scope.branchId, organizationId: scope.organizationId, channel: AVITO_CHANNEL, action: "feed_generated" }, select: { metadataJson: true } });
  const meta = row?.metadataJson && typeof row.metadataJson === "object" && !Array.isArray(row.metadataJson) ? row.metadataJson as Record<string, unknown> : {};
  if (typeof meta.csvGzip !== "string") throw new AvitoAutoloadError("Выгрузка не найдена", 404);
  return gunzipSync(Buffer.from(meta.csvGzip, "base64"), { maxOutputLength: MAX_CSV_BYTES });
}

export async function getAvitoClient(scope: AvitoScope) {
  const [clientId, clientSecret] = await Promise.all([readAvitoValue<string>(scope, "client_id"), readAvitoValue<string>(scope, "client_secret")]);
  if (!clientId || !clientSecret) throw new AvitoAutoloadError("Владелец должен сохранить Client ID и Client Secret для API Авито", 422, "AVITO_KEYS_MISSING");
  return new AvitoAutoloadClient(clientId, clientSecret);
}

export async function performAvitoApiAction(action: "test" | "connect" | "upload" | "reports") {
  const scope = avitoScope();
  const profile = await getAvitoProfile(scope);
  if (!profile) throw new AvitoAutoloadError("Сначала сохраните настройки Авито");
  const client = await getAvitoClient(scope);
  try {
    if (action === "test") {
      await client.profile();
      const account = await client.account();
      const accountId = String(account.id ?? "");
      if (!/^\d+$/.test(accountId)) throw new AvitoAutoloadError("Авито не вернул номер аккаунта", 502);
      if ((await getAvitoClient(scope)).credentialFingerprint !== client.credentialFingerprint) throw new AvitoAutoloadError("Ключи изменились во время проверки. Проверьте подключение повторно", 409, "AVITO_CREDENTIALS_CHANGED");
      profile.connection = { status: "ok", checkedAt: new Date().toISOString(), accountId, message: "Доступ к API автозагрузки подтверждён" };
      const latest = await getAvitoProfile(scope);
      if (!latest) throw new AvitoAutoloadError("Настройки подключения изменились. Обновите страницу", 409);
      await writeAvitoValue(scope, "profile", { ...latest, connection: profile.connection });
      await avitoAudit(scope, "connection_checked", "ok", profile.connection.message!);
      return { message: profile.connection.message };
    }
    if (action === "connect" || action === "upload") {
      if (!profile.settings.enabled) throw new AvitoAutoloadError("Включите автозагрузку в настройках платформы");
      const snapshot = await readAvitoValue<AvitoSnapshot>(scope, "snapshot");
      if (!snapshot) throw new AvitoAutoloadError("Сначала сформируйте и проверьте выгрузку");
      await prepareAvitoFeed(profile, scope, false, true);
      const url = avitoFeedUrl(profile)!;
      if (action === "connect") await client.connectFeed(url, `Эко-платформа ${scope.branchId}`);
      else {
        const providerProfile = await client.profile();
        const feeds = Array.isArray(providerProfile.feeds_data) ? providerProfile.feeds_data : [];
        if (!feeds.some((feed) => feed && typeof feed === "object" && (feed as Record<string, unknown>).feed_url === url)) throw new AvitoAutoloadError("Сначала подключите этот файл к профилю Авито");
        await client.upload();
      }
      const message = action === "connect" ? "Ссылка добавлена в профиль автозагрузки Авито" : "Авито принял запрос на обработку файла. Публикацию подтвердит отчёт";
      await avitoAudit(scope, action === "connect" ? "feed_connected" : "upload_requested", "ok", message);
      return { message };
    }
    return syncAvitoReports(scope, client);
  } catch (error) {
    const message = error instanceof AvitoAutoloadError ? error.message : "Не удалось связаться с Авито. Перед повторным запуском проверьте отчёт";
    if (action === "test" && !(error instanceof AvitoAutoloadError && error.code === "AVITO_CREDENTIALS_CHANGED")) {
      profile.connection = { status: "error", checkedAt: new Date().toISOString(), accountId: null, message };
      const latest = await getAvitoProfile(scope);
      if (latest) await writeAvitoValue(scope, "profile", { ...latest, connection: profile.connection });
    }
    await avitoAudit(scope, `${action}_failed`, "error", message);
    if (error instanceof AvitoAutoloadError) throw error;
    throw new AvitoAutoloadError(message, 502, "AVITO_NETWORK_ERROR");
  }
}

async function syncAvitoReports(scope: AvitoScope, client: AvitoAutoloadClient) {
  const data = await client.reports();
  if (!Array.isArray(data.reports)) throw new AvitoAutoloadError("Авито вернул отчёт неизвестного формата", 502, "AVITO_INVALID_REPORT");
  const reports = data.reports.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)));
  if (!reports.length) return { message: "Авито пока не сформировал отчёт автозагрузки" };
  const report = reports[0];
  const reportId = String(report.id ?? "");
  const items = await client.reportItems(reportId);
  const products = await prisma.localProduct.findMany({ where: { branchId: scope.branchId, entityType: "product" }, select: { id: true }, take: AVITO_MAX_ADS + 1 });
  const byAdId = new Map(products.map((product) => [avitoAdId(scope, product.id), product.id]));
  const checkedAt = new Date().toISOString();
  let matched = 0;
  const reportState = String(report.status ?? "unknown");
  for (const item of items) {
    const productId = byAdId.get(String(item.ad_id ?? ""));
    if (!productId) continue;
    const rawId = String(item.avito_id ?? "");
    const rawUrl = typeof item.url === "string" ? item.url : null;
    let url: string | null = null;
    try { const parsed = rawUrl ? new URL(rawUrl) : null; if (parsed?.protocol === "https:" && (parsed.hostname === "avito.ru" || parsed.hostname.endsWith(".avito.ru"))) url = parsed.href; } catch { /* No trusted ad URL. */ }
    const messages = Array.isArray(item.messages) ? item.messages.flatMap((message) => message && typeof message === "object" && typeof (message as Record<string, unknown>).description === "string" ? [String((message as Record<string, unknown>).description).slice(0, 1000)] : []).slice(0, 20) : [];
    const status: AvitoRemoteStatus = { status: String(item.avito_status ?? item.status ?? "unknown"), avitoId: /^[1-9]\d+$/.test(rawId) ? rawId : null, url, messages, checkedAt, reportId };
    await writeAvitoValue(scope, `status:${productId}`, status);
    matched++;
  }
  const message = `Получен отчёт №${reportId}: сопоставлено ${matched} объявлений`;
  await avitoAudit(scope, "report_received", ["pending", "in_progress"].includes(reportState) ? "pending" : "ok", message, { reportId, reportState, matched });
  return { message, matched, reportId };
}
