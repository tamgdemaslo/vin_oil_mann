export type MoySkladFeatureFlags = {
  enabled: boolean;
  readEnabled: boolean;
  writeEnabled: boolean;
  syncEnabled: boolean;
  debugEnabled: boolean;
};

function envFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value == null || value === "") return defaultValue;
  if (["0", "false", "no", "off", "disabled"].includes(value)) return false;
  if (["1", "true", "yes", "on", "enabled"].includes(value)) return true;
  return defaultValue;
}

export function getMoySkladFeatureFlags(): MoySkladFeatureFlags {
  const enabled = envFlag("MOYSKLAD_ENABLED", false);
  const debugEnabled = envFlag("MOYSKLAD_DEBUG_ENABLED", envFlag("NEXT_PUBLIC_MOYSKLAD_DEBUG_ENABLED", false));
  return {
    enabled,
    readEnabled: enabled && debugEnabled && envFlag("MOYSKLAD_READ_ENABLED", false),
    writeEnabled: enabled && debugEnabled && envFlag("MOYSKLAD_WRITE_ENABLED", false),
    syncEnabled: enabled && debugEnabled && envFlag("MOYSKLAD_SYNC_ENABLED", false),
    debugEnabled,
  };
}

export function isMoySkladEnabled(): boolean {
  return getMoySkladFeatureFlags().enabled;
}

export function isMoySkladReadEnabled(): boolean {
  return getMoySkladFeatureFlags().readEnabled;
}

export function isMoySkladWriteEnabled(): boolean {
  return getMoySkladFeatureFlags().writeEnabled;
}

export function isMoySkladSyncEnabled(): boolean {
  return getMoySkladFeatureFlags().syncEnabled;
}

export function isMoySkladDebugEnabled(): boolean {
  return getMoySkladFeatureFlags().debugEnabled;
}

export function moyskladDisabledMessage(kind: "read" | "write" | "sync" | "all" = "all"): string {
  const labels = {
    read: "чтение",
    write: "запись",
    sync: "синхронизация",
    all: "интеграция",
  } satisfies Record<typeof kind, string>;
  return `МойСклад отключён feature flag (${labels[kind]}). Используйте локальную БД.`;
}

export function isMoySkladRequestAllowed(method?: string): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  if (normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS") {
    return isMoySkladReadEnabled();
  }
  return isMoySkladWriteEnabled();
}
