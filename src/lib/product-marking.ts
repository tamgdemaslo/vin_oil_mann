export const PRODUCT_MARKING_MODE_VALUES = [
  "NOT_MARKED",
  "PACKAGED_MARKED_GOOD",
  "BULK_OIL_FROM_MARKED_BARREL",
  "REQUIRES_CHECK",
] as const;

export type ProductMarkingMode = (typeof PRODUCT_MARKING_MODE_VALUES)[number];

export const PRODUCT_MARKING_STATUS_VALUES = [
  "NOT_MARKED",
  "PACKAGED_READY",
  "BULK_OIL_READY",
  "REQUIRES_CHECK",
  "CONFIG_ERROR",
  "BARREL_BLOCKED",
  "CODE_MAY_BE_WITHDRAWN",
] as const;

export type ProductMarkingStatus = (typeof PRODUCT_MARKING_STATUS_VALUES)[number];

export type ProductMarkingSettings = {
  allowRepeatedBarrelCode: boolean;
  partialWithdrawalEnabled: boolean;
  allowSaleWithoutActiveBarrel: boolean;
  declaredVolumeLiters: number | null;
  nonDrainableRemainderPercent: number | null;
  activeBarrelName: string;
  activeBarrelMarkingCode: string;
  activeBarrelGtin: string;
  verificationStatus: string;
  currentVolumeLiters: number | null;
};

export const DEFAULT_MARKING_SETTINGS: ProductMarkingSettings = {
  allowRepeatedBarrelCode: false,
  partialWithdrawalEnabled: false,
  allowSaleWithoutActiveBarrel: false,
  declaredVolumeLiters: null,
  nonDrainableRemainderPercent: null,
  activeBarrelName: "",
  activeBarrelMarkingCode: "",
  activeBarrelGtin: "",
  verificationStatus: "",
  currentVolumeLiters: null,
};

export const DEFAULT_BULK_OIL_MARKING_SETTINGS: ProductMarkingSettings = {
  ...DEFAULT_MARKING_SETTINGS,
  allowRepeatedBarrelCode: true,
  partialWithdrawalEnabled: true,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "да"].includes(normalized)) return true;
    if (["0", "false", "no", "нет"].includes(normalized)) return false;
  }
  return fallback;
}

export function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function isProductMarkingMode(value: unknown): value is ProductMarkingMode {
  return PRODUCT_MARKING_MODE_VALUES.includes(value as ProductMarkingMode);
}

export function normalizeProductMarkingMode(value: unknown): ProductMarkingMode {
  return isProductMarkingMode(value) ? value : "NOT_MARKED";
}

export function isProductMarkingStatus(value: unknown): value is ProductMarkingStatus {
  return PRODUCT_MARKING_STATUS_VALUES.includes(value as ProductMarkingStatus);
}

export function normalizeProductMarkingStatus(value: unknown): ProductMarkingStatus {
  return isProductMarkingStatus(value) ? value : "REQUIRES_CHECK";
}

export function isBulkOilMarkingMode(value: unknown): boolean {
  return value === "BULK_OIL_FROM_MARKED_BARREL";
}

export function isPackagedMarkedGoodMode(value: unknown): boolean {
  return value === "PACKAGED_MARKED_GOOD";
}

export function isLiterSaleUnit(value?: string | null): boolean {
  const normalized = (value ?? "").trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  return /^(л|литр|литра|литров|l|liter|litre)$/.test(normalized);
}

export type ProductMarkingGroupDefault = "PACKAGED" | "BULK_OIL" | "NONE";

function normalizeMarkingGroupText(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function productMarkingDefaultForGroup(groupPath?: string | null): ProductMarkingGroupDefault {
  const group = normalizeMarkingGroupText(groupPath ?? "");
  if (!group) return "NONE";
  const oilGroup = /масл|моторн|трансмис|смаз|oil|atf|cvt|dct|dexron|gear/.test(group);
  const bulkGroup = /бочк|розлив|разлив|налив|bulk/.test(group);
  const packagedGroup = /канистр|упаков|бутыл|флакон|штуч|package|bottle/.test(group);
  if (oilGroup && bulkGroup) return "BULK_OIL";
  if (oilGroup && packagedGroup) return "PACKAGED";
  return "NONE";
}

export function normalizeProductMarkingSettings(value: unknown): ProductMarkingSettings {
  const record = asRecord(value);
  return {
    allowRepeatedBarrelCode: booleanValue(record.allowRepeatedBarrelCode),
    partialWithdrawalEnabled: booleanValue(record.partialWithdrawalEnabled),
    allowSaleWithoutActiveBarrel: booleanValue(record.allowSaleWithoutActiveBarrel),
    declaredVolumeLiters: numberOrNull(record.declaredVolumeLiters),
    nonDrainableRemainderPercent: numberOrNull(record.nonDrainableRemainderPercent),
    activeBarrelName: stringValue(record.activeBarrelName),
    activeBarrelMarkingCode: stringValue(record.activeBarrelMarkingCode),
    activeBarrelGtin: stringValue(record.activeBarrelGtin),
    verificationStatus: stringValue(record.verificationStatus),
    currentVolumeLiters: numberOrNull(record.currentVolumeLiters),
  };
}

export function bulkOilSetupProblems(input: {
  markingEnabled: boolean;
  markingMode: ProductMarkingMode;
  uomName?: string | null;
  settings?: unknown;
}): string[] {
  if (!input.markingEnabled || input.markingMode !== "BULK_OIL_FROM_MARKED_BARREL") return [];
  const settings = normalizeProductMarkingSettings(input.settings);
  const problems: string[] = [];
  if (!isLiterSaleUnit(input.uomName)) problems.push("Единица продажи должна быть литр.");
  if (!settings.declaredVolumeLiters || settings.declaredVolumeLiters <= 0) problems.push("Укажите объём бочки.");
  if (!settings.partialWithdrawalEnabled) problems.push("Включите частичное выбытие.");
  if (!settings.allowRepeatedBarrelCode) problems.push("Разрешите повторное использование кода в рамках активной бочки.");
  if (!settings.allowSaleWithoutActiveBarrel && !settings.activeBarrelMarkingCode) {
    problems.push("Выберите активную бочку с кодом маркировки.");
  }
  if (settings.currentVolumeLiters == null && !settings.allowSaleWithoutActiveBarrel) {
    problems.push("Укажите остаток активной бочки в литрах.");
  }
  return problems;
}

export function deriveProductMarkingStatus(input: {
  markingEnabled: boolean;
  markingMode: ProductMarkingMode;
  uomName?: string | null;
  settings?: unknown;
}): ProductMarkingStatus {
  if (!input.markingEnabled || input.markingMode === "NOT_MARKED") return "NOT_MARKED";
  if (input.markingMode === "PACKAGED_MARKED_GOOD") return "PACKAGED_READY";
  if (input.markingMode === "REQUIRES_CHECK") return "REQUIRES_CHECK";
  const problems = bulkOilSetupProblems(input);
  if (problems.some((problem) => problem.includes("Единица"))) return "CONFIG_ERROR";
  return problems.length ? "REQUIRES_CHECK" : "BULK_OIL_READY";
}

export function productMarkingModeLabel(mode: ProductMarkingMode): string {
  if (mode === "PACKAGED_MARKED_GOOD") return "Обычная маркированная упаковка";
  if (mode === "BULK_OIL_FROM_MARKED_BARREL") return "Масло на разлив из бочки";
  if (mode === "REQUIRES_CHECK") return "Не настроено / требует проверки";
  return "Не маркируется";
}

export function productMarkingStatusLabel(status: ProductMarkingStatus): string {
  if (status === "PACKAGED_READY") return "Обычная маркированная упаковка";
  if (status === "BULK_OIL_READY") return "Масло на разлив настроено";
  if (status === "REQUIRES_CHECK") return "Требует настройки";
  if (status === "CONFIG_ERROR") return "Ошибка настройки";
  if (status === "BARREL_BLOCKED") return "Бочка заблокирована";
  if (status === "CODE_MAY_BE_WITHDRAWN") return "Код мог быть выведен из оборота";
  return "Не маркируется";
}

export function productMarkingStatusText(input: {
  markingEnabled: boolean;
  markingMode: ProductMarkingMode;
  markingStatus: ProductMarkingStatus;
}): string {
  if (!input.markingEnabled || input.markingMode === "NOT_MARKED") return "Не маркируется";
  if (input.markingMode === "BULK_OIL_FROM_MARKED_BARREL" && input.markingStatus === "BULK_OIL_READY") {
    return "Масло на разлив · код бочки используется до исчерпания объёма";
  }
  if (input.markingMode === "PACKAGED_MARKED_GOOD") {
    return "Обычная маркированная упаковка · код списывается целиком";
  }
  return productMarkingStatusLabel(input.markingStatus);
}

export function productMarkingProblemReasons(input: {
  markingEnabled: boolean;
  markingMode?: string | null;
  markingStatus?: string | null;
  groupPath?: string | null;
  uomName?: string | null;
  settings?: unknown;
}): string[] {
  const mode = normalizeProductMarkingMode(input.markingMode);
  const status = normalizeProductMarkingStatus(input.markingStatus);
  const groupDefault = productMarkingDefaultForGroup(input.groupPath);
  const reasons: string[] = [];

  if (status === "CONFIG_ERROR") reasons.push("Ошибка настройки маркировки.");
  if (status === "BARREL_BLOCKED") reasons.push("Бочка заблокирована.");
  if (status === "CODE_MAY_BE_WITHDRAWN") reasons.push("Код мог быть выведен из оборота.");
  if (input.markingStatus === "REQUIRES_CHECK") reasons.push("Статус проверки требует настройки.");

  if (!input.markingEnabled || mode === "NOT_MARKED") {
    if (groupDefault === "BULK_OIL") reasons.push("Товар в группе разливного масла, но маркировка не настроена.");
    return [...new Set(reasons)];
  }

  if (mode === "REQUIRES_CHECK") reasons.push("Сценарий маркировки требует проверки.");
  if (mode === "PACKAGED_MARKED_GOOD" && isLiterSaleUnit(input.uomName)) {
    reasons.push("Товар продаётся в литрах, но настроен как обычная упаковка.");
  }
  if (mode === "PACKAGED_MARKED_GOOD" && groupDefault === "BULK_OIL") {
    reasons.push("Разливной товар настроен как обычная упаковка.");
  }
  if (groupDefault === "BULK_OIL" && mode !== "BULK_OIL_FROM_MARKED_BARREL") {
    reasons.push("Для группы разливного масла нужен сценарий бочки.");
  }
  if (mode === "BULK_OIL_FROM_MARKED_BARREL") {
    reasons.push(...bulkOilSetupProblems({
      markingEnabled: input.markingEnabled,
      markingMode: mode,
      uomName: input.uomName,
      settings: input.settings,
    }));
  }

  return [...new Set(reasons)];
}

export function productHasMarkingProblem(input: {
  markingEnabled: boolean;
  markingMode?: string | null;
  markingStatus?: string | null;
  groupPath?: string | null;
  uomName?: string | null;
  settings?: unknown;
}): boolean {
  return productMarkingProblemReasons(input).length > 0;
}
