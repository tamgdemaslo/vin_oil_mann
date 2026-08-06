/** Все поля из декодера API Cloud + базовые */
export type VinDecoded = {
  make: string;
  model: string;
  modelYear: string;
  engineCylinders: string;
  displacementL: string;
  fuelTypePrimary: string;
  bodyClass: string;
  trim?: string;
  manufacturer?: string;
  plantCountry?: string;
  /** Полные сырые данные от API Cloud для передачи в OpenAI */
  rawReport?: Record<string, unknown>;
  // Доп. поля из декодера
  basicParams?: string;
  powerParams?: string;
  bodyName?: string;
  startYear?: string;
  finishYear?: string;
  market?: string;
  steering?: string;
  generation?: string;
  engineEmission?: string;
  doors?: number;
  modification?: string;
  engineSeries?: string;
  gearType?: string;
  gearSpeeds?: number | null;
  drive?: string;
  enginePowerKw?: number;
  enginePowerPS?: number;
  engineTorqueNm?: number;
  valves?: number;
  compression?: number;
  supplySystem?: string;
  engineFuelrate?: string;
  intercooler?: string | null;
  lineup?: string;
};

/** Результат одного запроса OpenAI: масло + OEM и Mann-наименования фильтров */
export type OilInfo = {
  approval: string;
  fillVolumeLiters: string;
  /** Дополнительно: структуры требований от OpenAI для поиска в локальном каталоге по SAE/ACEA/API/ILSAC */
  sae?: string[];
  acea?: string[];
  api?: string[];
  ilsac?: string[];
  oilFilterOem?: string;
  fuelFilterOem?: string;
  airFilterOem?: string;
  cabinFilterOem?: string;
  oilFilterMann?: string;
  airFilterMann?: string;
  cabinFilterMann?: string;
  transmission?: {
    code: string;
    gearbox: string;
    fluid: string;
    partialVolumeLiters?: string;
    fullVolumeLiters?: string;
    levelCheckTempC?: string;
    note?: string;
  };
  rawText?: string;
};

/** Один вариант товара из локального каталога: название, цена, количество, склад, ячейка */
export type LocalItem = {
  name: string;
  article?: string;
  price: number;
  currency: string;
  quantity: number;
  store: string;
  cell?: string;
  productId?: string;
  volumeLiters?: number;
  imageHref?: string;
  lookupKind?: "oil" | "oil-filter" | "fuel-filter" | "air-filter" | "cabin-filter" | "other";
};

export type LookupResult = {
  vin: string;
  decoded: VinDecoded | null;
  decodeError?: string;
  oilInfo: OilInfo | null;
  openaiError?: string;
  legacyItems: LocalItem[];
  legacyError?: string;
};
