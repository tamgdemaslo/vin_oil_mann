import catalogs from "./catalogs.generated.json";
import { isLiterSaleUnit } from "@/lib/product-marking";
import { AVITO_CONTENT_DEFAULTS, avitoContentVariables, avitoTemplateIssues, renderAvitoTemplate, shortenAvitoTitle } from "./content";
import type { AvitoFeedStats, AvitoIssue, AvitoListing, AvitoOilType, AvitoOverrides, AvitoProductSource, AvitoRemoteStatus, AvitoSettings } from "./types";

export const AVITO_CATALOG_VERSION = catalogs.version;
export const AVITO_MAX_ADS = 50_000;
export const AVITO_TYPE_LABELS: Record<AvitoOilType, string> = { motor: "Моторные масла", transmission: "Трансмиссионные масла" };
export const AVITO_CONTACT_METHODS = ["По телефону и в сообщениях", "По телефону", "В сообщениях"] as const;
export const AVITO_DEFAULT_SETTINGS: AvitoSettings = {
  name: "Авито", enabled: false, publicBaseUrl: "", address: "", addressSource: "branch", sellerAddressId: "", contactPerson: "", phone: "",
  contactMethod: "По телефону и в сообщениях", storeIds: [], onlyInStock: true, stockBuffer: 0, listingFee: "Package",
  ...AVITO_CONTENT_DEFAULTS,
};

export function normalizeAvitoSettings(saved: Partial<AvitoSettings>): AvitoSettings {
  return { ...AVITO_DEFAULT_SETTINGS, ...saved,
    addressSource: saved.addressSource ?? (saved.address?.trim() ? "manual" : "branch"),
    categoryDescriptionTemplates: { ...AVITO_CONTENT_DEFAULTS.categoryDescriptionTemplates, ...saved.categoryDescriptionTemplates },
  };
}

export function avitoCatalog(type: AvitoOilType) { return catalogs.types[type]; }

/** Membership comes from the catalog group, never the item's name or Avito flag. */
export function inferAvitoOilType(source: Pick<AvitoProductSource, "entityType" | "groupPath" | "groupCode" | "group">): AvitoOilType | null {
  if (source.entityType !== "product" || source.group && source.group.kind !== "product") return null;
  const parts = (source.group?.name ?? source.groupPath ?? "").split(/[\\/>]+/u).map((part) => part.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  const group = parts.join(" ");
  if (/(?:фильтр|filter|поддон|проклад|уплотн|кольц|датчик|болт|ремкомплект|свеч|пробк)/u.test(group)) return null;
  const fluid = /(?:^| )(?:масло|масла|масел|oil|oils|жидкость|жидкости|fluid|fluids|lubricant|atf)(?: |$)/u.test(group);
  if (!fluid) return null;
  for (const part of parts.reverse()) {
    if (/(?:^| )(?:трансмис\p{L}*|transmission\p{L}*|gear|atf|cvt|dct|dsg|акпп|мкпп|кпп|вариатор\p{L}*|редуктор\p{L}*|дифференциал\p{L}*|раздаточн\p{L}*)(?: |$)/u.test(part)) return "transmission";
    if (/(?:^| )(?:моторн\p{L}*|motor|engine|двигател\p{L}*)(?: |$)/u.test(part)) return "motor";
  }
  return null;
}

export function avitoListingGroupKey(source: Pick<AvitoProductSource, "groupPath" | "group">) {
  return source.group ? `id:${source.group.id}` : `path:${source.groupPath?.trim() ?? ""}`;
}

function normalized(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, " ");
}

/** Only unambiguous spelling/format matches; never substitute a similar brand or approval. */
export function matchAvitoDictionary(type: AvitoOilType, field: "Brand" | "SAE" | "Volume", value: string): string | null {
  const values: readonly string[] = avitoCatalog(type)[field];
  if (values.includes(value)) return value;
  const key = (text: string) => field === "SAE" ? normalized(text).replace(/\s/g, "") : normalized(text);
  const matches = values.filter((entry) => key(entry) === key(value));
  if (matches.length === 1) return matches[0];
  if (field !== "Volume") return null;
  const compact = normalized(value).replace(/\s/g, "").replace(",", ".");
  const match = compact.match(/^(\d+(?:\.\d+)?)(л|l|литр|литра|литров|мл|ml)?$/u);
  if (!match) return null;
  const litres = Number(match[1]) / (["мл", "ml"].includes(match[2]) ? 1000 : 1);
  const volumes = values.filter((entry) => Math.abs(Number(entry.replace(/\s*л$/u, "").replace(",", ".")) - litres) < 0.000001);
  return volumes.length === 1 ? volumes[0] : null;
}

export function splitAvitoStandards(value: string | null | undefined): string[] {
  return [...new Set((value ?? "").split(/[|;,\n\r]+/u).map((part) => part.trim()).filter(Boolean))];
}

function inherited(override: string | undefined, value: string | null | undefined) { return override === undefined ? value?.trim() ?? "" : override.trim(); }

export function avitoSettingsIssues(settings: AvitoSettings): AvitoIssue[] {
  const issues: AvitoIssue[] = [];
  if (!settings.address.trim() && !settings.sellerAddressId.trim()) issues.push({ field: "address", message: "Укажите адрес филиала в настройках Авито", severity: "error" });
  if (settings.address.length > 256) issues.push({ field: "address", message: "Адрес длиннее 256 символов", severity: "error" });
  if (settings.sellerAddressId && !/^\d{1,30}$/.test(settings.sellerAddressId)) issues.push({ field: "sellerAddressId", message: "Идентификатор адреса должен содержать только цифры", severity: "error" });
  if (settings.contactPerson.length > 40) issues.push({ field: "contactPerson", message: "Имя контактного лица длиннее 40 символов", severity: "error" });
  if (settings.phone && !/^\+?[\d()\s-]{6,40}$/.test(settings.phone)) issues.push({ field: "phone", message: "Укажите один российский номер телефона", severity: "error" });
  for (const [field, template, title] of [["titleTemplate", settings.titleTemplate, true], ["descriptionTemplate", settings.descriptionTemplate, false], ["motorTemplate", settings.categoryDescriptionTemplates.motor, false], ["transmissionTemplate", settings.categoryDescriptionTemplates.transmission, false]] as const) {
    for (const message of avitoTemplateIssues(template, title)) issues.push({ field, message, severity: "error" });
  }
  return issues;
}

export function avitoStockAllowed(source: AvitoProductSource, volume: string, settings: AvitoSettings) {
  if (!settings.onlyInStock) return true;
  const litres = Number(volume.replace(/\s*л$/u, "").replace(",", "."));
  return isLiterSaleUnit(source.uomName) && Number.isFinite(litres) && litres > 0
    ? source.available - settings.stockBuffer >= litres
    : source.available > settings.stockBuffer;
}

export function buildAvitoListing(source: AvitoProductSource, overrides: AvitoOverrides, settings: AvitoSettings, adId: string, remote: AvitoRemoteStatus | null = null): AvitoListing {
  settings = normalizeAvitoSettings(settings);
  const inferred = inferAvitoOilType(source);
  const type = inferred ?? overrides.type ?? "motor";
  const sameFamily = inferred === type;
  const catalog = avitoCatalog(type);
  const rawBrand = inherited(overrides.brand, source.brand);
  const rawSae = inherited(overrides.sae, source.sae);
  const bulk = isLiterSaleUnit(source.uomName);
  const rawVolume = inherited(overrides.volume, bulk ? "" : source.packageVolume);
  const values: AvitoListing["values"] = {
    type,
    title: "", description: "",
    priceRubles: overrides.priceRubles === undefined ? (!bulk && source.salePriceCents % 100 === 0 ? source.salePriceCents / 100 : null) : overrides.priceRubles,
    brand: matchAvitoDictionary(type, "Brand", rawBrand) ?? rawBrand,
    sae: matchAvitoDictionary(type, "SAE", rawSae) ?? rawSae,
    volume: matchAvitoDictionary(type, "Volume", rawVolume) ?? rawVolume,
    acea: type === "motor" ? inherited(overrides.acea, sameFamily ? [source.acea, source.aceaExtra].filter(Boolean).join("; ") : "") : "",
    api: inherited(overrides.api, sameFamily ? source.apiSpec : ""),
    atf: type === "transmission" ? inherited(overrides.atf, sameFamily ? source.atf : "") : "",
    oem: inherited(overrides.oem, sameFamily ? (type === "motor" ? source.oem : source.oemAtf) : ""),
    condition: overrides.condition ?? "Новое",
    avitoId: overrides.avitoId ?? remote?.avitoId ?? "",
    multiItem: overrides.multiItem ?? false,
    multiName: overrides.multiName ?? "",
  };
  let variables = avitoContentVariables(source, settings, values, type);
  const generatedTitle = renderAvitoTemplate(settings.titleTemplate, variables);
  values.title = overrides.title === undefined
    ? settings.autoShortenTitles ? shortenAvitoTitle(generatedTitle, settings.titleRemovePhrases) : generatedTitle
    : overrides.title.trim();
  variables = avitoContentVariables(source, settings, values, type);
  const descriptionTemplate = settings.categoryDescriptionTemplates[type].trim() || settings.descriptionTemplate;
  values.description = inherited(overrides.description, renderAvitoTemplate(descriptionTemplate, variables));
  const issues: AvitoIssue[] = [...avitoSettingsIssues(settings)];
  const error = (field: string, message: string) => issues.push({ field, message, severity: "error" });
  const warning = (field: string, message: string) => issues.push({ field, message, severity: "warning" });
  if (overrides.title === undefined && values.title !== generatedTitle) warning("title", "Заголовок автоматически сокращён до 50 символов. Проверьте предпросмотр");
  if (!inferred) error("type", "Для этого раздела выберите в карточке товара группу моторных или трансмиссионных масел");
  if (source.entityType !== "product") error("type", "В этом разделе выгружаются только товары");
  if (bulk) {
    if (overrides.volume === undefined) error("volume", "Для масла на розлив выберите объём продажи. Объём бочки не используется автоматически");
    if (overrides.priceRubles === undefined) error("priceRubles", "Для масла на розлив задайте цену за выбранный объём продажи");
  }
  if (!values.title || [...values.title].length > 50) error("title", values.title ? "Сократите заголовок до 50 символов" : "Добавьте заголовок объявления");
  if (!values.description || [...values.description].length > 7500) error("description", values.description ? "Сократите описание до 7 500 символов" : "Добавьте описание");
  if (values.priceRubles === null || !Number.isSafeInteger(values.priceRubles) || values.priceRubles <= 0) error("priceRubles", source.salePriceCents % 100 ? "Цена содержит копейки. Укажите цену Авито в целых рублях" : "Укажите цену Авито в целых рублях больше нуля");
  for (const [field, label, entries] of [["brand", "производителя", catalog.Brand], ["sae", "SAE", catalog.SAE], ["volume", "объём", catalog.Volume]] as const) {
    if (!values[field]) error(field, `Выберите ${label}`);
    else if (!(entries as readonly string[]).includes(values[field])) error(field, `Значение «${values[field]}» отсутствует в справочнике ${label} этой категории`);
  }
  const standards = [type === "motor" ? values.acea : values.atf, values.api, values.oem].flatMap(splitAvitoStandards);
  if (!standards.length) error("standards", type === "motor" ? "Заполните ACEA, API или допуски OEM" : "Заполните ATF, API или допуски OEM");
  else warning("standards", "Справочники стандартов не включены в шаблон. Допустимость значений проверит Авито");
  if (standards.some((entry) => entry.length > 250)) error("standards", "Разделяйте стандарты символом | или точкой с запятой");
  if (values.avitoId && !/^[1-9]\d{0,24}$/.test(values.avitoId)) error("avitoId", "Номер объявления Авито должен содержать только цифры");
  if (source.article && !/^[A-Za-z0-9-]{1,50}$/.test(source.article)) warning("article", "Артикул не соответствует формату Авито и не попадёт в отдельное поле «Номер»");
  if (values.multiItem && !/^[\p{L}\p{N}]{1,100}$/u.test(values.multiName)) error("multiName", "Задайте общее название вариантов: только буквы и цифры, без пробелов");
  for (const field of ["title", "description", "brand", "oem", "api", "atf", "acea"] as const) {
    if (/^\s*[=+@-]\s*[A-Za-z_]+\s*\(/.test(values[field])) error(field, "Уберите формулу из текстового поля");
  }
  const allPhotos = source.photos;
  const photos = (overrides.photoIds === undefined ? allPhotos : overrides.photoIds.flatMap((id) => allPhotos.filter((photo) => photo.id === id))).slice(0, 10);
  if (!photos.length) warning("photos", "Без фотографий: публикация допускается, но объявление будет менее заметным");
  if (allPhotos.length > 10 && overrides.photoIds === undefined) warning("photos", "Будут использованы первые 10 фотографий");
  const stockAllowed = avitoStockAllowed(source, values.volume, settings);
  return {
    source,
    id: source.id, adId, name: source.name, article: source.article, type, enabled: source.avito === true,
    archived: source.archived, available: source.available, sourcePriceCents: source.salePriceCents, sourceUpdatedAt: source.updatedAt,
    overrides, values, photos, allPhotos, issues,
    included: source.avito === true && !source.archived && stockAllowed && !issues.some((issue) => issue.severity === "error"), remote,
  };
}

export function avitoFeedStats(listings: AvitoListing[], settings: AvitoSettings, previousIds: readonly string[] = []): AvitoFeedStats {
  const selected = listings.filter((listing) => listing.enabled);
  const eligible = selected.filter((listing) => !listing.archived && avitoStockAllowed(listing.source, listing.values.volume, settings));
  const includedIds = new Set(listings.filter((listing) => listing.included).map((listing) => listing.adId));
  return {
    selected: selected.length, included: includedIds.size,
    outOfStock: selected.filter((listing) => !listing.archived && !avitoStockAllowed(listing.source, listing.values.volume, settings)).length,
    invalid: eligible.filter((listing) => listing.issues.some((issue) => issue.severity === "error")).length,
    warnings: eligible.filter((listing) => listing.issues.some((issue) => issue.severity === "warning")).length,
    withdrawals: previousIds.filter((id) => !includedIds.has(id)).length,
  };
}

export function avitoRemoteLabel(status: string | undefined) {
  const labels: Record<string, string> = { active: "Опубликовано", old: "Опубликовано", rejected: "Отклонено", error: "Ошибка", blocked: "Заблокировано", removed: "Снято", closed: "Снято", archived: "В архиве", processing: "Обрабатывается", pending: "Обрабатывается", expired: "Истёк срок", unknown: "Неизвестный статус" };
  return status ? labels[status.toLowerCase()] ?? status : "Нет подтверждения";
}

export const AVITO_CSV_COLUMNS = [
  "Уникальный идентификатор объявления", "Номер объявления на Авито", "Категория", "Вид товара", "Тип товара", "Вид объявления",
  "Название объявления", "Описание объявления", "Цена", "Адрес", "Идентификатор адреса", "Контактное лицо", "Номер телефона", "Способ связи",
  "Производитель", "Класс вязкости SAE", "Объём", "Стандарт ACEA", "Стандарт ATF", "Стандарт API", "Допуски OEM", "Состояние", "Номер",
  "Ссылки на фото", "Соединять это объявление с другими объявлениями", "Название мультиобъявления", "Способ размещения", "Услуга продвижения",
] as const;

function csvCell(value: string | number | null) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

/** RFC 4180, UTF-8 BOM, Russian parameter names throughout; XLSX instruction rows do not belong in CSV. */
export function buildAvitoCsv(listings: AvitoListing[], settings: AvitoSettings, photoUrl: (photoId: string) => string): string {
  const included = listings.filter((listing) => listing.included);
  if (included.length > AVITO_MAX_ADS) throw new Error("В одном файле может быть не больше 50 000 объявлений");
  const rows: Array<Array<string | number | null>> = [Array.from(AVITO_CSV_COLUMNS)];
  for (const listing of included) {
    const value = listing.values;
    rows.push([
      listing.adId, value.avitoId, "Запчасти и аксессуары", "Масла и автохимия", AVITO_TYPE_LABELS[listing.type], "Товар приобретен на продажу",
      value.title, value.description, value.priceRubles, settings.sellerAddressId ? "" : settings.address, settings.sellerAddressId,
      settings.contactPerson, settings.phone, settings.contactMethod,
      value.brand, value.sae, value.volume, listing.type === "motor" ? splitAvitoStandards(value.acea).join(" | ") : "",
      listing.type === "transmission" ? splitAvitoStandards(value.atf).join(" | ") : "", splitAvitoStandards(value.api).join(" | "), splitAvitoStandards(value.oem).join(" | "),
      value.condition, listing.article && /^[A-Za-z0-9-]{1,50}$/.test(listing.article) ? listing.article : "",
      listing.photos.map((photo) => photoUrl(photo.id)).join(" | "), value.multiItem ? "Да" : "Нет", value.multiItem ? value.multiName : "", settings.listingFee, "Free",
    ]);
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
