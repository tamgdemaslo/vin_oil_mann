/** Destination-market evidence only. Never pass assembly country or user locale. */
export const VEHICLE_DESTINATION_MARKETS = ["RU", "JP", "US", "KR", "AE", "EU", "SOUTHEAST_ASIA"] as const;
export type VehicleDestinationMarket = typeof VEHICLE_DESTINATION_MARKETS[number];
export type VehicleMarketEvidence = { values: string[]; confirmedMarket?: VehicleDestinationMarket };

export function isVehicleDestinationMarket(value: unknown): value is VehicleDestinationMarket {
  return typeof value === "string" && (VEHICLE_DESTINATION_MARKETS as readonly string[]).includes(value);
}

// Explicit destination labels only. EU/SE Asia are source-market regions;
// individual countries, assembly location and steering side never imply them.
const MARKET_LABELS: Record<VehicleDestinationMarket, readonly string[]> = {
  RU: ["RU", "RUS", "RUSSIA", "RUSSIAN FEDERATION", "РОССИЯ", "РОССИЙСКАЯ ФЕДЕРАЦИЯ", "РФ"],
  JP: ["JP", "JPN", "JAPAN", "ЯПОНИЯ"],
  US: ["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "США"],
  KR: ["KR", "KOR", "SOUTH KOREA", "REPUBLIC OF KOREA", "ЮЖНАЯ КОРЕЯ", "Ю. КОРЕЯ"],
  AE: ["AE", "ARE", "UAE", "UNITED ARAB EMIRATES", "ОАЭ", "ОБЪЕДИНЕННЫЕ АРАБСКИЕ ЭМИРАТЫ"],
  EU: ["EU", "EUROPE", "ЕВРОПА"],
  SOUTHEAST_ASIA: ["SOUTHEAST_ASIA", "SOUTHEAST ASIA", "SOUTH-EAST ASIA", "Ю-В АЗИЯ", "ЮГО-ВОСТОЧНАЯ АЗИЯ"],
};
const MARKET_BY_LABEL = new Map(Object.entries(MARKET_LABELS).flatMap(([market, labels]) => labels.map(label => [label, market as VehicleDestinationMarket] as const)));

export function resolveVehicleMarket(values: unknown[]): VehicleMarketEvidence {
  const present = [...new Set(values.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map(v => v.trim()))];
  // Whole-label equality: regional unions, mixed markets and unknown labels
  // cannot silently collapse to one market alongside an explicit known label.
  const mapped = present.map(value => MARKET_BY_LABEL.get(value.toUpperCase()));
  const confirmedMarket = mapped.length && mapped[0] && mapped.every(value => value === mapped[0]) ? mapped[0] : undefined;
  return { values: present, ...(confirmedMarket ? { confirmedMarket } : {}) };
}

export function mergeVehicleMarketEvidence(...vehicles: Array<{ market?: string; marketEvidence?: VehicleMarketEvidence }>): VehicleMarketEvidence {
  return resolveVehicleMarket(vehicles.flatMap(vehicle => [vehicle.market, ...(vehicle.marketEvidence?.values ?? [])]));
}
