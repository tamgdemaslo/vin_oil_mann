export type SalesAnalyticsMetricType = "PRODUCT_CATEGORY" | "SERVICE_OPERATION";
export type SalesAnalyticsUnit = "PCS" | "LITER" | "OPERATION";
export type SalesAnalyticsSourceType = "CATALOG_GROUP" | "CATALOG_ITEM" | "LEGACY_NAME";
export type SalesAnalyticsMatchMethod =
  | "SNAPSHOT"
  | "SAVED_CODE"
  | "ID"
  | "GROUP"
  | "STRUCTURED_RAW"
  | "VERIFIED_LEGACY"
  | "MANUAL";

export type SalesAnalyticsMetricDefinition = {
  code: string;
  type: SalesAnalyticsMetricType;
  title: string;
  unit: SalesAnalyticsUnit;
  sortOrder: number;
  active: boolean;
  parentCode?: string | null;
};

export type ServiceAggregateType = "AUTOMATIC" | "CVT" | "DCT_DSG" | "MANUAL" | "UNKNOWN";
export type ServiceProcedure = "PARTIAL" | "MACHINE" | "STANDARD" | "UNKNOWN";
export type ServiceConfiguration = "NO_PAN" | "PAN_AND_FILTER" | "TWO_FILTERS" | "OTHER" | "UNKNOWN";

export type SalesAnalyticsMappingValue = {
  metricCode: string;
  matchMethod: SalesAnalyticsMatchMethod;
  version: number;
  aggregateType?: ServiceAggregateType | null;
  procedure?: ServiceProcedure | null;
  configuration?: ServiceConfiguration | null;
};

export type SalesAnalyticsClassification = {
  kind: "product" | "service";
  status: "classified" | "unclassified";
  metricCode: string | null;
  metricTitle: string | null;
  metricUnit: SalesAnalyticsUnit | null;
  matchMethod: SalesAnalyticsMatchMethod | null;
  mappingVersion: number | null;
  aggregateType: ServiceAggregateType | null;
  procedure: ServiceProcedure | null;
  configuration: ServiceConfiguration | null;
  baseQuantity: number | null;
  baseUnit: SalesAnalyticsUnit | null;
  manualSourceType: SalesAnalyticsSourceType;
  manualSourceId: string;
  reason: string | null;
};

export const PRODUCT_CATEGORY_CODES = [
  "ENGINE_OIL",
  "TRANSMISSION_FLUID",
  "OIL_FILTER",
  "AIR_FILTER",
  "CABIN_FILTER",
  "FUEL_FILTER",
  "TRANSMISSION_FILTER",
  "BRAKE_FLUID",
  "COOLANT",
  "AUTOCHEMISTRY",
  "SEALS_GASKETS",
  "OTHER_PRODUCT",
] as const;

export const SERVICE_OPERATION_CODES = [
  "ENGINE_OIL_CHANGE",
  "AIR_FILTER_REPLACEMENT",
  "CABIN_FILTER_REPLACEMENT",
  "FUEL_FILTER_REPLACEMENT",
  "TRANSMISSION_FLUID_SERVICE",
  "TRANSFER_CASE_FLUID_CHANGE",
  "FRONT_DIFFERENTIAL_FLUID_CHANGE",
  "REAR_DIFFERENTIAL_FLUID_CHANGE",
  "BRAKE_FLUID_CHANGE",
  "COOLANT_CHANGE",
  "DIAGNOSTIC",
  "OTHER_SERVICE",
] as const;

export const SALES_ANALYTICS_METRICS: readonly SalesAnalyticsMetricDefinition[] = [
  { code: "ENGINE_OIL", type: "PRODUCT_CATEGORY", title: "Моторное масло", unit: "LITER", sortOrder: 10, active: true },
  { code: "TRANSMISSION_FLUID", type: "PRODUCT_CATEGORY", title: "Трансмиссионное масло / ATF / CVT Fluid", unit: "LITER", sortOrder: 20, active: true },
  { code: "OIL_FILTER", type: "PRODUCT_CATEGORY", title: "Масляные фильтры", unit: "PCS", sortOrder: 30, active: true },
  { code: "AIR_FILTER", type: "PRODUCT_CATEGORY", title: "Воздушные фильтры", unit: "PCS", sortOrder: 40, active: true },
  { code: "CABIN_FILTER", type: "PRODUCT_CATEGORY", title: "Салонные фильтры", unit: "PCS", sortOrder: 50, active: true },
  { code: "FUEL_FILTER", type: "PRODUCT_CATEGORY", title: "Топливные фильтры", unit: "PCS", sortOrder: 60, active: true },
  { code: "TRANSMISSION_FILTER", type: "PRODUCT_CATEGORY", title: "Фильтры и поддоны АКПП / CVT", unit: "PCS", sortOrder: 70, active: true },
  { code: "BRAKE_FLUID", type: "PRODUCT_CATEGORY", title: "Тормозная жидкость", unit: "LITER", sortOrder: 80, active: true },
  { code: "COOLANT", type: "PRODUCT_CATEGORY", title: "Антифриз", unit: "LITER", sortOrder: 90, active: true },
  { code: "AUTOCHEMISTRY", type: "PRODUCT_CATEGORY", title: "Автохимия", unit: "PCS", sortOrder: 100, active: true },
  { code: "SEALS_GASKETS", type: "PRODUCT_CATEGORY", title: "Прокладки, пробки и уплотнения", unit: "PCS", sortOrder: 110, active: true },
  { code: "OTHER_PRODUCT", type: "PRODUCT_CATEGORY", title: "Другие товары", unit: "PCS", sortOrder: 120, active: true },
  { code: "ENGINE_OIL_CHANGE", type: "SERVICE_OPERATION", title: "Замена моторного масла", unit: "OPERATION", sortOrder: 210, active: true },
  { code: "AIR_FILTER_REPLACEMENT", type: "SERVICE_OPERATION", title: "Замена воздушного фильтра", unit: "OPERATION", sortOrder: 220, active: true },
  { code: "CABIN_FILTER_REPLACEMENT", type: "SERVICE_OPERATION", title: "Замена салонного фильтра", unit: "OPERATION", sortOrder: 230, active: true },
  { code: "FUEL_FILTER_REPLACEMENT", type: "SERVICE_OPERATION", title: "Замена топливного фильтра", unit: "OPERATION", sortOrder: 240, active: true },
  { code: "TRANSMISSION_FLUID_SERVICE", type: "SERVICE_OPERATION", title: "Обслуживание трансмиссии", unit: "OPERATION", sortOrder: 250, active: true },
  { code: "TRANSFER_CASE_FLUID_CHANGE", type: "SERVICE_OPERATION", title: "Замена масла в раздатке", unit: "OPERATION", sortOrder: 260, active: true },
  { code: "FRONT_DIFFERENTIAL_FLUID_CHANGE", type: "SERVICE_OPERATION", title: "Замена масла в переднем редукторе", unit: "OPERATION", sortOrder: 270, active: true },
  { code: "REAR_DIFFERENTIAL_FLUID_CHANGE", type: "SERVICE_OPERATION", title: "Замена масла в заднем редукторе", unit: "OPERATION", sortOrder: 280, active: true },
  { code: "BRAKE_FLUID_CHANGE", type: "SERVICE_OPERATION", title: "Замена тормозной жидкости", unit: "OPERATION", sortOrder: 290, active: true },
  { code: "COOLANT_CHANGE", type: "SERVICE_OPERATION", title: "Замена антифриза", unit: "OPERATION", sortOrder: 300, active: true },
  { code: "DIAGNOSTIC", type: "SERVICE_OPERATION", title: "Диагностика", unit: "OPERATION", sortOrder: 310, active: true },
  { code: "OTHER_SERVICE", type: "SERVICE_OPERATION", title: "Другие услуги", unit: "OPERATION", sortOrder: 320, active: true },
] as const;

export const SALES_ANALYTICS_METRIC_BY_CODE = new Map(
  SALES_ANALYTICS_METRICS.map((metric) => [metric.code, metric] as const),
);

export const VERIFIED_SERVICE_ITEM_MAPPINGS: Readonly<Record<string, SalesAnalyticsMappingValue>> = {
  cmphdnx1z01sm8zksgngu23b7: { metricCode: "ENGINE_OIL_CHANGE", matchMethod: "ID", version: 1 },
  cmphdo2mc01t48zksevroqafy: { metricCode: "AIR_FILTER_REPLACEMENT", matchMethod: "ID", version: 1 },
  cmphdnwh201sk8zksfqm75ji8: {
    metricCode: "TRANSMISSION_FLUID_SERVICE",
    matchMethod: "ID",
    version: 1,
    aggregateType: "UNKNOWN",
    procedure: "PARTIAL",
    configuration: "UNKNOWN",
  },
  cmphdo00h01sw8zkszvuoqkrd: { metricCode: "CABIN_FILTER_REPLACEMENT", matchMethod: "ID", version: 1 },
  cmphdnvw601si8zkssrecv1st: {
    metricCode: "TRANSMISSION_FLUID_SERVICE",
    matchMethod: "ID",
    version: 1,
    aggregateType: "UNKNOWN",
    procedure: "MACHINE",
    configuration: "UNKNOWN",
  },
  cmphdo0vn01sy8zksk93r3s86: { metricCode: "FUEL_FILTER_REPLACEMENT", matchMethod: "ID", version: 1 },
  cmphdnvbh01sg8zksw77y6k78: { metricCode: "REAR_DIFFERENTIAL_FLUID_CHANGE", matchMethod: "ID", version: 1 },
  cmphdnyti01ss8zkst25ozud4: { metricCode: "TRANSFER_CASE_FLUID_CHANGE", matchMethod: "ID", version: 1 },
  cmphdo1gl01t08zkskn4tsbpd: {
    metricCode: "TRANSMISSION_FLUID_SERVICE",
    matchMethod: "ID",
    version: 1,
    aggregateType: "MANUAL",
    procedure: "STANDARD",
    configuration: "UNKNOWN",
  },
  cmphdo3s901t88zksj9bc309u: { metricCode: "FRONT_DIFFERENTIAL_FLUID_CHANGE", matchMethod: "ID", version: 1 },
  cmphdo2bw01t38zksr8sllkxn: { metricCode: "BRAKE_FLUID_CHANGE", matchMethod: "ID", version: 1 },
};

export function normalizeSalesAnalyticsText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

const PRODUCT_GROUP_NAME_CODES: Readonly<Record<string, string>> = {
  "масло в канистрах моторное/масло в канистрах моторное": "ENGINE_OIL",
  "масло моторное в бочках на розлив": "ENGINE_OIL",
  "масло в канистрах трансмисионное": "TRANSMISSION_FLUID",
  "масло в канистрах трансмиссионное": "TRANSMISSION_FLUID",
  "масло трансмиссионное в бочках на розлив": "TRANSMISSION_FLUID",
  "масляные фильтры": "OIL_FILTER",
  "воздушные фильтры": "AIR_FILTER",
  "салонные фильтры": "CABIN_FILTER",
  "топливные фильтры": "FUEL_FILTER",
  "масляные фильтры акпп": "TRANSMISSION_FILTER",
  "фильтры и поддоны акпп / cvt": "TRANSMISSION_FILTER",
  "тормозная жидкость": "BRAKE_FLUID",
  антифриз: "COOLANT",
  автохимия: "AUTOCHEMISTRY",
  "уплотнительные кольца и проклдаки": "SEALS_GASKETS",
  "уплотнительные кольца и прокладки": "SEALS_GASKETS",
};

const ONE_OFF_PRODUCT_CODE_MAP: Readonly<Record<string, string>> = {
  ENGINE_OIL: "ENGINE_OIL",
  TRANSMISSION_FLUID: "TRANSMISSION_FLUID",
  OIL_FILTER: "OIL_FILTER",
  AIR_FILTER: "AIR_FILTER",
  CABIN_FILTER: "CABIN_FILTER",
  FUEL_FILTER: "FUEL_FILTER",
  TRANSMISSION_FILTER: "TRANSMISSION_FILTER",
  GASKET_OR_PAN: "SEALS_GASKETS",
  DRAIN_PLUG_OR_SEAL: "SEALS_GASKETS",
  ANTIFREEZE: "COOLANT",
  CONSUMABLE: "OTHER_PRODUCT",
  SPARE_PART: "OTHER_PRODUCT",
  OTHER: "OTHER_PRODUCT",
};

const VERIFIED_LEGACY_SERVICE_NAMES: Readonly<Record<string, SalesAnalyticsMappingValue>> = {
  "работа по замене моторного масла и масляного фильтра": {
    metricCode: "ENGINE_OIL_CHANGE",
    matchMethod: "VERIFIED_LEGACY",
    version: 1,
  },
  "работа по замене моторного масла": {
    metricCode: "ENGINE_OIL_CHANGE",
    matchMethod: "VERIFIED_LEGACY",
    version: 1,
  },
  "проверка уровня масла в акпп": {
    metricCode: "DIAGNOSTIC",
    matchMethod: "VERIFIED_LEGACY",
    version: 1,
  },
  "проверка уровня масла в трансмиссии": {
    metricCode: "DIAGNOSTIC",
    matchMethod: "VERIFIED_LEGACY",
    version: 1,
  },
  "замена толпивного фильтра": {
    metricCode: "FUEL_FILTER_REPLACEMENT",
    matchMethod: "VERIFIED_LEGACY",
    version: 1,
  },
  "замена антфриза": {
    metricCode: "COOLANT_CHANGE",
    matchMethod: "VERIFIED_LEGACY",
    version: 1,
  },
  "замена антифриза и проверка системы охлаждения": {
    metricCode: "COOLANT_CHANGE",
    matchMethod: "VERIFIED_LEGACY",
    version: 1,
  },
  "замена клапана тнвд": {
    metricCode: "OTHER_SERVICE",
    matchMethod: "VERIFIED_LEGACY",
    version: 1,
  },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return allowed.includes(normalized as T) ? normalized as T : null;
}

export function salesAnalyticsMappingKey(sourceType: SalesAnalyticsSourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

function structuredOneOffProduct(raw: unknown): Record<string, unknown> {
  return record(record(raw).oneOffProduct);
}

function structuredOneOffService(raw: unknown): Record<string, unknown> {
  return record(record(raw).oneOffService);
}

function sourceForManual(input: {
  kind: "product" | "service";
  productId?: string | null;
  groupId?: string | null;
  positionName: string;
}): { sourceType: SalesAnalyticsSourceType; sourceId: string } {
  if (input.kind === "product" && input.groupId) return { sourceType: "CATALOG_GROUP", sourceId: input.groupId };
  if (input.productId) return { sourceType: "CATALOG_ITEM", sourceId: input.productId };
  return { sourceType: "LEGACY_NAME", sourceId: normalizeSalesAnalyticsText(input.positionName) };
}

function validMapping(
  mapping: SalesAnalyticsMappingValue | null | undefined,
  kind: "product" | "service",
  metrics: ReadonlyMap<string, SalesAnalyticsMetricDefinition>,
): SalesAnalyticsMappingValue | null {
  if (!mapping) return null;
  const metric = metrics.get(mapping.metricCode);
  if (!metric || !metric.active) return null;
  if (kind === "product" && metric.type !== "PRODUCT_CATEGORY") return null;
  if (kind === "service" && metric.type !== "SERVICE_OPERATION") return null;
  return mapping;
}

function baseQuantity(input: {
  kind: "product" | "service";
  metric: SalesAnalyticsMetricDefinition;
  quantity: number;
  raw: unknown;
  uomName?: string | null;
  savedBaseQuantity?: number | null;
  savedBaseUnit?: string | null;
}): { quantity: number | null; unit: SalesAnalyticsUnit | null } {
  if (input.kind === "service") return { quantity: null, unit: "OPERATION" };
  if (
    input.savedBaseQuantity != null
    && Number.isFinite(input.savedBaseQuantity)
    && input.savedBaseQuantity >= 0
    && input.savedBaseUnit === input.metric.unit
  ) {
    return { quantity: input.savedBaseQuantity, unit: input.metric.unit };
  }
  if (input.metric.unit === "PCS") return { quantity: input.quantity, unit: "PCS" };
  const oneOff = structuredOneOffProduct(input.raw);
  if (input.metric.unit === "LITER" && text(oneOff.uomCode)?.toUpperCase() === "L") {
    return { quantity: input.quantity, unit: "LITER" };
  }
  const uom = normalizeSalesAnalyticsText(input.uomName);
  if (input.metric.unit === "LITER" && ["л", "л.", "литр", "литры", "литров"].includes(uom)) {
    return { quantity: input.quantity, unit: "LITER" };
  }
  return { quantity: null, unit: null };
}

export function classifySalesAnalyticsLine(input: {
  kind: "product" | "service";
  productId?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  positionName: string;
  quantity: number;
  uomName?: string | null;
  raw?: unknown;
  snapshot?: {
    metricCode?: string | null;
    matchMethod?: string | null;
    mappingVersion?: number | null;
    categoryLabel?: string | null;
    aggregateType?: string | null;
    procedure?: string | null;
    configuration?: string | null;
    baseQuantity?: number | null;
    baseUnit?: string | null;
  } | null;
  mappings?: ReadonlyMap<string, SalesAnalyticsMappingValue>;
  metrics?: ReadonlyMap<string, SalesAnalyticsMetricDefinition>;
}): SalesAnalyticsClassification {
  const metrics = input.metrics ?? SALES_ANALYTICS_METRIC_BY_CODE;
  const manual = sourceForManual(input);
  const rawService = structuredOneOffService(input.raw);
  const rawProduct = structuredOneOffProduct(input.raw);
  const snapshotMetricCode = text(input.snapshot?.metricCode);
  let mapping: SalesAnalyticsMappingValue | null = snapshotMetricCode
    ? validMapping({
        metricCode: snapshotMetricCode,
        matchMethod: "SNAPSHOT",
        version: input.snapshot?.mappingVersion ?? 1,
        aggregateType: enumValue(input.snapshot?.aggregateType, ["AUTOMATIC", "CVT", "DCT_DSG", "MANUAL", "UNKNOWN"] as const),
        procedure: enumValue(input.snapshot?.procedure, ["PARTIAL", "MACHINE", "STANDARD", "UNKNOWN"] as const),
        configuration: enumValue(input.snapshot?.configuration, ["NO_PAN", "PAN_AND_FILTER", "TWO_FILTERS", "OTHER", "UNKNOWN"] as const),
      }, input.kind, metrics)
    : null;

  if (!mapping && input.kind === "service") {
    const savedCode = text(rawService.analyticsMetricCode)?.toUpperCase();
    if (savedCode) {
      mapping = validMapping({
        metricCode: savedCode,
        matchMethod: "SAVED_CODE",
        version: Number(rawService.classificationVersion) || 1,
        aggregateType: enumValue(rawService.aggregateType, ["AUTOMATIC", "CVT", "DCT_DSG", "MANUAL", "UNKNOWN"] as const),
        procedure: enumValue(rawService.procedure, ["PARTIAL", "MACHINE", "STANDARD", "UNKNOWN"] as const),
        configuration: enumValue(rawService.configuration, ["NO_PAN", "PAN_AND_FILTER", "TWO_FILTERS", "OTHER", "UNKNOWN"] as const),
      }, input.kind, metrics);
    }
  }

  if (!mapping && input.productId) {
    mapping = validMapping(input.mappings?.get(salesAnalyticsMappingKey("CATALOG_ITEM", input.productId)), input.kind, metrics);
  }
  if (!mapping && input.groupId) {
    mapping = validMapping(input.mappings?.get(salesAnalyticsMappingKey("CATALOG_GROUP", input.groupId)), input.kind, metrics);
  }
  if (!mapping && input.kind === "product") {
    const oneOffCode = text(rawProduct.groupCode)?.toUpperCase();
    const metricCode = oneOffCode ? ONE_OFF_PRODUCT_CODE_MAP[oneOffCode] : null;
    if (metricCode) mapping = validMapping({ metricCode, matchMethod: "STRUCTURED_RAW", version: 1 }, input.kind, metrics);
  }
  if (!mapping && input.kind === "service" && input.productId) {
    mapping = validMapping(VERIFIED_SERVICE_ITEM_MAPPINGS[input.productId], input.kind, metrics);
  }
  if (!mapping && input.kind === "product") {
    const metricCode = PRODUCT_GROUP_NAME_CODES[normalizeSalesAnalyticsText(input.groupName)];
    if (metricCode) mapping = validMapping({ metricCode, matchMethod: "VERIFIED_LEGACY", version: 1 }, input.kind, metrics);
  }
  if (!mapping && input.kind === "service" && !input.productId) {
    mapping = validMapping(VERIFIED_LEGACY_SERVICE_NAMES[normalizeSalesAnalyticsText(input.positionName)], input.kind, metrics);
  }
  if (!mapping && manual.sourceId) {
    mapping = validMapping(input.mappings?.get(salesAnalyticsMappingKey(manual.sourceType, manual.sourceId)), input.kind, metrics);
  }

  const metric = mapping ? metrics.get(mapping.metricCode) ?? null : null;
  if (!mapping || !metric) {
    return {
      kind: input.kind,
      status: "unclassified",
      metricCode: null,
      metricTitle: null,
      metricUnit: null,
      matchMethod: null,
      mappingVersion: null,
      aggregateType: null,
      procedure: null,
      configuration: null,
      baseQuantity: null,
      baseUnit: null,
      manualSourceType: manual.sourceType,
      manualSourceId: manual.sourceId,
      reason: manual.sourceId ? "Для источника ещё не сохранён analytics mapping" : "Недостаточно устойчивых данных для классификации",
    };
  }

  const normalizedBase = baseQuantity({
    kind: input.kind,
    metric,
    quantity: input.quantity,
    raw: input.raw,
    uomName: input.uomName,
    savedBaseQuantity: input.snapshot?.baseQuantity,
    savedBaseUnit: input.snapshot?.baseUnit,
  });
  return {
    kind: input.kind,
    status: "classified",
    metricCode: metric.code,
    metricTitle: input.snapshot?.categoryLabel?.trim() || metric.title,
    metricUnit: metric.unit,
    matchMethod: mapping.matchMethod,
    mappingVersion: mapping.version,
    aggregateType: input.kind === "service" ? mapping.aggregateType ?? null : null,
    procedure: input.kind === "service" ? mapping.procedure ?? null : null,
    configuration: input.kind === "service" ? mapping.configuration ?? null : null,
    baseQuantity: normalizedBase.quantity,
    baseUnit: normalizedBase.unit,
    manualSourceType: manual.sourceType,
    manualSourceId: manual.sourceId,
    reason: metric.unit === "LITER" && normalizedBase.quantity == null
      ? "Категория определена, но литры нельзя подтвердить из структурированных данных"
      : null,
  };
}

export function metricOptions(type: SalesAnalyticsMetricType) {
  return SALES_ANALYTICS_METRICS.filter((metric) => metric.type === type && metric.active);
}
