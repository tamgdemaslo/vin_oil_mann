/**
 * Справочник узлов диагностики, тегов, правил измерений и шаблонов офферов.
 * Редактируется без миграций БД.
 */

/** Совпадает с enum Prisma `DiagnosticBlock` */
export type DiagnosticBlockCode =
  | "AGGREGATE_FLUID"
  | "SERVICE_FLUID"
  | "VISUAL"
  | "SURVEY";

export type VehicleHints = {
  /** Полный привод — показывать передний/задний редуктор и раздатку */
  awd?: boolean;
  /** Автоматическая КПП — показывать ATF */
  hasAtf?: boolean;
  /** Ручная КПП — показывать масло МКПП */
  hasManualGearbox?: boolean;
  /** Чистый EV — не показывать узлы ДВС */
  electric?: boolean;
  /** Гибрид — ДВС остаётся применимым */
  hybrid?: boolean;
};

export type CatalogNode = {
  node: string;
  block: DiagnosticBlockCode;
  title: string;
  /** Узел с числовым замером */
  measurement?: "brake_fluid" | "coolant";
};

export const BLOCK_ORDER: DiagnosticBlockCode[] = [
  "AGGREGATE_FLUID",
  "SERVICE_FLUID",
  "VISUAL",
  "SURVEY",
];

export const BLOCK_TITLES: Record<DiagnosticBlockCode, string> = {
  AGGREGATE_FLUID: "Жидкости агрегатов",
  SERVICE_FLUID: "Сервисные жидкости",
  VISUAL: "Визуальная проверка",
  SURVEY: "Опрос клиента",
};

/** Все узлы по умолчанию; фильтрация через filterNodesForVehicle */
export const ALL_NODES: CatalogNode[] = [
  { node: "engine_oil", block: "AGGREGATE_FLUID", title: "Моторное масло" },
  { node: "atf", block: "AGGREGATE_FLUID", title: "АКПП (ATF)" },
  { node: "mtf", block: "AGGREGATE_FLUID", title: "МКПП" },
  { node: "front_diff", block: "AGGREGATE_FLUID", title: "Передний редуктор" },
  { node: "rear_diff", block: "AGGREGATE_FLUID", title: "Задний редуктор" },
  { node: "transfer_case", block: "AGGREGATE_FLUID", title: "Раздаточная коробка" },
  { node: "coolant", block: "SERVICE_FLUID", title: "Антифриз / ОЖ", measurement: "coolant" },
  { node: "brake_fluid", block: "SERVICE_FLUID", title: "Тормозная жидкость", measurement: "brake_fluid" },
  { node: "power_steering", block: "SERVICE_FLUID", title: "ГУР / электроусилитель (жидкость)" },
  { node: "washer", block: "SERVICE_FLUID", title: "Омыватель стёкол" },
  { node: "brakes_visual", block: "VISUAL", title: "Тормозные колодки / диски" },
  { node: "cv_boots", block: "VISUAL", title: "Пыльники ШРУС" },
  { node: "visible_leaks", block: "VISUAL", title: "Видимые течи" },
  { node: "survey_cabin_filter", block: "SURVEY", title: "Салонный фильтр (опрос)" },
  { node: "survey_air_filter", block: "SURVEY", title: "Воздушный фильтр (опрос)" },
  { node: "survey_sparks", block: "SURVEY", title: "Свечи зажигания (опрос)" },
];

export function filterNodesForVehicle(hints?: VehicleHints): CatalogNode[] {
  const h = hints ?? {};
  const awd = h.awd === true;
  const hasAtf = h.hasAtf === true;
  const hasManual = h.hasManualGearbox === true;
  const pureElectric = h.electric === true && h.hybrid !== true;
  return ALL_NODES.filter((n) => {
    if (n.node === "atf") return hasAtf;
    if (n.node === "mtf") return hasManual;
    if (n.node === "front_diff" || n.node === "rear_diff" || n.node === "transfer_case") return awd;
    if (pureElectric && (n.node === "engine_oil" || n.node === "survey_sparks")) return false;
    return true;
  });
}

export type TagDef = { code: string; label: string };

/** Теги по коду узла */
export const NODE_TAGS: Record<string, TagDef[]> = {
  engine_oil: [
    { code: "oil_dark", label: "Сильное потемнение" },
    { code: "oil_low", label: "Низкий уровень" },
    { code: "metal_particles", label: "Блестки металла" },
  ],
  atf: [
    { code: "atf_slight_dark", label: "Лёгкое потемнение" },
    { code: "atf_heavy_dark", label: "Сильное потемнение" },
    { code: "burnt_smell", label: "Запах гари" },
    { code: "metal_shavings", label: "Металлическая стружка" },
    { code: "emulsion", label: "Эмульсия" },
  ],
  mtf: [
    { code: "mtf_dark", label: "Потемнение" },
    { code: "mtf_grinding", label: "Хруст при включении" },
  ],
  front_diff: [
    { code: "diff_dark", label: "Потемнение" },
    { code: "diff_leak", label: "Подтеки" },
  ],
  rear_diff: [
    { code: "diff_dark", label: "Потемнение" },
    { code: "diff_leak", label: "Подтеки" },
  ],
  transfer_case: [
    { code: "tc_dark", label: "Потемнение" },
    { code: "tc_noise", label: "Шум" },
  ],
  coolant: [
    { code: "coolant_low", label: "Низкий уровень" },
    { code: "coolant_rust", label: "Ржавчина / осадок" },
  ],
  brake_fluid: [
    { code: "bf_old", label: "Давно не менялась" },
  ],
  power_steering: [
    { code: "ps_leak", label: "Подтёки" },
    { code: "ps_noise", label: "Гул насоса" },
  ],
  washer: [{ code: "washer_empty", label: "Пустой бачок" }],
  brakes_visual: [
    { code: "pads_low", label: "Износ колодок" },
    { code: "disc_rust", label: "Коррозия дисков" },
  ],
  cv_boots: [
    { code: "cv_crack", label: "Трещины пыльника" },
    { code: "cv_leak", label: "Выдавлен смазка" },
  ],
  visible_leaks: [
    { code: "leak_oil", label: "Подтёки масла" },
    { code: "leak_coolant", label: "Подтёки ОЖ" },
  ],
  survey_cabin_filter: [{ code: "cabin_old_year", label: "Не менялся больше года" }],
  survey_air_filter: [{ code: "air_dirty", label: "Загрязнён" }],
  survey_sparks: [{ code: "sparks_unknown", label: "Неизвестно когда менялись" }],
};

const TAG_FALLBACK_LABELS: Record<string, string> = {
  burnt_smell: "Запах гари",
  slight_dark: "Лёгкое потемнение",
  heavy_dark: "Сильное потемнение",
  dark: "Потемнение",
  dirty: "Загрязнён",
  old_year: "Не менялся больше года",
  unknown: "Неизвестно когда менялись",
  low: "Низкий уровень",
  leak: "Подтёки",
  leaks: "Подтёки",
  rust: "Коррозия",
  noise: "Шум",
  empty: "Пустой бачок",
  metal_particles: "Блёстки металла",
  metal_shavings: "Металлическая стружка",
  emulsion: "Эмульсия",
  grinding: "Хруст при включении",
  crack: "Трещины",
  pads_low: "Износ колодок",
  disc_rust: "Коррозия дисков",
};

const TAG_PREFIXES_TO_DROP = [
  ...ALL_NODES.map((node) => node.node),
  "atf",
  "mtf",
  "diff",
  "tc",
  "bf",
  "ps",
  "cv",
  "cabin",
  "air",
  "sparks",
  "oil",
  "coolant",
  "washer",
  "leak",
];

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function tagLookupCandidates(node: string, code: string): string[] {
  const normalized = code.trim().toLowerCase().replace(/[-\s]+/g, "_");
  const candidates = [normalized];
  for (const prefix of TAG_PREFIXES_TO_DROP) {
    const normalizedPrefix = prefix.toLowerCase();
    if (normalized.startsWith(`${normalizedPrefix}_`)) {
      candidates.push(normalized.slice(normalizedPrefix.length + 1));
    }
  }
  const nodeParts = node.split("_").filter(Boolean);
  const nodeTail = nodeParts[nodeParts.length - 1];
  if (nodeTail && normalized.startsWith(`${nodeTail}_`)) {
    candidates.push(normalized.slice(nodeTail.length + 1));
  }
  return uniqueStrings(candidates);
}

function findTagLabelForNode(node: string, code: string): string | undefined {
  const tags = NODE_TAGS[node] ?? [];
  const candidates = tagLookupCandidates(node, code);
  const nodeTag = tags.find((tag) =>
    candidates.some((candidate) => (
      tag.code === candidate ||
      tag.code.endsWith(`_${candidate}`) ||
      candidate.endsWith(`_${tag.code}`)
    ))
  );
  if (nodeTag) return nodeTag.label;
  return Object.values(NODE_TAGS).flat().find((tag) =>
    candidates.some((candidate) => (
      tag.code === candidate ||
      tag.code.endsWith(`_${candidate}`) ||
      candidate.endsWith(`_${tag.code}`)
    ))
  )?.label;
}

function humanizeTagCode(node: string, code: string): string {
  const candidates = tagLookupCandidates(node, code);
  for (const candidate of candidates) {
    if (TAG_FALLBACK_LABELS[candidate]) return TAG_FALLBACK_LABELS[candidate];
    const parts = candidate.split("_");
    for (let index = 0; index < parts.length; index += 1) {
      const tail = parts.slice(index).join("_");
      if (TAG_FALLBACK_LABELS[tail]) return TAG_FALLBACK_LABELS[tail];
    }
  }
  return "Дополнительный признак";
}

export function tagLabelForNode(node: string, code: string): string {
  return findTagLabelForNode(node, code) ?? humanizeTagCode(node, code);
}

export function tagLabelsForNode(node: string, codes: string[]): string[] {
  return codes.map((code) => tagLabelForNode(node, code));
}

export const RECOMMENDATION_PRESETS: Record<string, string[]> = {
  default: ["Замена при следующем визите", "Контроль через 5000 км", "Рекомендуем записаться на сервис"],
  atf: ["Частичная замена ATF", "Аппаратная замена ATF", "Диагностика АКПП"],
  engine_oil: ["Замена масла и фильтра", "Доливка и контроль"],
};

/** Тормозная влага %; антифриз — температура кристаллизации °C */
export function trafficLightFromMeasurement(
  measurement: "brake_fluid" | "coolant",
  value: number
): "GREEN" | "YELLOW" | "RED" {
  if (measurement === "brake_fluid") {
    if (value < 2) return "GREEN";
    if (value <= 3) return "YELLOW";
    return "RED";
  }
  // coolant: чем ниже °C замерзания, тем лучше (ниже -35 хорошо)
  if (value <= -35) return "GREEN";
  if (value <= -20) return "YELLOW";
  return "RED";
}

export type OfferVariant = {
  label: string;
  /** Цена по умолчанию для прайса, ₽ */
  defaultPriceRub: number;
  /** Подсказки поиска товара в МойСклад */
  moySkladSearchHints?: string[];
};

export type OfferTemplate = {
  offerKey: string;
  title: string;
  variants: OfferVariant[];
};

/** Офферы для 🔴 узлов */
export const RED_NODE_OFFERS: Partial<Record<string, OfferTemplate>> = {
  atf: {
    offerKey: "atf_change",
    title: "Замена ATF",
    variants: [
      { label: "Аппаратная замена ATF", defaultPriceRub: 8500, moySkladSearchHints: ["ATF", "Dexron", "Toyota ATF WS"] },
      { label: "Частичная замена ATF", defaultPriceRub: 4500, moySkladSearchHints: ["ATF"] },
    ],
  },
  brake_fluid: {
    offerKey: "brake_fluid_change",
    title: "Замена тормозной жидкости",
    variants: [{ label: "Замена тормозной жидкости", defaultPriceRub: 2500, moySkladSearchHints: ["тормозная жидкость", "DOT 4"] }],
  },
  front_diff: {
    offerKey: "front_diff_oil",
    title: "Замена масла переднего редуктора",
    variants: [{ label: "Замена масла переднего редуктора", defaultPriceRub: 3500, moySkladSearchHints: ["редуктор передний"] }],
  },
  rear_diff: {
    offerKey: "rear_diff_oil",
    title: "Замена масла заднего редуктора",
    variants: [{ label: "Замена масла заднего редуктора", defaultPriceRub: 3500, moySkladSearchHints: ["редуктор задний"] }],
  },
  transfer_case: {
    offerKey: "transfer_case_oil",
    title: "Замена масла раздатки",
    variants: [{ label: "Замена масла раздаточной коробки", defaultPriceRub: 4000, moySkladSearchHints: ["раздатка"] }],
  },
  engine_oil: {
    offerKey: "engine_oil_change",
    title: "Замена моторного масла и фильтра",
    variants: [
      { label: "Стандартное ТО (масло + фильтр)", defaultPriceRub: 5500, moySkladSearchHints: ["моторное масло 5W"] },
    ],
  },
  coolant: {
    offerKey: "coolant_replace",
    title: "Замена охлаждающей жидкости",
    variants: [{ label: "Замена антифриза", defaultPriceRub: 4800, moySkladSearchHints: ["антифриз", "охлаждающая"] }],
  },
};

/** Опрос: салонный фильтр давно не менял — оффер «на следующий визит» */
export const SURVEY_NEXT_VISIT_OFFERS: Partial<Record<string, OfferTemplate>> = {
  survey_cabin_filter: {
    offerKey: "cabin_filter_replace_next_visit",
    title: "Замена салонного фильтра (на следующий визит)",
    variants: [{ label: "Салонный фильтр", defaultPriceRub: 1200, moySkladSearchHints: ["салонный фильтр"] }],
  },
};

export function countFilledPositions(
  positions: { status: string }[],
  _totalNodes: number
): { green: number; yellow: number; red: number; filled: number } {
  void _totalNodes;
  let green = 0,
    yellow = 0,
    red = 0,
    filled = 0;
  for (const p of positions) {
    if (p.status === "GREEN") {
      green++;
      filled++;
    } else if (p.status === "YELLOW") {
      yellow++;
      filled++;
    } else if (p.status === "RED") {
      red++;
      filled++;
    } else if (p.status === "SKIPPED") {
      filled++;
    }
  }
  return { green, yellow, red, filled };
}

export function hubSummaryProgress(filled: number, total: number): boolean {
  if (total <= 0) return false;
  return filled >= Math.ceil(total / 2);
}
