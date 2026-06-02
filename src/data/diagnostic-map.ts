export type DiagnosticMapStatusCode =
  | "unchecked"
  | "good"
  | "warn"
  | "crit"
  | "no-access"
  | "by-mileage"
  | "by-client";

export type DiagnosticMapCheckMethod = "inspection" | "client_words" | "mileage" | "no_access" | "skipped";

export type DiagnosticMapStatusGroup = "result" | "indirect";

export type VehicleHints = {
  awd?: boolean;
  hasAtf?: boolean;
  hasManualGearbox?: boolean;
  electric?: boolean;
  hybrid?: boolean;
};

export type DiagnosticMapStatusMeta = {
  code: DiagnosticMapStatusCode;
  label: string;
  short: string;
  group: DiagnosticMapStatusGroup;
  tone: "success" | "warning" | "danger" | "info" | "neutral" | "idle";
  color: string;
  icon: string;
  method: DiagnosticMapCheckMethod;
  clientText: string;
  hint?: string;
};

export const DIAGNOSTIC_MAP_STATUSES: Record<DiagnosticMapStatusCode, DiagnosticMapStatusMeta> = {
  unchecked: {
    code: "unchecked",
    label: "Не проверено",
    short: "Не пров.",
    tone: "idle",
    color: "#A3A3A3",
    icon: "○",
    group: "result",
    method: "skipped",
    clientText: "Пункт пока не заполнен мастером.",
  },
  good: {
    code: "good",
    label: "Хорошо",
    short: "Хорошо",
    tone: "success",
    color: "#15803D",
    icon: "✓",
    group: "result",
    method: "inspection",
    clientText: "Пункт проверен прямым осмотром. Отклонений не выявлено.",
  },
  warn: {
    code: "warn",
    label: "Внимание",
    short: "Внимание",
    tone: "warning",
    color: "#B45309",
    icon: "!",
    group: "result",
    method: "inspection",
    clientText: "Пункт требует внимания. Рекомендуем проконтролировать состояние и запланировать обслуживание.",
  },
  crit: {
    code: "crit",
    label: "Критично",
    short: "Критично",
    tone: "danger",
    color: "#B91C1C",
    icon: "×",
    group: "result",
    method: "inspection",
    clientText: "Рекомендуем выполнить обслуживание в ближайшее время.",
  },
  "no-access": {
    code: "no-access",
    label: "Доступ затруднён",
    short: "Нет доступа",
    tone: "neutral",
    color: "#6B7280",
    icon: "⊘",
    group: "indirect",
    method: "no_access",
    hint: "Осмотр не проводился из-за сложности доступа",
    clientText: "Узел не удалось проверить без дополнительного доступа или разборки.",
  },
  "by-mileage": {
    code: "by-mileage",
    label: "Вывод по пробегу",
    short: "По пробегу",
    tone: "info",
    color: "#1D4ED8",
    icon: "≈",
    group: "indirect",
    method: "mileage",
    hint: "Заключение на основании пробега и регламента",
    clientText: "Рекомендация сформирована по пробегу и регламенту обслуживания, без прямого осмотра узла.",
  },
  "by-client": {
    code: "by-client",
    label: "Со слов клиента",
    short: "Со слов",
    tone: "info",
    color: "#7C3AED",
    icon: "”",
    group: "indirect",
    method: "client_words",
    hint: "Записано со слов клиента, без прямого осмотра",
    clientText: "Информация указана со слов клиента и требует подтверждения при осмотре.",
  },
};

export const DIAGNOSTIC_STATUS_GROUPS = [
  {
    title: "Результат осмотра",
    statuses: ["good", "warn", "crit"] as DiagnosticMapStatusCode[],
  },
  {
    title: "Без прямого осмотра",
    statuses: ["no-access", "by-mileage", "by-client"] as DiagnosticMapStatusCode[],
  },
];

export type DiagnosticMapItemCatalog = {
  code: string;
  title: string;
  label: string;
  measure?: string;
  unit?: string;
  norm?: string;
  notes: string[];
  recs: string[];
  defaultNextVisit?: boolean;
  applicability?: {
    automaticOnly?: boolean;
    manualOnly?: boolean;
    awdOnly?: boolean;
    combustionOnly?: boolean;
  };
};

export type DiagnosticMapBlockCatalog = {
  code: string;
  id: string;
  title: string;
  short: string;
  items: DiagnosticMapItemCatalog[];
};

export const REC_PRESETS_COMMON = ["Контроль на следующем визите", "Дефектовка на подъёмнике"];

export const DIAGNOSTIC_MAP_BLOCKS: DiagnosticMapBlockCatalog[] = [
  {
    code: "engine",
    id: "engine",
    title: "Моторные и сервисные жидкости",
    short: "Жидкости",
    items: [
      {
        code: "oil-level",
        title: "Уровень моторного масла",
        label: "Уровень моторного масла",
        measure: "Уровень",
        unit: "мм по щупу",
        norm: "между MIN и MAX",
        notes: ["Между MIN и MAX", "Ближе к MAX", "Ниже MIN — нужен долив", "В норме после замены"],
        recs: ["Долив моторного масла", "Контроль уровня через 1 000 км"],
      },
      {
        code: "oil-condition",
        title: "Состояние масла — цвет, запах",
        label: "Состояние масла — цвет, запах",
        norm: "прозрачное, без запаха гари",
        notes: ["Свежее, прозрачное", "Тёмное, отработало ресурс", "Запах гари", "Только что залито"],
        recs: ["Замена моторного масла и фильтра"],
      },
      {
        code: "coolant",
        title: "Антифриз — уровень и t° замерзания",
        label: "Антифриз — уровень и t° замерзания",
        measure: "Замерзание",
        unit: "°C",
        norm: "≤ −35 °C",
        notes: ["Уровень в норме, −42 °C", "Уровень ниже MIN", "Низкая плотность", "Следы масла в ОЖ"],
        recs: ["Долив / замена антифриза", "Проверка системы охлаждения"],
      },
      {
        code: "brake-fluid",
        title: "Тормозная жидкость — влажность",
        label: "Тормозная жидкость — влажность",
        measure: "Влажность",
        unit: "%",
        norm: "< 2.0 %",
        notes: ["В норме, до 2 %", "2.3 % воды — выше нормы", "Тёмная, отработавшая"],
        recs: ["Замена тормозной жидкости DOT 4 с прокачкой · ~2 200 ₽"],
      },
      {
        code: "washer",
        title: "Жидкость омывателя",
        label: "Жидкость омывателя",
        norm: "долита",
        notes: ["Долита", "Пустой бачок"],
        recs: ["Долив незамерзайки"],
      },
    ],
  },
  {
    code: "trans",
    id: "trans",
    title: "Трансмиссия и полный привод",
    short: "Трансмиссия",
    items: [
      {
        code: "atf-level",
        title: "Уровень ATF",
        label: "Уровень ATF",
        measure: "Уровень",
        unit: "мм",
        norm: "по регламенту",
        notes: ["Норма после замены", "Ниже уровня", "Перелив"],
        recs: ["Корректировка уровня ATF"],
      },
      {
        code: "atf-condition",
        title: "Состояние ATF — цвет, запах",
        label: "Состояние ATF — цвет, запах",
        norm: "красное, прозрачное",
        notes: ["Красное, чистое", "Тёмное, запах гари", "Мутное, с продуктами износа"],
        recs: ["Аппаратная замена ATF с промывкой", "Замена фильтра АКПП"],
      },
      {
        code: "reducer",
        title: "Редуктор — масло, шум",
        label: "Редуктор — масло, шум",
        norm: "без шума, уровень в норме",
        notes: ["Без шума, уровень в норме", "Гул на скорости", "Подтёки масла", "Масло не менялось по пробегу"],
        recs: ["Замена масла в редукторе", "Диагностика на подъёмнике с прогазовкой"],
      },
      {
        code: "transfer",
        title: "Раздаточная коробка — масло, шум",
        label: "Раздаточная коробка — масло, шум",
        norm: "работает штатно",
        notes: ["Работает штатно", "Шум при переключении", "Подтёки", "Толчки при старте"],
        recs: ["Замена масла в раздатке", "Диагностика муфты раздатки"],
      },
    ],
  },
  {
    code: "electro",
    id: "electro",
    title: "Электрооборудование и свет",
    short: "Электрика",
    items: [
      {
        code: "battery",
        title: "АКБ — напряжение покоя",
        label: "АКБ — напряжение покоя",
        measure: "Напряжение",
        unit: "В",
        norm: "12.4–12.7 В",
        notes: ["12.6 В — в норме", "12.2 В — ниже нормы", "Держит нагрузку", "Теряет ёмкость"],
        recs: ["Зарядка АКБ", "Замена АКБ перед зимой · от 9 500 ₽"],
      },
      {
        code: "lights",
        title: "Освещение и сигналы",
        label: "Освещение и сигналы",
        norm: "все исправны",
        notes: ["Все исправны", "Не горит габарит", "Помутнели фары"],
        recs: ["Замена ламп", "Полировка фар"],
      },
    ],
  },
  {
    code: "visual",
    id: "visual",
    title: "Ходовая и осмотр снизу",
    short: "Ходовая",
    items: [
      {
        code: "belts",
        title: "Ремни и приводы",
        label: "Ремни и приводы",
        norm: "без трещин",
        notes: ["Без трещин", "Микротрещины", "Ремень не менялся по пробегу"],
        recs: ["Замена ремня навесного оборудования"],
      },
      {
        code: "leaks-engine",
        title: "Утечки моторного отсека",
        label: "Утечки моторного отсека",
        norm: "сухо",
        notes: ["Сухо", "Запотевание клапанной крышки", "Подтёки масла"],
        recs: ["Замена прокладки клапанной крышки"],
      },
      {
        code: "leaks-bottom",
        title: "Утечки снизу",
        label: "Утечки снизу",
        norm: "сухо",
        notes: ["Сухо", "Запотевание поддона", "Подтёки из сальника"],
        recs: ["Устранение течи · диагностика на подъёмнике"],
      },
      {
        code: "pads",
        title: "Тормозные колодки — остаток",
        label: "Тормозные колодки — остаток",
        measure: "Остаток",
        unit: "%",
        norm: "> 30 %",
        notes: ["Перед 62 %, зад в норме", "Задние 28 % — к замене", "Скрип при торможении"],
        recs: ["Замена задних колодок · ~6 800 ₽", "Замена передних колодок"],
      },
      {
        code: "tires",
        title: "Шины — глубина протектора",
        label: "Шины — глубина протектора",
        measure: "Глубина",
        unit: "мм",
        norm: "> 4.0 мм",
        notes: ["5.6 мм — в норме", "Передние 3.8 мм — ниже нормы", "Неравномерный износ"],
        recs: ["Замена передней пары шин до зимы", "Развал-схождение"],
      },
      {
        code: "suspension",
        title: "Подвеска — сайлентблоки, рычаги",
        label: "Подвеска — сайлентблоки, рычаги",
        norm: "без люфтов",
        notes: ["Без люфтов", "Стук на кочках", "Разрывы сайлентблоков задних рычагов", "Надрыв пыльника ШРУС"],
        recs: ["Замена сайлентблоков задних рычагов · ~28 000 ₽", "Замена пыльника ШРУС · ~3 500 ₽"],
      },
    ],
  },
];

export const DIAG_BLOCKS = DIAGNOSTIC_MAP_BLOCKS;
export const DIAG_STATUS = DIAGNOSTIC_MAP_STATUSES;
export const DIAG_STATE = {
  shipment: "TGM-2026-0436",
  vin: "WP1AB2A28GLA21104",
  startedAt: "23.05.2026 · 11:24",
  finishedAt: "23.05.2026 · 11:52",
  mileage: 189300,
  items: {},
};

export const DIAGNOSTIC_COMMON_RECOMMENDATIONS = REC_PRESETS_COMMON;

export function allDiagnosticMapItems() {
  return DIAGNOSTIC_MAP_BLOCKS.flatMap((block, blockIndex) =>
    block.items.map((item, itemIndex) => ({
      block,
      item,
      blockOrder: blockIndex,
      itemOrder: itemIndex,
    }))
  );
}

export function statusMethod(status: DiagnosticMapStatusCode): DiagnosticMapCheckMethod {
  return DIAGNOSTIC_MAP_STATUSES[status]?.method ?? "inspection";
}

export function isIndirectStatus(status: DiagnosticMapStatusCode): boolean {
  return DIAGNOSTIC_MAP_STATUSES[status]?.group === "indirect";
}
