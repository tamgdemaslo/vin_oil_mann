"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import { ChevronLeft, ChevronRight, Copy, Printer, X } from "lucide-react";
import {
  DIAGNOSTIC_MAP_BLOCKS,
  DIAGNOSTIC_MAP_STATUSES,
  DIAGNOSTIC_STATUS_GROUPS,
  REC_PRESETS_COMMON,
  type DiagnosticMapStatusCode,
} from "@/data/diagnostic-map";

type DiagnosticMapPhoto = {
  id: string;
  caption: string;
  url: string;
  thumbnailUrl: string;
};

type DiagnosticMapItem = {
  id: string;
  code: string;
  title: string;
  applicability: "applicable" | "not_applicable" | "hidden";
  status: DiagnosticMapStatusCode;
  statusLabel: string;
  value: string;
  comment: string;
  recommendation: string;
  nextVisit: boolean;
  showInReport: boolean;
  notes: string[];
  recs: string[];
  norm: string;
  measure: string;
  unit: string;
  selectedNotes: string[];
  selectedRecommendations: string[];
  photos: DiagnosticMapPhoto[];
};

type DiagnosticMapBlock = {
  code: string;
  title: string;
  short: string;
  items: DiagnosticMapItem[];
};

type DiagnosticMapPayload = {
  id: string;
  shipmentId: string | null;
  status: string;
  publicToken: string;
  reportUrl: string;
  printUrl: string;
  clientName: string | null;
  vehicle: {
    title: string;
    vin: string | null;
    licensePlate: string | null;
    mileage: number | null;
  };
  master: { name: string | null };
  counts: { total: number };
  blocks: DiagnosticMapBlock[];
};

type PhotoUploadState = {
  id: string;
  file: File;
  caption: string;
  previewUrl: string;
  progress: number;
  status: "uploading" | "error";
  error?: string;
};

type DiagnosticMapModalProps = {
  open: boolean;
  onClose: () => void;
  diagnosticId: string | null;
  shipmentId?: string | null;
  headerDraft?: {
    vin?: string;
    brand?: string;
    model?: string;
    year?: string;
    licensePlate?: string;
    mileage?: string;
    clientName?: string;
    clientPhone?: string;
    vehicleHints?: Record<string, unknown>;
  };
  onDiagnosticCreated?: (id: string) => void;
  onDiagnosticUpdated?: (diagnostic: DiagnosticMapPayload) => void;
  onAddedToShipment?: () => void;
};

type SaveState = "idle" | "saving" | "saved" | "error";
type SaveOptions = {
  debounce?: boolean;
};

type FieldContext = {
  label: string;
  placeholder: string;
  helper: string;
  inputMode: HTMLAttributes<HTMLInputElement>["inputMode"];
  warning?: string;
};

type AutoMeasurementKind =
  | "oil"
  | "coolant"
  | "brake-fluid"
  | "atf"
  | "gear-oil"
  | "belt"
  | "leak"
  | "brake-pads"
  | "brake-discs"
  | "tires"
  | "suspension";

type MeasurementEvaluation = {
  value: string;
  status: DiagnosticMapStatusCode;
  comment: string;
  recommendation: string;
  nextVisit: boolean;
};

type OilLevelZone = MeasurementEvaluation & {
  id: string;
  label: string;
  hint: string;
};

type DiagnosticChoice = {
  id: string;
  label: string;
  hint?: string;
  status: DiagnosticMapStatusCode;
  comment: string;
  color?: string;
};

type AtfBaseColor = {
  id: string;
  label: string;
  choices: DiagnosticChoice[];
};

const DIAGNOSTIC_MAP_CATALOG_TOTAL = DIAGNOSTIC_MAP_BLOCKS.reduce((total, block) => total + block.items.length, 0);

async function responseJson<T>(response: Response, fallback: T): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

function countLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} пункт`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} пункта`;
  return `${count} пунктов`;
}

function appendText(current: string, value: string): string {
  return current ? `${current} ${value}` : value;
}

function itemNeedsRecommendation(item: DiagnosticMapItem): boolean {
  return !["good", "unchecked"].includes(item.status);
}

function isIndirectStatus(status: DiagnosticMapStatusCode): boolean {
  return ["no-access", "by-mileage", "by-client"].includes(status);
}

function numericValue(value: string): number | null {
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function includesAny(value: string, words: string[]): boolean {
  const lower = value.toLowerCase();
  return words.some((word) => lower.includes(word));
}

const OIL_LEVEL_ZONES: OilLevelZone[] = [
  {
    id: "below-min",
    label: "Ниже MIN",
    hint: "срочно долить",
    value: "Ниже MIN",
    status: "crit",
    comment: "Уровень ниже MIN, требуется долив",
    recommendation: "Долив моторного масла и проверка расхода",
    nextVisit: false,
  },
  {
    id: "near-min",
    label: "Около MIN",
    hint: "контроль / долив",
    value: "Около MIN",
    status: "warn",
    comment: "Уровень ближе к MIN, рекомендуется контроль / долив",
    recommendation: "Долив масла и контроль расхода",
    nextVisit: true,
  },
  {
    id: "normal",
    label: "Между MIN и MAX",
    hint: "рабочая зона",
    value: "Между MIN и MAX",
    status: "good",
    comment: "Уровень в норме, между MIN и MAX",
    recommendation: "",
    nextVisit: false,
  },
  {
    id: "near-max",
    label: "Около MAX",
    hint: "в допуске",
    value: "Около MAX",
    status: "good",
    comment: "Уровень ближе к MAX, в допустимом диапазоне",
    recommendation: "",
    nextVisit: false,
  },
  {
    id: "above-max",
    label: "Выше MAX",
    hint: "проверить перелив",
    value: "Выше MAX",
    status: "warn",
    comment: "Уровень выше MAX, требуется проверка",
    recommendation: "Проверка уровня масла и причины перелива",
    nextVisit: false,
  },
];

const ATF_BASE_COLORS: AtfBaseColor[] = [
  {
    id: "red",
    label: "красная / вишнёвая",
    choices: [
      { id: "fresh-red", label: "свежая вишнёво-красная", status: "good", color: "#8f1323", comment: "Цвет ATF соответствует базовому, без выраженного потемнения" },
      { id: "dark-red", label: "красная потемневшая", status: "warn", color: "#7f1d1d", comment: "ATF заметно потемнела" },
      { id: "brown", label: "коричневая", status: "crit", color: "#6b3416", comment: "ATF сильно потемнела" },
      { id: "dark-brown", label: "тёмно-коричневая", status: "crit", color: "#3f2414", comment: "ATF сильно потемнела / почти чёрная" },
      { id: "black", label: "почти чёрная", status: "crit", color: "#111111", comment: "ATF сильно потемнела / почти чёрная" },
    ],
  },
  {
    id: "green",
    label: "зелёная",
    choices: [
      { id: "fresh-green", label: "свежая зелёная", status: "good", color: "#15803d", comment: "Цвет ATF соответствует базовому, без выраженного потемнения" },
      { id: "dark-green", label: "потемневшая зелёная", status: "warn", color: "#166534", comment: "ATF заметно потемнела" },
      { id: "muddy", label: "мутная", status: "warn", color: "#647045", comment: "ATF мутная, рекомендуется контроль состояния жидкости" },
      { id: "brown", label: "коричневая", status: "crit", color: "#6b3416", comment: "ATF сильно потемнела" },
      { id: "black", label: "почти чёрная", status: "crit", color: "#111111", comment: "ATF сильно потемнела / почти чёрная" },
    ],
  },
  {
    id: "blue",
    label: "голубая",
    choices: [
      { id: "fresh-blue", label: "свежая голубая", status: "good", color: "#38bdf8", comment: "Цвет ATF соответствует базовому, без выраженного потемнения" },
      { id: "muddy-blue", label: "мутная", status: "warn", color: "#60a5a8", comment: "ATF мутная, рекомендуется контроль состояния жидкости" },
      { id: "dark-blue", label: "потемневшая", status: "warn", color: "#1d4ed8", comment: "ATF заметно потемнела" },
      { id: "brown", label: "коричневая", status: "crit", color: "#6b3416", comment: "ATF сильно потемнела" },
      { id: "black", label: "почти чёрная", status: "crit", color: "#111111", comment: "ATF сильно потемнела / почти чёрная" },
    ],
  },
  {
    id: "yellow",
    label: "жёлтая / светлая",
    choices: [
      { id: "light", label: "светлая", status: "good", color: "#fde68a", comment: "Цвет ATF соответствует базовому, без выраженного потемнения" },
      { id: "amber", label: "янтарная", status: "good", color: "#f59e0b", comment: "Цвет ATF соответствует базовому, без выраженного потемнения" },
      { id: "dark-yellow", label: "тёмно-жёлтая", status: "warn", color: "#b45309", comment: "ATF заметно потемнела" },
      { id: "brown", label: "коричневая", status: "crit", color: "#6b3416", comment: "ATF сильно потемнела" },
      { id: "black", label: "почти чёрная", status: "crit", color: "#111111", comment: "ATF сильно потемнела / почти чёрная" },
    ],
  },
  {
    id: "unknown",
    label: "неизвестно",
    choices: [
      { id: "clear", label: "визуально чистая", status: "good", color: "#d6c18e", comment: "ATF визуально чистая, базовый цвет неизвестен" },
      { id: "darkened", label: "потемневшая", status: "warn", color: "#9a5a21", comment: "ATF заметно потемнела" },
      { id: "muddy", label: "мутная", status: "warn", color: "#6f6249", comment: "ATF мутная, рекомендуется контроль состояния жидкости" },
      { id: "brown", label: "коричневая", status: "crit", color: "#6b3416", comment: "ATF сильно потемнела" },
      { id: "black", label: "почти чёрная", status: "crit", color: "#111111", comment: "ATF сильно потемнела / почти чёрная" },
    ],
  },
];

const ATF_SMELL_CHOICES: DiagnosticChoice[] = [
  { id: "none", label: "Без запаха гари", status: "good", comment: "Запах гари не выявлен" },
  { id: "light-burn", label: "Лёгкий запах гари", status: "warn", comment: "Есть лёгкий запах гари, рекомендуется контроль состояния ATF" },
  { id: "strong-burn", label: "Сильный запах гари", status: "crit", comment: "Сильный запах гари, рекомендуется обслуживание АКПП" },
  { id: "foreign", label: "Посторонний запах", status: "warn", comment: "Выявлен посторонний запах ATF, рекомендуется диагностика АКПП" },
  { id: "unknown", label: "Не удалось оценить", status: "no-access", comment: "Запах оценить не удалось" },
];

const GEAR_COLOR_CHOICES: DiagnosticChoice[] = [
  { id: "light", label: "светло-жёлтое / прозрачное", status: "good", color: "#f8e7a1", comment: "Масло редуктора визуально в норме" },
  { id: "amber", label: "янтарное", status: "good", color: "#f59e0b", comment: "Масло редуктора визуально в норме" },
  { id: "dark-yellow", label: "тёмно-жёлтое", status: "warn", color: "#b45309", comment: "Масло потемнело, рекомендуется контроль" },
  { id: "brown", label: "коричневое", status: "warn", color: "#7c3f16", comment: "Масло потемнело, рекомендуется контроль" },
  { id: "black", label: "почти чёрное", status: "crit", color: "#111111", comment: "Масло сильно потемнело, рекомендуется замена" },
];

const GEAR_LEVEL_CHOICES: DiagnosticChoice[] = [
  { id: "flows", label: "Вытекает из пробки", status: "good", comment: "Уровень масла в норме" },
  { id: "edge", label: "На уровне кромки", status: "good", comment: "Уровень масла в норме" },
  { id: "below", label: "Ниже кромки", status: "warn", comment: "Уровень ниже контрольного, рекомендуется проверить герметичность" },
  { id: "very-low", label: "Сильно ниже уровня", status: "crit", comment: "Уровень сильно ниже нормы, требуется проверка и долив/замена" },
  { id: "unknown", label: "Не удалось проверить", status: "no-access", comment: "Уровень проверить не удалось из-за доступа" },
];

const BELT_CONDITION_CHOICES: Array<DiagnosticChoice & { recommendation: string; nextVisit: boolean }> = [
  {
    id: "ok",
    label: "Без трещин",
    status: "good",
    comment: "Ремень без видимых трещин и повреждений",
    recommendation: "",
    nextVisit: false,
  },
  {
    id: "micro-cracks",
    label: "Микротрещины",
    status: "warn",
    comment: "Есть микротрещины, рекомендуется контроль состояния",
    recommendation: "Контроль на следующем визите",
    nextVisit: true,
  },
  {
    id: "deep-cracks",
    label: "Глубокие трещины",
    status: "crit",
    comment: "Ремень имеет выраженные трещины, рекомендуется замена",
    recommendation: "Замена ремня навесного оборудования",
    nextVisit: false,
  },
  {
    id: "delamination",
    label: "Расслоение",
    status: "crit",
    comment: "Ремень имеет расслоение, рекомендуется замена",
    recommendation: "Замена ремня навесного оборудования",
    nextVisit: false,
  },
  {
    id: "tears",
    label: "Надрывы",
    status: "crit",
    comment: "На ремне есть надрывы, рекомендуется замена",
    recommendation: "Замена ремня навесного оборудования",
    nextVisit: false,
  },
  {
    id: "wear",
    label: "Потертости / износ дорожек",
    status: "warn",
    comment: "Есть потертости или износ дорожек ремня, рекомендуется контроль состояния",
    recommendation: "Проверка роликов и натяжителя",
    nextVisit: true,
  },
  {
    id: "noise",
    label: "Свист / шум при работе",
    status: "warn",
    comment: "Есть свист или шум при работе ременного привода, рекомендуется проверка роликов и натяжителя",
    recommendation: "Проверка роликов и натяжителя",
    nextVisit: true,
  },
  {
    id: "oil",
    label: "Следы масла на ремне",
    status: "crit",
    comment: "Есть следы масла на ремне, требуется проверить причину загрязнения",
    recommendation: "Проверка причины попадания масла",
    nextVisit: false,
  },
  {
    id: "old",
    label: "Ремень давно не менялся",
    status: "by-mileage",
    comment: "Ремень не менялся по пробегу, рекомендуется плановая замена",
    recommendation: "Замена по регламенту",
    nextVisit: true,
  },
  {
    id: "no-access",
    label: "Не удалось проверить",
    status: "no-access",
    comment: "Осмотр ремня затруднён без дополнительного доступа",
    recommendation: "Контроль на следующем визите",
    nextVisit: true,
  },
  {
    id: "mileage",
    label: "Вывод по пробегу",
    status: "by-mileage",
    comment: "Ремень не менялся по пробегу, рекомендуется плановая замена",
    recommendation: "Замена по регламенту",
    nextVisit: true,
  },
];

const LEAK_CONDITION_CHOICES: Array<DiagnosticChoice & { recommendation: string; nextVisit: boolean; photoRecommended: boolean }> = [
  {
    id: "dry",
    label: "Нет, сухо",
    status: "good",
    comment: "Следов утечек не обнаружено",
    recommendation: "",
    nextVisit: false,
    photoRecommended: false,
  },
  {
    id: "sweating",
    label: "Есть следы запотевания",
    status: "warn",
    comment: "Есть следы запотевания, рекомендуется контроль",
    recommendation: "Контроль на следующем визите",
    nextVisit: true,
    photoRecommended: true,
  },
  {
    id: "leak",
    label: "Есть явная утечка",
    status: "crit",
    comment: "Обнаружена утечка, требуется диагностика источника",
    recommendation: "Диагностика источника утечки",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "active",
    label: "Капает / активная течь",
    status: "crit",
    comment: "Обнаружена активная течь, требуется диагностика источника",
    recommendation: "Устранение течи",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "no-access",
    label: "Не удалось проверить",
    status: "no-access",
    comment: "Осмотр на утечки затруднён без дополнительного доступа",
    recommendation: "Контроль на следующем визите",
    nextVisit: true,
    photoRecommended: false,
  },
];

const LEAK_LOCATION_CHOICES = [
  "двигатель",
  "поддон",
  "коробка",
  "редуктор",
  "раздатка",
  "рулевая рейка",
  "антифриз / система охлаждения",
  "тормозная система",
  "неизвестно",
  "другое",
];

const BRAKE_PAD_LEVELS = [100, 75, 50, 30, 20, 10, 0];

const BRAKE_DISC_CONDITION_CHOICES: Array<DiagnosticChoice & { recommendation: string; nextVisit: boolean; photoRecommended: boolean }> = [
  {
    id: "ok",
    label: "Без выраженной выработки",
    status: "good",
    comment: "диски без выраженной выработки",
    recommendation: "",
    nextVisit: false,
    photoRecommended: false,
  },
  {
    id: "small-wear",
    label: "Небольшая выработка",
    status: "warn",
    comment: "есть небольшая выработка, рекомендуется контроль",
    recommendation: "Контроль дисков",
    nextVisit: true,
    photoRecommended: true,
  },
  {
    id: "edge",
    label: "Выраженная выработка / бурт",
    status: "warn",
    comment: "обнаружен выраженный бурт / выработка, рекомендуется замер толщины и возможная замена",
    recommendation: "Замер толщины дисков",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "grooves",
    label: "Борозды / канавки",
    status: "warn",
    comment: "есть борозды / канавки на рабочей поверхности, рекомендуется замер толщины и контроль",
    recommendation: "Замер толщины дисков",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "overheat",
    label: "Следы перегрева",
    status: "warn",
    comment: "есть следы перегрева, рекомендуется диагностика тормозной системы",
    recommendation: "Диагностика тормозной системы",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "blue-overheat",
    label: "Синеватый оттенок / перегрев",
    status: "crit",
    comment: "есть выраженные следы перегрева, рекомендуется диагностика тормозной системы",
    recommendation: "Диагностика тормозной системы",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "corrosion",
    label: "Коррозия рабочей поверхности",
    status: "warn",
    comment: "есть коррозия рабочей поверхности, рекомендуется контроль состояния дисков",
    recommendation: "Контроль дисков",
    nextVisit: true,
    photoRecommended: true,
  },
  {
    id: "cracks",
    label: "Трещины",
    status: "crit",
    comment: "обнаружены трещины, требуется замена дисков",
    recommendation: "Замена дисков и колодок комплектом",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "vibration",
    label: "Биение / вибрация при торможении",
    status: "crit",
    comment: "есть биение / вибрация при торможении, требуется диагностика тормозной системы",
    recommendation: "Диагностика тормозной системы",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "no-access",
    label: "Не удалось проверить",
    status: "no-access",
    comment: "диски не удалось проверить без дополнительного доступа",
    recommendation: "Контроль дисков",
    nextVisit: true,
    photoRecommended: false,
  },
];

const TIRE_WHEELS = [
  { key: "ПЛ", label: "Переднее левое", axle: "front" },
  { key: "ПП", label: "Переднее правое", axle: "front" },
  { key: "ЗЛ", label: "Заднее левое", axle: "rear" },
  { key: "ЗП", label: "Заднее правое", axle: "rear" },
] as const;

type TireWheelKey = (typeof TIRE_WHEELS)[number]["key"];

const TIRE_DAMAGE_CHOICES: Array<DiagnosticChoice & { recommendation: string; nextVisit: boolean; photoRecommended: boolean }> = [
  {
    id: "none",
    label: "нет повреждений",
    status: "good",
    comment: "нет повреждений",
    recommendation: "",
    nextVisit: false,
    photoRecommended: false,
  },
  {
    id: "cut",
    label: "порез",
    status: "warn",
    comment: "обнаружен порез",
    recommendation: "Контроль шин",
    nextVisit: true,
    photoRecommended: true,
  },
  {
    id: "bulge",
    label: "грыжа",
    status: "crit",
    comment: "обнаружена грыжа, требуется замена шины",
    recommendation: "Замена комплекта шин",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "cracks",
    label: "трещины",
    status: "warn",
    comment: "есть трещины резины, рекомендуется контроль",
    recommendation: "Контроль шин",
    nextVisit: true,
    photoRecommended: true,
  },
  {
    id: "uneven",
    label: "неравномерный износ",
    status: "warn",
    comment: "неравномерный износ, рекомендуется проверить сход-развал и подвеску",
    recommendation: "Проверка сход-развала",
    nextVisit: true,
    photoRecommended: true,
  },
  {
    id: "inner",
    label: "износ по внутреннему краю",
    status: "warn",
    comment: "износ по внутреннему краю",
    recommendation: "Проверка сход-развала",
    nextVisit: true,
    photoRecommended: true,
  },
  {
    id: "outer",
    label: "износ по внешнему краю",
    status: "warn",
    comment: "износ по внешнему краю",
    recommendation: "Проверка сход-развала",
    nextVisit: true,
    photoRecommended: true,
  },
  {
    id: "puncture",
    label: "прокол / саморез",
    status: "warn",
    comment: "обнаружен прокол / саморез",
    recommendation: "Ремонт прокола, если допустимо",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "sidewall",
    label: "повреждение боковины",
    status: "crit",
    comment: "обнаружено повреждение боковины, требуется замена шины",
    recommendation: "Замена комплекта шин",
    nextVisit: false,
    photoRecommended: true,
  },
  {
    id: "aging",
    label: "старение / дубение",
    status: "warn",
    comment: "есть признаки старения / дубения резины",
    recommendation: "Контроль шин",
    nextVisit: true,
    photoRecommended: true,
  },
  {
    id: "other",
    label: "другое",
    status: "warn",
    comment: "обнаружено повреждение шины",
    recommendation: "Контроль шин",
    nextVisit: true,
    photoRecommended: true,
  },
];

const SUSPENSION_CONDITION_CHOICES: Array<DiagnosticChoice & { recommendation: string; nextVisit: boolean; photoRecommended: "none" | "recommended" | "required" }> = [
  {
    id: "ok",
    label: "Видимых повреждений нет",
    status: "good",
    comment: "Видимых повреждений подвески не обнаружено",
    recommendation: "",
    nextVisit: false,
    photoRecommended: "none",
  },
  {
    id: "micro-wear",
    label: "Микротрещины / начальный износ",
    status: "warn",
    comment: "Есть начальные признаки износа, рекомендуется контроль",
    recommendation: "Контроль подвески",
    nextVisit: true,
    photoRecommended: "recommended",
  },
  {
    id: "silentblock-tear",
    label: "Разрыв сайлентблока",
    status: "crit",
    comment: "Обнаружен разрыв сайлентблока, рекомендуется замена",
    recommendation: "Замена сайлентблоков",
    nextVisit: false,
    photoRecommended: "required",
  },
  {
    id: "arm-play",
    label: "Люфт рычага",
    status: "crit",
    comment: "Есть люфт рычага, требуется дополнительная проверка",
    recommendation: "Диагностика подвески",
    nextVisit: false,
    photoRecommended: "required",
  },
  {
    id: "boot-damage",
    label: "Повреждение пыльника",
    status: "warn",
    comment: "Обнаружено повреждение пыльника",
    recommendation: "Диагностика подвески",
    nextVisit: true,
    photoRecommended: "recommended",
  },
  {
    id: "shock-leak",
    label: "Течь амортизатора / стойки",
    status: "crit",
    comment: "Обнаружена течь амортизатора, требуется замена/диагностика",
    recommendation: "Замена стойки / амортизатора",
    nextVisit: false,
    photoRecommended: "required",
  },
  {
    id: "deformation",
    label: "Следы удара / деформация",
    status: "crit",
    comment: "Есть следы удара / деформация, требуется диагностика подвески",
    recommendation: "Диагностика подвески",
    nextVisit: false,
    photoRecommended: "required",
  },
  {
    id: "no-access",
    label: "Не удалось проверить",
    status: "no-access",
    comment: "Осмотр подвески затруднён без дополнительного доступа",
    recommendation: "Контроль подвески",
    nextVisit: true,
    photoRecommended: "none",
  },
];

function brakePadStatus(value: number): DiagnosticMapStatusCode {
  if (value >= 50) return "good";
  if (value >= 20) return "warn";
  return "crit";
}

function brakePadAxisComment(axis: "Передние" | "Задние", value: number): string {
  if (value >= 50) return `${axis} колодки в норме, остаток около ${value}%`;
  if (value >= 20) return `${axis} колодки приближаются к минимальному остатку, остаток около ${value}%`;
  return `${axis} колодки требуют замены в ближайшее время, остаток около ${value}%`;
}

function brakeDiscAxisComment(axis: "Передние" | "Задние", choice: (typeof BRAKE_DISC_CONDITION_CHOICES)[number]): string {
  if (choice.id === "ok") return `${axis} диски без выраженной выработки`;
  if (choice.id === "no-access") return `${axis} диски не удалось проверить без дополнительного доступа`;
  return `${axis} диски: ${choice.comment}`;
}

function tireDepthStatus(depth: number): DiagnosticMapStatusCode {
  if (depth >= 5) return "good";
  if (depth >= 3) return "warn";
  return "crit";
}

function formatTireDepth(depth: number): string {
  return Number.isInteger(depth) ? String(depth) : depth.toFixed(1);
}

function clampTireDepth(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}

function parseTireWheelValue(value?: string): { depth: number | null; damage: string } {
  if (!value) return { depth: null, damage: "" };
  const [depthPart = "", damagePart = ""] = value.split("/").map((part) => part.trim());
  return {
    depth: numericValue(depthPart),
    damage: damagePart,
  };
}

function formatTireWheelValue(depth: number | null, damage: string): string {
  return [depth !== null ? `${formatTireDepth(depth)} мм` : "", damage].filter(Boolean).join(" / ");
}

function tireWheelStatus(depth: number | null, damage?: DiagnosticChoice | null): DiagnosticMapStatusCode | undefined {
  if (depth === null && !damage) return undefined;
  return worstStatus([depth !== null ? tireDepthStatus(depth) : undefined, damage?.status]);
}

function tireWheelComment(wheel: (typeof TIRE_WHEELS)[number], depth: number | null, damage?: DiagnosticChoice | null): string | null {
  const depthText = depth !== null ? `${formatTireDepth(depth)} мм` : "";
  const depthStatus = depth !== null ? tireDepthStatus(depth) : undefined;
  const damageOk = !damage || damage.id === "none";
  if (depth === null && damageOk) return null;
  if (damage && damage.id !== "none") return `${wheel.label} колесо: ${damage.comment}${depthText ? `, глубина ${depthText}` : ""}`;
  if (depthStatus === "good") return `${wheel.label} колесо: шина в норме, глубина протектора ${depthText}`;
  if (depthStatus === "warn") return `${wheel.label} колесо: глубина протектора ${depthText}, ниже рекомендуемой`;
  return `${wheel.label} колесо: глубина протектора ${depthText}, требуется замена шины`;
}

function autoMeasurementKind(code: string): AutoMeasurementKind | null {
  if (code === "oil-level") return "oil";
  if (code === "coolant") return "coolant";
  if (code === "brake-fluid") return "brake-fluid";
  if (code === "atf-condition") return "atf";
  if (["front-reducer", "rear-reducer", "transfer"].includes(code)) return "gear-oil";
  if (code === "belts") return "belt";
  if (code === "leaks") return "leak";
  if (code === "pads") return "brake-pads";
  if (code === "brake-discs") return "brake-discs";
  if (code === "tires") return "tires";
  if (code === "suspension") return "suspension";
  return null;
}

function presetSelection(options: string[], value: string): string[] {
  return value && options.includes(value) ? [value] : [];
}

function measurementPatch(item: DiagnosticMapItem, evaluation: MeasurementEvaluation): Partial<DiagnosticMapItem> {
  return {
    value: evaluation.value,
    status: evaluation.status,
    comment: evaluation.comment,
    recommendation: evaluation.recommendation,
    selectedNotes: presetSelection(item.notes, evaluation.comment),
    selectedRecommendations: presetSelection(item.recs, evaluation.recommendation),
    nextVisit: evaluation.nextVisit,
    showInReport: true,
  };
}

function valueParts(value: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const rawPart of value.split("·")) {
    const part = rawPart.trim();
    const separator = part.indexOf(":");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const partValue = part.slice(separator + 1).trim();
    if (key && partValue) parts[key] = partValue;
  }
  return parts;
}

function formatValueParts(parts: Record<string, string>, order: string[]): string {
  return order.map((key) => (parts[key] ? `${key}: ${parts[key]}` : "")).filter(Boolean).join(" · ");
}

function statusRank(status: DiagnosticMapStatusCode | undefined): number {
  if (status === "crit") return 4;
  if (status === "warn") return 3;
  if (status === "no-access" || status === "by-mileage" || status === "by-client") return 2;
  if (status === "good") return 1;
  return -1;
}

function worstStatus(statuses: Array<DiagnosticMapStatusCode | undefined>): DiagnosticMapStatusCode {
  const known = statuses.filter(Boolean) as DiagnosticMapStatusCode[];
  if (known.length === 0) return "unchecked";
  return known.reduce((worst, status) => (statusRank(status) > statusRank(worst) ? status : worst), "good" as DiagnosticMapStatusCode);
}

function checkedAutoStatus(status: DiagnosticMapStatusCode): DiagnosticMapStatusCode | null {
  return status === "unchecked" ? null : status;
}

function autoStatusFromItem(item: DiagnosticMapItem): DiagnosticMapStatusCode | null {
  const kind = autoMeasurementKind(item.code);
  if (!kind) return null;

  if (kind === "oil") {
    return checkedAutoStatus(OIL_LEVEL_ZONES.find((zone) => item.value === zone.value || item.comment === zone.comment)?.status ?? "unchecked");
  }
  if (kind === "coolant") {
    const value = numericValue(item.value);
    return value === null ? null : evaluateCoolant(value).status;
  }
  if (kind === "brake-fluid") {
    const value = numericValue(item.value);
    return value === null ? null : evaluateBrakeFluid(value).status;
  }
  if (kind === "atf") {
    const parts = valueParts(item.value);
    const base = atfBaseByLabel(parts["База"]);
    const color = base ? choiceByLabel(base.choices, parts["Цвет"]) : null;
    const smell = choiceByLabel(ATF_SMELL_CHOICES, parts["Запах"]);
    return checkedAutoStatus(worstStatus([color?.status, smell?.status]));
  }
  if (kind === "gear-oil") {
    const parts = valueParts(item.value);
    if (item.value.startsWith("Не применимо") || parts["Агрегат"] === "отсутствует") return "good";
    if (parts["Доступ"] === "затруднён") return "no-access";
    const color = choiceByLabel(GEAR_COLOR_CHOICES, parts["Цвет"]);
    const level = choiceByLabel(GEAR_LEVEL_CHOICES, parts["Уровень"]);
    return checkedAutoStatus(worstStatus([color?.status, level?.status]));
  }
  if (kind === "belt") {
    return checkedAutoStatus(
      BELT_CONDITION_CHOICES.find((choice) => item.value === `Состояние: ${choice.label}` || item.comment === choice.comment)?.status ?? "unchecked"
    );
  }
  if (kind === "leak") {
    const parts = valueParts(item.value);
    return checkedAutoStatus(
      LEAK_CONDITION_CHOICES.find((choice) => parts["Утечка"] === choice.label || item.comment.startsWith(choice.comment))?.status ?? "unchecked"
    );
  }
  if (kind === "brake-pads") {
    const parts = valueParts(item.value);
    const front = numericValue(parts["Передние"] ?? "");
    const rear = numericValue(parts["Задние"] ?? "");
    return checkedAutoStatus(worstStatus([front !== null ? brakePadStatus(front) : undefined, rear !== null ? brakePadStatus(rear) : undefined]));
  }
  if (kind === "brake-discs") {
    const parts = valueParts(item.value);
    const front = choiceByLabel(BRAKE_DISC_CONDITION_CHOICES, parts["Передние"]);
    const rear = choiceByLabel(BRAKE_DISC_CONDITION_CHOICES, parts["Задние"]);
    return checkedAutoStatus(worstStatus([front?.status, rear?.status]));
  }
  if (kind === "tires") {
    const parts = valueParts(item.value);
    const statuses = TIRE_WHEELS.map((wheel) => {
      const parsed = parseTireWheelValue(parts[wheel.key]);
      const damage = choiceByLabel(TIRE_DAMAGE_CHOICES, parsed.damage);
      return tireWheelStatus(parsed.depth, damage);
    });
    return checkedAutoStatus(worstStatus(statuses));
  }
  if (kind === "suspension") {
    return checkedAutoStatus(
      SUSPENSION_CONDITION_CHOICES.find((choice) => item.value === `Состояние: ${choice.label}` || item.comment === choice.comment)?.status ?? "unchecked"
    );
  }

  return null;
}

function choiceByLabel<T extends DiagnosticChoice>(choices: readonly T[], label?: string): T | null {
  if (!label) return null;
  return choices.find((choice) => choice.label === label) ?? null;
}

function atfBaseByLabel(label?: string): AtfBaseColor | null {
  if (!label) return null;
  return ATF_BASE_COLORS.find((base) => base.label === label) ?? null;
}

function buildAtfPatch(item: DiagnosticMapItem, parts: Record<string, string>): Partial<DiagnosticMapItem> {
  const base = atfBaseByLabel(parts["База"]) ?? ATF_BASE_COLORS[0];
  const color = choiceByLabel(base.choices, parts["Цвет"]);
  const smell = choiceByLabel(ATF_SMELL_CHOICES, parts["Запах"]);
  const status = worstStatus([color?.status, smell?.status]);
  const comments = [color?.comment, smell?.comment].filter(Boolean) as string[];
  if (status === "warn") comments.push("Рекомендуется запланировать обслуживание АКПП и контролировать состояние жидкости");
  if (status === "crit") comments.push("Рекомендуется обслуживание АКПП в ближайшее время");
  const recommendation =
    status === "crit" ? "Диагностика АКПП" : status === "warn" ? "Частичная замена ATF" : status === "no-access" ? "Контроль на следующем визите" : "";
  const comment = comments.join(". ");
  return measurementPatch(item, {
    value: formatValueParts(parts, ["База", "Цвет", "Запах"]),
    status,
    comment,
    recommendation,
    nextVisit: status === "warn" || status === "no-access",
  });
}

function gearItemName(item: DiagnosticMapItem): "переднего редуктора" | "заднего редуктора" | "раздаточной коробки" {
  if (item.code === "front-reducer") return "переднего редуктора";
  if (item.code === "rear-reducer") return "заднего редуктора";
  return "раздаточной коробки";
}

function gearOilCommentPrefix(item: DiagnosticMapItem): string {
  return item.code === "transfer" ? "Масло раздаточной коробки" : "Масло редуктора";
}

function gearRecommendation(item: DiagnosticMapItem, status: DiagnosticMapStatusCode, level?: DiagnosticChoice | null): string {
  if (status === "good") return "";
  if (status === "no-access") return "Контроль уровня на следующем визите";
  if (level?.id === "below" || level?.id === "very-low") return "Проверка герметичности редуктора";
  if (item.code === "front-reducer") return "Замена масла переднего редуктора";
  if (item.code === "rear-reducer") return "Замена масла заднего редуктора";
  return "Замена масла раздаточной коробки";
}

function buildGearPatch(item: DiagnosticMapItem, parts: Record<string, string>): Partial<DiagnosticMapItem> {
  const aggregate = parts["Агрегат"];
  if (aggregate === "отсутствует") {
    return measurementPatch(item, {
      value: "Не применимо: агрегат отсутствует",
      status: "good",
      comment: "Агрегат отсутствует, проверка масла не требуется",
      recommendation: "",
      nextVisit: false,
    });
  }

  const access = parts["Доступ"];
  if (access === "затруднён") {
    return measurementPatch(item, {
      value: formatValueParts({ Агрегат: "есть", Доступ: "затруднён" }, ["Агрегат", "Доступ"]),
      status: "no-access",
      comment: `Доступ к проверке ${gearItemName(item)} затруднён, масло напрямую не оценивалось`,
      recommendation: "Контроль уровня на следующем визите",
      nextVisit: true,
    });
  }

  const color = choiceByLabel(GEAR_COLOR_CHOICES, parts["Цвет"]);
  const level = choiceByLabel(GEAR_LEVEL_CHOICES, parts["Уровень"]);
  const status = worstStatus([color?.status, level?.status]);
  const prefix = gearOilCommentPrefix(item);
  const comments = [
    color?.comment ? color.comment.replace("Масло редуктора", prefix) : null,
    level?.comment,
  ].filter(Boolean) as string[];
  if (status === "warn") comments.push(`Рекомендуется контроль ${gearItemName(item)}`);
  if (status === "crit") comments.push(`Рекомендуется обслуживание ${gearItemName(item)} в ближайшее время`);

  return measurementPatch(item, {
    value: formatValueParts(
      { Агрегат: aggregate || "есть", Доступ: access || "есть", Цвет: parts["Цвет"], Уровень: parts["Уровень"] },
      ["Агрегат", "Доступ", "Цвет", "Уровень"]
    ),
    status,
    comment: comments.join(". "),
    recommendation: gearRecommendation(item, status, level),
    nextVisit: status === "warn" || status === "no-access",
  });
}

function buildBeltPatch(item: DiagnosticMapItem, choice: (typeof BELT_CONDITION_CHOICES)[number]): Partial<DiagnosticMapItem> {
  return measurementPatch(item, {
    value: `Состояние: ${choice.label}`,
    status: choice.status,
    comment: choice.comment,
    recommendation: choice.recommendation,
    nextVisit: choice.nextVisit,
  });
}

function buildLeakPatch(
  item: DiagnosticMapItem,
  choice: (typeof LEAK_CONDITION_CHOICES)[number],
  location?: string
): Partial<DiagnosticMapItem> {
  const needsLocation = choice.status === "warn" || choice.status === "crit";
  const leakLocation = needsLocation ? (location?.trim() ?? "") : "";
  const comment =
    choice.status === "good"
      ? choice.comment
      : choice.status === "no-access"
        ? choice.comment
        : `${choice.comment}${leakLocation ? ` (${leakLocation})` : ""}`;

  return {
    ...measurementPatch(item, {
      value: formatValueParts(
        { Утечка: choice.label, Где: leakLocation },
        leakLocation ? ["Утечка", "Где"] : ["Утечка"]
      ),
      status: choice.status,
      comment,
      recommendation: choice.recommendation,
      nextVisit: choice.nextVisit,
    }),
    selectedNotes: presetSelection(item.notes, choice.comment),
  };
}

function buildBrakePadsPatch(item: DiagnosticMapItem, parts: Record<string, string>): Partial<DiagnosticMapItem> {
  const front = numericValue(parts["Передние"] ?? "");
  const rear = numericValue(parts["Задние"] ?? "");
  const frontStatus = front !== null ? brakePadStatus(front) : undefined;
  const rearStatus = rear !== null ? brakePadStatus(rear) : undefined;
  const status = worstStatus([frontStatus, rearStatus]);
  const comments = [
    front !== null ? brakePadAxisComment("Передние", front) : null,
    rear !== null ? brakePadAxisComment("Задние", rear) : null,
  ].filter(Boolean) as string[];
  const criticalFront = frontStatus === "crit";
  const criticalRear = rearStatus === "crit";
  const warningFront = frontStatus === "warn";
  const warningRear = rearStatus === "warn";
  const recommendation =
    criticalFront && criticalRear
      ? "Замена комплекта колодок"
      : criticalFront
        ? "Замена передних колодок"
        : criticalRear
          ? "Замена задних колодок"
          : warningFront || warningRear
            ? "Контроль на следующем визите"
            : "";

  return measurementPatch(item, {
    value: formatValueParts(parts, ["Передние", "Задние"]),
    status,
    comment: comments.join(". "),
    recommendation,
    nextVisit: status === "warn",
  });
}

function buildBrakeDiscsPatch(item: DiagnosticMapItem, parts: Record<string, string>): Partial<DiagnosticMapItem> {
  const front = choiceByLabel(BRAKE_DISC_CONDITION_CHOICES, parts["Передние"]);
  const rear = choiceByLabel(BRAKE_DISC_CONDITION_CHOICES, parts["Задние"]);
  const status = worstStatus([front?.status, rear?.status]);
  const comments = [
    front ? brakeDiscAxisComment("Передние", front) : null,
    rear ? brakeDiscAxisComment("Задние", rear) : null,
  ].filter(Boolean) as string[];
  const criticalFront = front?.status === "crit";
  const criticalRear = rear?.status === "crit";
  const needsFrontReplacement = criticalFront && front?.id === "cracks";
  const needsRearReplacement = criticalRear && rear?.id === "cracks";
  const needsBrakeDiagnostic = [front?.id, rear?.id].some((id) => id === "overheat" || id === "blue-overheat" || id === "vibration");
  const needsThicknessMeasure = [front?.id, rear?.id].some((id) => id === "edge" || id === "grooves");
  const recommendation =
    needsFrontReplacement && needsRearReplacement
      ? "Замена дисков и колодок комплектом"
      : needsFrontReplacement
        ? "Замена передних тормозных дисков"
        : needsRearReplacement
          ? "Замена задних тормозных дисков"
          : criticalFront && criticalRear
            ? "Замена дисков и колодок комплектом"
            : criticalFront
              ? "Замена передних тормозных дисков"
              : criticalRear
                ? "Замена задних тормозных дисков"
                : needsBrakeDiagnostic
                  ? "Диагностика тормозной системы"
                  : needsThicknessMeasure
                    ? "Замер толщины дисков"
                    : status === "warn" || status === "no-access"
                      ? "Контроль дисков"
                      : "";

  return measurementPatch(item, {
    value: formatValueParts(parts, ["Передние", "Задние"]),
    status,
    comment: comments.join(". "),
    recommendation,
    nextVisit: status === "warn" || status === "no-access",
  });
}

function buildTiresPatch(item: DiagnosticMapItem, parts: Record<TireWheelKey, string>): Partial<DiagnosticMapItem> {
  const wheelStates = TIRE_WHEELS.map((wheel) => {
    const parsed = parseTireWheelValue(parts[wheel.key]);
    const damage = choiceByLabel(TIRE_DAMAGE_CHOICES, parsed.damage);
    const status = tireWheelStatus(parsed.depth, damage);
    return { wheel, depth: parsed.depth, damage, status };
  });
  const status = worstStatus(wheelStates.map((state) => state.status));
  const comments = wheelStates
    .map((state) => tireWheelComment(state.wheel, state.depth, state.damage))
    .filter(Boolean) as string[];
  const frontProblem = wheelStates.some((state) => state.wheel.axle === "front" && state.status === "crit");
  const rearProblem = wheelStates.some((state) => state.wheel.axle === "rear" && state.status === "crit");
  const alignmentNeeded = wheelStates.some((state) => ["uneven", "inner", "outer"].includes(state.damage?.id ?? ""));
  const puncture = wheelStates.some((state) => state.damage?.id === "puncture");
  const suspensionNeeded = wheelStates.some((state) => state.damage?.id === "uneven");
  const recommendation =
    frontProblem && rearProblem
      ? "Замена комплекта шин"
      : frontProblem
        ? "Замена передней пары шин"
        : rearProblem
          ? "Замена задней пары шин"
          : alignmentNeeded
            ? "Проверка сход-развала"
            : suspensionNeeded
              ? "Проверка подвески"
              : puncture
                ? "Ремонт прокола, если допустимо"
                : status === "warn"
                  ? "Контроль шин"
                  : "";

  return measurementPatch(item, {
    value: formatValueParts(parts, ["ПЛ", "ПП", "ЗЛ", "ЗП"]),
    status,
    comment: comments.join(". "),
    recommendation,
    nextVisit: status === "warn",
  });
}

function buildSuspensionPatch(item: DiagnosticMapItem, choice: (typeof SUSPENSION_CONDITION_CHOICES)[number]): Partial<DiagnosticMapItem> {
  return measurementPatch(item, {
    value: `Состояние: ${choice.label}`,
    status: choice.status,
    comment: choice.comment,
    recommendation: choice.recommendation,
    nextVisit: choice.nextVisit,
  });
}

function evaluateCoolant(value: number): MeasurementEvaluation {
  if (value <= -35) {
    return {
      value: `${value} °C`,
      status: "good",
      comment: "Антифриз в норме, защита достаточная",
      recommendation: "",
      nextVisit: false,
    };
  }
  if (value <= -25) {
    return {
      value: `${value} °C`,
      status: "warn",
      comment: "Показатель на границе, рекомендуется контроль",
      recommendation: "Проверка системы охлаждения / корректировка антифриза",
      nextVisit: true,
    };
  }
  return {
    value: `${value} °C`,
    status: "crit",
    comment: "Недостаточная защита по температуре, рекомендуется замена / корректировка",
    recommendation: "Замена антифриза и проверка системы охлаждения",
    nextVisit: false,
  };
}

function evaluateBrakeFluid(value: number): MeasurementEvaluation {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (value <= 1) {
    return {
      value: `${formatted} %`,
      status: "good",
      comment: "Влажность в пределах нормы",
      recommendation: "",
      nextVisit: false,
    };
  }
  if (value <= 3) {
    return {
      value: `${formatted} %`,
      status: "warn",
      comment: "Показатель повышен, рекомендуется контроль",
      recommendation: "Замена тормозной жидкости DOT 4 с прокачкой · ~2 200 ₽",
      nextVisit: true,
    };
  }
  return {
    value: `${formatted} %`,
    status: "crit",
    comment: "Влажность критическая, рекомендуется замена тормозной жидкости",
    recommendation: "Замена тормозной жидкости DOT 4 с прокачкой · ~2 200 ₽",
    nextVisit: false,
  };
}

function sliderPercent(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function fieldContext(item: DiagnosticMapItem): FieldContext {
  const indirect = isIndirectStatus(item.status);
  const label = item.measure || "Состояние / уровень";
  const unit = item.unit ? ` ${item.unit}` : "";
  const value = item.value.trim();
  const number = numericValue(value);
  const directHelper = item.norm
    ? `Норма: ${item.norm}. Для прямого осмотра укажите фактический замер или короткое состояние.`
    : "Для прямого осмотра зафиксируйте фактическое состояние узла.";
  const helper = indirect
    ? "Косвенный статус: числовой замер не обязателен. Можно указать основание: пробег, доступ или слова клиента."
    : directHelper;
  const base: FieldContext = {
    label,
    placeholder: item.unit ? `Например: ${item.norm || `12.5${unit}`}` : item.notes[0] || "Опишите состояние узла",
    helper,
    inputMode: item.unit ? "decimal" : "text",
  };

  if (indirect || !value) return base;

  if (item.code === "coolant" && number !== null) {
    if (item.status === "good" && number > -35) return { ...base, warning: "Для «Хорошо» температура обычно −35 °C или ниже." };
    if (["warn", "crit"].includes(item.status) && number <= -35) return { ...base, warning: "Значение похоже на норму. Проверьте, почему выбран статус внимания." };
  }
  if (item.code === "brake-fluid" && number !== null) {
    if (item.status === "good" && number >= 2) return { ...base, warning: "Для «Хорошо» влажность тормозной жидкости обычно ниже 2%." };
    if (["warn", "crit"].includes(item.status) && number < 2) return { ...base, warning: "Значение ниже 2%. Проверьте выбранный статус." };
  }
  if (item.code === "battery" && number !== null) {
    if (item.status === "good" && number < 12.4) return { ...base, warning: "Для «Хорошо» напряжение покоя обычно 12.4–12.7 В." };
    if (["warn", "crit"].includes(item.status) && number >= 12.4) return { ...base, warning: "Напряжение в нормальном диапазоне. Проверьте выбранный статус." };
  }
  if (item.code === "tires" && number !== null) {
    if (item.status === "good" && number <= 4) return { ...base, warning: "Для «Хорошо» глубина протектора обычно больше 4 мм." };
    if (["warn", "crit"].includes(item.status) && number > 4) return { ...base, warning: "Глубина больше 4 мм. Проверьте выбранный статус." };
  }
  if (item.code === "oil-level") {
    const badWords = ["ниже", "перелив", "долив"];
    if (item.status === "good" && includesAny(value, badWords)) return { ...base, warning: "Текст похож на отклонение, а статус выбран «Хорошо»." };
  }

  return base;
}

function allApplicable(blocks: DiagnosticMapBlock[]): DiagnosticMapItem[] {
  return blocks.flatMap((block) => block.items).filter((item) => item.applicability === "applicable");
}

function computeCounts(blocks: DiagnosticMapBlock[]) {
  const items = allApplicable(blocks);
  const count = (status: DiagnosticMapStatusCode) => items.filter((item) => item.status === status).length;
  const indirect = items.filter((item) => ["no-access", "by-mileage", "by-client"].includes(item.status)).length;
  return {
    total: items.length,
    good: count("good"),
    warn: count("warn"),
    crit: count("crit"),
    indirect,
    unchecked: count("unchecked"),
    withPhoto: items.filter((item) => item.photos.length > 0).length,
    recommendations: items.filter((item) => item.recommendation.trim() || itemNeedsRecommendation(item)).length,
  };
}

function CompletionRing({ pct }: { pct: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <div className="diag-archive-ring" aria-label={`Заполнено ${pct}%`}>
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="#3D3D3D" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="#C2410C"
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span>{pct}%</span>
    </div>
  );
}

function MeasurementPrimaryControl({
  item,
  onApply,
}: {
  item: DiagnosticMapItem;
  onApply: (patch: Partial<DiagnosticMapItem>, options?: SaveOptions) => void;
}) {
  const kind = autoMeasurementKind(item.code);
  const status = DIAGNOSTIC_MAP_STATUSES[item.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;

  if (kind === "oil") {
    const selectedZone = OIL_LEVEL_ZONES.find((zone) => zone.value === item.value || zone.comment === item.comment) ?? null;
    return (
      <div className="diag-measure-card is-oil">
        <div className="diag-measure-head">
          <strong>Отметьте уровень по щупу</strong>
          <span>Система сама выставит результат и комментарий мастера.</span>
        </div>
        <div className="diag-oil-stick" aria-label="Шкала уровня моторного масла">
          {OIL_LEVEL_ZONES.map((zone) => {
            const zoneStatus = DIAGNOSTIC_MAP_STATUSES[zone.status];
            const active = selectedZone?.id === zone.id;
            return (
              <button
                type="button"
                key={zone.id}
                className={active ? "is-active" : ""}
                style={{ "--diag-measure-color": zoneStatus.color } as CSSProperties}
                onClick={() => onApply(measurementPatch(item, zone))}
              >
                <b>{zone.label}</b>
                <small>{zone.hint}</small>
              </button>
            );
          })}
        </div>
        <div className="diag-oil-marks" aria-hidden="true">
          <span>MIN</span>
          <span>MAX</span>
        </div>
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": status.color } as CSSProperties}>
          <b>{status.icon}</b>
          <strong>{status.label}</strong>
          <span>{item.comment || "Выберите положение на шкале, чтобы получить автоматический вывод."}</span>
        </div>
      </div>
    );
  }

  if (kind === "coolant") {
    const value = numericValue(item.value) ?? -40;
    const evaluation = evaluateCoolant(value);
    const previewStatus = DIAGNOSTIC_MAP_STATUSES[evaluation.status];
    return (
      <div className="diag-measure-card">
        <div className="diag-measure-head">
          <strong>Температура замерзания</strong>
          <span>Диапазон от −50 до 0 °C. Чем ниже значение, тем выше защита.</span>
        </div>
        <div className="diag-measure-slider" style={{ "--diag-measure-color": previewStatus.color, "--diag-measure-fill": `${sliderPercent(value, -50, 0)}%` } as CSSProperties}>
          <div className="diag-measure-readout">
            <strong>{value} °C</strong>
            <span>{previewStatus.label}</span>
          </div>
          <input
            type="range"
            min="-50"
            max="0"
            step="1"
            value={value}
            onChange={(event) => {
              const next = Number(event.target.value);
              onApply(measurementPatch(item, evaluateCoolant(next)), { debounce: true });
            }}
          />
          <div className="diag-measure-scale">
            <span>−50</span>
            <span>−35 норма</span>
            <span>−25 риск</span>
            <span>0</span>
          </div>
        </div>
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": status.color } as CSSProperties}>
          <b>{status.icon}</b>
          <strong>{status.label}</strong>
          <span>{item.comment || evaluation.comment}</span>
        </div>
      </div>
    );
  }

  if (kind === "brake-fluid") {
    const value = numericValue(item.value) ?? 1;
    const evaluation = evaluateBrakeFluid(value);
    const previewStatus = DIAGNOSTIC_MAP_STATUSES[evaluation.status];
    return (
      <div className="diag-measure-card">
        <div className="diag-measure-head">
          <strong>Влажность тормозной жидкости</strong>
          <span>Шкала 0–5%. После 2% появляется зона внимания.</span>
        </div>
        <div className="diag-measure-slider" style={{ "--diag-measure-color": previewStatus.color, "--diag-measure-fill": `${sliderPercent(value, 0, 5)}%` } as CSSProperties}>
          <div className="diag-measure-readout">
            <strong>{Number.isInteger(value) ? value : value.toFixed(1)}%</strong>
            <span>{previewStatus.label}</span>
          </div>
          <input
            type="range"
            min="0"
            max="5"
            step="0.5"
            value={value}
            onChange={(event) => {
              const next = Number(event.target.value);
              onApply(measurementPatch(item, evaluateBrakeFluid(next)), { debounce: true });
            }}
          />
          <div className="diag-measure-scale">
            <span>0%</span>
            <span>1% норма</span>
            <span>3% внимание</span>
            <span>5%</span>
          </div>
        </div>
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": status.color } as CSSProperties}>
          <b>{status.icon}</b>
          <strong>{status.label}</strong>
          <span>{item.comment || evaluation.comment}</span>
        </div>
      </div>
    );
  }

  if (kind === "brake-pads") {
    const parts = valueParts(item.value);
    const front = numericValue(parts["Передние"] ?? "");
    const rear = numericValue(parts["Задние"] ?? "");
    const statusLabel = DIAGNOSTIC_MAP_STATUSES[item.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
    const applyPads = (axis: "Передние" | "Задние", value: number) =>
      onApply(buildBrakePadsPatch(item, { ...parts, [axis]: `${value}%` }));

    return (
      <div className="diag-measure-card">
        <div className="diag-measure-head">
          <strong>Остаток тормозных колодок</strong>
          <span>Выберите остаток по каждой оси. Общий результат считается по худшей оси.</span>
        </div>
        {(["Передние", "Задние"] as const).map((axis) => {
          const selected = axis === "Передние" ? front : rear;
          return (
            <div className="diag-measure-subpanel" key={axis}>
              <b>{axis} колодки</b>
              <div className="diag-choice-grid is-compact">
                {BRAKE_PAD_LEVELS.map((level) => {
                  const levelStatus = DIAGNOSTIC_MAP_STATUSES[brakePadStatus(level)];
                  return (
                    <button
                      type="button"
                      key={level}
                      className={`diag-choice-btn ${selected === level ? "is-active" : ""}`}
                      style={{ "--diag-status-color": levelStatus.color } as CSSProperties}
                      onClick={() => applyPads(axis, level)}
                    >
                      <strong>{level}%</strong>
                      <small>{levelStatus.label}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": statusLabel.color } as CSSProperties}>
          <b>{statusLabel.icon}</b>
          <strong>{statusLabel.label}</strong>
          <span>{item.comment || "Выберите остаток передних и задних колодок, чтобы получить автоматический вывод."}</span>
        </div>
      </div>
    );
  }

  if (kind === "brake-discs") {
    const parts = valueParts(item.value);
    const front = choiceByLabel(BRAKE_DISC_CONDITION_CHOICES, parts["Передние"]);
    const rear = choiceByLabel(BRAKE_DISC_CONDITION_CHOICES, parts["Задние"]);
    const statusLabel = DIAGNOSTIC_MAP_STATUSES[item.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
    const applyDiscs = (axis: "Передние" | "Задние", choice: (typeof BRAKE_DISC_CONDITION_CHOICES)[number]) =>
      onApply(buildBrakeDiscsPatch(item, { ...parts, [axis]: choice.label }));
    const photoHint = Boolean([front, rear].some((choice) => choice && choice.photoRecommended && choice.status !== "good") && item.photos.length === 0);

    return (
      <div className="diag-measure-card">
        <div className="diag-measure-head">
          <strong>Состояние тормозных дисков</strong>
          <span>Выберите состояние передних и задних дисков. Общий результат считается по худшей оси.</span>
        </div>
        {(["Передние", "Задние"] as const).map((axis) => {
          const selected = axis === "Передние" ? front : rear;
          return (
            <div className="diag-measure-subpanel" key={axis}>
              <b>{axis} диски</b>
              <div className="diag-choice-grid">
                {BRAKE_DISC_CONDITION_CHOICES.map((choice) => {
                  const choiceStatus = DIAGNOSTIC_MAP_STATUSES[choice.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
                  return (
                    <button
                      type="button"
                      key={choice.id}
                      className={`diag-choice-btn ${selected?.id === choice.id ? "is-active" : ""}`}
                      style={{ "--diag-status-color": choiceStatus.color } as CSSProperties}
                      onClick={() => applyDiscs(axis, choice)}
                    >
                      <strong>{choice.label}</strong>
                      <small>{choiceStatus.label}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {photoHint && (
          <div className="diag-measure-subpanel">
            <small>Для выработки, бурта, перегрева, трещин или биения фото диска желательно: оно попадёт в клиентский отчёт.</small>
          </div>
        )}
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": statusLabel.color } as CSSProperties}>
          <b>{statusLabel.icon}</b>
          <strong>{statusLabel.label}</strong>
          <span>{item.comment || "Выберите состояние передних и задних дисков, чтобы получить автоматический вывод."}</span>
        </div>
      </div>
    );
  }

  if (kind === "tires") {
    const rawParts = valueParts(item.value);
    const parts = {
      ПЛ: rawParts["ПЛ"] ?? "",
      ПП: rawParts["ПП"] ?? "",
      ЗЛ: rawParts["ЗЛ"] ?? "",
      ЗП: rawParts["ЗП"] ?? "",
    } satisfies Record<TireWheelKey, string>;
    const statusLabel = DIAGNOSTIC_MAP_STATUSES[item.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
    const applyWheel = (key: TireWheelKey, depth: number | null, damage: string) =>
      onApply(buildTiresPatch(item, { ...parts, [key]: formatTireWheelValue(depth, damage) }));
    const wheelStates = TIRE_WHEELS.map((wheel) => {
      const parsed = parseTireWheelValue(parts[wheel.key]);
      const damage = choiceByLabel(TIRE_DAMAGE_CHOICES, parsed.damage);
      return { wheel, depth: parsed.depth, damage };
    });
    const photoHint = Boolean(
      wheelStates.some((state) => state.damage && state.damage.photoRecommended && state.damage.status !== "good") && item.photos.length === 0
    );

    return (
      <div className="diag-measure-card">
        <div className="diag-measure-head">
          <strong>Глубина и повреждения шин</strong>
          <span>Заполните каждое колесо отдельно. Итог считается по худшему колесу.</span>
        </div>
        {wheelStates.map(({ wheel, depth, damage }) => {
          const depthForControl = depth ?? 5;
          const depthStatus = depth !== null ? DIAGNOSTIC_MAP_STATUSES[tireDepthStatus(depth)] : DIAGNOSTIC_MAP_STATUSES.unchecked;
          const selectedDamage = damage?.label ?? "";
          return (
            <div className="diag-measure-subpanel" key={wheel.key}>
              <b>{wheel.label}</b>
              <div
                className="diag-tire-depth"
                style={{
                  "--diag-measure-color": depthStatus.color,
                  "--diag-measure-fill": `${sliderPercent(depthForControl, 0, 10)}%`,
                } as CSSProperties}
              >
                <div className="diag-measure-readout">
                  <strong>{depth !== null ? `${formatTireDepth(depth)} мм` : "не указан"}</strong>
                  <span>{depth !== null ? depthStatus.label : "Нужен замер"}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.1"
                  value={depthForControl}
                  onChange={(event) => applyWheel(wheel.key, clampTireDepth(Number(event.target.value)), selectedDamage)}
                />
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={depth ?? ""}
                  placeholder="мм"
                  onChange={(event) => {
                    const next = event.target.value === "" ? null : clampTireDepth(Number(event.target.value));
                    applyWheel(wheel.key, next, selectedDamage);
                  }}
                />
              </div>
              <div className="diag-choice-grid">
                {TIRE_DAMAGE_CHOICES.map((choice) => {
                  const choiceStatus = DIAGNOSTIC_MAP_STATUSES[choice.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
                  return (
                    <button
                      type="button"
                      key={choice.id}
                      className={`diag-choice-btn ${damage?.id === choice.id ? "is-active" : ""}`}
                      style={{ "--diag-status-color": choiceStatus.color } as CSSProperties}
                      onClick={() => applyWheel(wheel.key, depth, choice.label)}
                    >
                      <strong>{choice.label}</strong>
                      <small>{choiceStatus.label}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {photoHint && (
          <div className="diag-measure-subpanel">
            <small>Фото конкретного колеса желательно. Добавьте фото ниже и подпишите: ПЛ, ПП, ЗЛ или ЗП.</small>
          </div>
        )}
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": statusLabel.color } as CSSProperties}>
          <b>{statusLabel.icon}</b>
          <strong>{statusLabel.label}</strong>
          <span>{item.comment || "Заполните глубину и повреждения по колёсам, чтобы получить автоматический вывод."}</span>
        </div>
      </div>
    );
  }

  if (kind === "suspension") {
    const selectedChoice =
      SUSPENSION_CONDITION_CHOICES.find((choice) => item.value === `Состояние: ${choice.label}` || item.comment === choice.comment) ?? null;
    const statusLabel = DIAGNOSTIC_MAP_STATUSES[item.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
    const needsPhoto = selectedChoice?.photoRecommended === "required" && item.photos.length === 0;
    const recommendsPhoto = selectedChoice?.photoRecommended === "recommended" && item.photos.length === 0;

    return (
      <div className="diag-measure-card">
        <div className="diag-measure-head">
          <strong>Визуальный осмотр подвески</strong>
          <span>Отметьте видимое состояние сайлентблоков, рычагов, пыльников и стоек.</span>
        </div>
        <div className="diag-measure-subpanel">
          <b>Что видно при осмотре</b>
          <div className="diag-choice-grid">
            {SUSPENSION_CONDITION_CHOICES.map((choice) => {
              const choiceStatus = DIAGNOSTIC_MAP_STATUSES[choice.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
              return (
                <button
                  type="button"
                  key={choice.id}
                  className={`diag-choice-btn ${selectedChoice?.id === choice.id ? "is-active" : ""}`}
                  style={{ "--diag-status-color": choiceStatus.color } as CSSProperties}
                  onClick={() => onApply(buildSuspensionPatch(item, choice))}
                >
                  <strong>{choice.label}</strong>
                  <small>{choiceStatus.label}</small>
                </button>
              );
            })}
          </div>
          {needsPhoto && <small>Для критичного повреждения фото обязательно: добавьте снимок узла ниже и подпишите место.</small>}
          {recommendsPhoto && <small>Для признаков износа фото желательно: так клиенту будет понятнее, что именно обнаружено.</small>}
        </div>
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": statusLabel.color } as CSSProperties}>
          <b>{statusLabel.icon}</b>
          <strong>{statusLabel.label}</strong>
          <span>{item.comment || "Выберите состояние подвески, чтобы получить автоматический вывод."}</span>
        </div>
      </div>
    );
  }

  if (kind === "atf") {
    const parts = valueParts(item.value);
    const selectedBase = atfBaseByLabel(parts["База"]);
    const colorChoices = selectedBase?.choices ?? [];
    const selectedColor = choiceByLabel(colorChoices, parts["Цвет"]);
    const selectedSmell = choiceByLabel(ATF_SMELL_CHOICES, parts["Запах"]);
    const applyAtf = (nextParts: Record<string, string>) => onApply(buildAtfPatch(item, nextParts));
    const statusLabel = DIAGNOSTIC_MAP_STATUSES[item.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;

    return (
      <div className="diag-measure-card">
        <div className="diag-measure-head">
          <strong>Цвет и запах ATF</strong>
          <span>Выберите базовый цвет жидкости, затем фактический цвет и запах. Итог считается по худшему подпункту.</span>
        </div>
        <div className="diag-measure-subpanel">
          <b>Базовый цвет ATF</b>
          <div className="diag-choice-grid is-compact">
            {ATF_BASE_COLORS.map((base) => (
              <button
                type="button"
                key={base.id}
                className={`diag-choice-btn ${selectedBase?.id === base.id ? "is-active" : ""}`}
                onClick={() => {
                  const next: Record<string, string> = { ...parts, База: base.label };
                  delete next["Цвет"];
                  applyAtf(next);
                }}
              >
                <strong>{base.label}</strong>
              </button>
            ))}
          </div>
        </div>
        <div className="diag-measure-subpanel">
          <b>Цвет ATF</b>
          {selectedBase ? (
            <>
              <div className="diag-color-scale">
                {colorChoices.map((choice) => (
                  <button
                    type="button"
                    key={choice.id}
                    className={selectedColor?.id === choice.id ? "is-active" : ""}
                    style={{ "--diag-measure-color": choice.color, "--diag-status-color": DIAGNOSTIC_MAP_STATUSES[choice.status].color } as CSSProperties}
                    onClick={() => applyAtf({ ...parts, База: selectedBase.label, Цвет: choice.label })}
                  >
                    <i />
                    <span>{choice.label}</span>
                  </button>
                ))}
              </div>
              <small>{selectedColor?.label ?? "Выберите точку на шкале"}</small>
            </>
          ) : (
            <p>Сначала выберите базовый цвет ATF.</p>
          )}
        </div>
        <div className="diag-measure-subpanel">
          <b>Запах ATF</b>
          <div className="diag-choice-grid">
            {ATF_SMELL_CHOICES.map((choice) => (
              <button
                type="button"
                key={choice.id}
                className={`diag-choice-btn ${selectedSmell?.id === choice.id ? "is-active" : ""}`}
                style={{ "--diag-status-color": DIAGNOSTIC_MAP_STATUSES[choice.status].color } as CSSProperties}
                onClick={() => applyAtf({ ...parts, Запах: choice.label })}
              >
                <strong>{choice.label}</strong>
                <small>{DIAGNOSTIC_MAP_STATUSES[choice.status].label}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": statusLabel.color } as CSSProperties}>
          <b>{statusLabel.icon}</b>
          <strong>{statusLabel.label}</strong>
          <span>{item.comment || "Выберите цвет и запах ATF, чтобы получить автоматический вывод."}</span>
        </div>
      </div>
    );
  }

  if (kind === "gear-oil") {
    const parsedParts = valueParts(item.value);
    const aggregateAbsent = item.value.startsWith("Не применимо") || parsedParts["Агрегат"] === "отсутствует";
    const parts = aggregateAbsent ? { ...parsedParts, Агрегат: "отсутствует" } : parsedParts;
    const accessBlocked = parts["Доступ"] === "затруднён";
    const selectedColor = choiceByLabel(GEAR_COLOR_CHOICES, parts["Цвет"]);
    const selectedLevel = choiceByLabel(GEAR_LEVEL_CHOICES, parts["Уровень"]);
    const applyGear = (nextParts: Record<string, string>) => onApply(buildGearPatch(item, nextParts));
    const statusLabel = DIAGNOSTIC_MAP_STATUSES[item.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;

    return (
      <div className="diag-measure-card">
        <div className="diag-measure-head">
          <strong>{item.title}</strong>
          <span>Сначала отметьте наличие агрегата и доступ, затем цвет и уровень масла.</span>
        </div>
        <div className="diag-measure-subpanel">
          <b>Агрегат</b>
          <div className="diag-choice-grid is-compact">
            <button
              type="button"
              className={`diag-choice-btn ${parts["Агрегат"] === "есть" && !aggregateAbsent ? "is-active" : ""}`}
              onClick={() => applyGear({ Агрегат: "есть", Доступ: "есть" })}
            >
              <strong>Агрегат есть</strong>
              <small>проверяем масло</small>
            </button>
            <button
              type="button"
              className={`diag-choice-btn ${aggregateAbsent ? "is-active" : ""}`}
              onClick={() => applyGear({ Агрегат: "отсутствует" })}
            >
              <strong>Агрегат отсутствует</strong>
              <small>не применимо</small>
            </button>
          </div>
        </div>
        {!aggregateAbsent && (
          <>
            <div className="diag-measure-subpanel">
              <b>Доступ к проверке</b>
              <div className="diag-choice-grid is-compact">
                <button
                  type="button"
                  className={`diag-choice-btn ${parts["Доступ"] !== "затруднён" ? "is-active" : ""}`}
                  onClick={() => applyGear({ ...parts, Агрегат: "есть", Доступ: "есть" })}
                >
                  <strong>Доступ есть</strong>
                </button>
                <button
                  type="button"
                  className={`diag-choice-btn ${accessBlocked ? "is-active" : ""}`}
                  style={{ "--diag-status-color": DIAGNOSTIC_MAP_STATUSES["no-access"].color } as CSSProperties}
                  onClick={() => applyGear({ Агрегат: "есть", Доступ: "затруднён" })}
                >
                  <strong>Доступ затруднён</strong>
                </button>
              </div>
            </div>
            {!accessBlocked && (
              <>
                <div className="diag-measure-subpanel">
                  <b>Цвет масла</b>
                  <div className="diag-color-scale">
                    {GEAR_COLOR_CHOICES.map((choice) => (
                      <button
                        type="button"
                        key={choice.id}
                        className={selectedColor?.id === choice.id ? "is-active" : ""}
                        style={{ "--diag-measure-color": choice.color, "--diag-status-color": DIAGNOSTIC_MAP_STATUSES[choice.status].color } as CSSProperties}
                        onClick={() => applyGear({ ...parts, Агрегат: "есть", Доступ: "есть", Цвет: choice.label })}
                      >
                        <i />
                        <span>{choice.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="diag-measure-subpanel">
                  <b>Уровень масла</b>
                  <div className="diag-choice-grid">
                    {GEAR_LEVEL_CHOICES.map((choice) => (
                      <button
                        type="button"
                        key={choice.id}
                        className={`diag-choice-btn ${selectedLevel?.id === choice.id ? "is-active" : ""}`}
                        style={{ "--diag-status-color": DIAGNOSTIC_MAP_STATUSES[choice.status].color } as CSSProperties}
                        onClick={() => applyGear({ ...parts, Агрегат: "есть", Доступ: "есть", Уровень: choice.label })}
                      >
                        <strong>{choice.label}</strong>
                        <small>{DIAGNOSTIC_MAP_STATUSES[choice.status].label}</small>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": statusLabel.color } as CSSProperties}>
          <b>{statusLabel.icon}</b>
          <strong>{aggregateAbsent ? "Не применимо" : statusLabel.label}</strong>
          <span>{item.comment || "Выберите наличие агрегата, цвет и уровень масла, чтобы получить автоматический вывод."}</span>
        </div>
      </div>
    );
  }

  if (kind === "belt") {
    const selectedChoice =
      BELT_CONDITION_CHOICES.find((choice) => item.value === `Состояние: ${choice.label}` || item.comment === choice.comment) ?? null;
    const statusLabel = DIAGNOSTIC_MAP_STATUSES[item.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;

    return (
      <div className="diag-measure-card">
        <div className="diag-measure-head">
          <strong>Состояние ремня</strong>
          <span>Выберите конкретный признак. Статус и текст для клиента выставятся автоматически.</span>
        </div>
        <div className="diag-measure-subpanel">
          <b>Что видно при осмотре</b>
          <div className="diag-choice-grid">
            {BELT_CONDITION_CHOICES.map((choice) => {
              const status = DIAGNOSTIC_MAP_STATUSES[choice.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
              return (
                <button
                  type="button"
                  key={choice.id}
                  className={`diag-choice-btn ${selectedChoice?.id === choice.id ? "is-active" : ""}`}
                  style={{ "--diag-status-color": status.color } as CSSProperties}
                  onClick={() => onApply(buildBeltPatch(item, choice))}
                >
                  <strong>{choice.label}</strong>
                  <small>{status.label}</small>
                </button>
              );
            })}
          </div>
        </div>
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": statusLabel.color } as CSSProperties}>
          <b>{statusLabel.icon}</b>
          <strong>{statusLabel.label}</strong>
          <span>{item.comment || "Выберите состояние ремня, чтобы получить автоматический вывод."}</span>
        </div>
      </div>
    );
  }

  if (kind === "leak") {
    const parts = valueParts(item.value);
    const selectedCondition =
      LEAK_CONDITION_CHOICES.find((choice) => parts["Утечка"] === choice.label || item.comment.startsWith(choice.comment)) ?? null;
    const selectedLocation = parts["Где"] ?? "";
    const statusLabel = DIAGNOSTIC_MAP_STATUSES[item.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
    const showLocation = selectedCondition?.status === "warn" || selectedCondition?.status === "crit";
    const locationCondition = showLocation ? selectedCondition : null;
    const photoHint = Boolean(showLocation && selectedCondition?.photoRecommended && item.photos.length === 0);

    return (
      <div className="diag-measure-card">
        <div className="diag-measure-head">
          <strong>Проверка утечек</strong>
          <span>Отметьте факт утечки и место. Статус, комментарий и рекомендация соберутся автоматически.</span>
        </div>
        <div className="diag-measure-subpanel">
          <b>Утечка обнаружена?</b>
          <div className="diag-choice-grid">
            {LEAK_CONDITION_CHOICES.map((choice) => {
              const status = DIAGNOSTIC_MAP_STATUSES[choice.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
              return (
                <button
                  type="button"
                  key={choice.id}
                  className={`diag-choice-btn ${selectedCondition?.id === choice.id ? "is-active" : ""}`}
                  style={{ "--diag-status-color": status.color } as CSSProperties}
                  onClick={() => onApply(buildLeakPatch(item, choice, selectedLocation))}
                >
                  <strong>{choice.label}</strong>
                  <small>{status.label}</small>
                </button>
              );
            })}
          </div>
        </div>
        {locationCondition && (
          <div className="diag-measure-subpanel">
            <b>Где течь?</b>
            <div className="diag-choice-grid is-compact">
              {LEAK_LOCATION_CHOICES.map((location) => (
                <button
                  type="button"
                  key={location}
                  className={`diag-choice-btn ${selectedLocation === location ? "is-active" : ""}`}
                  style={{ "--diag-status-color": statusLabel.color } as CSSProperties}
                  onClick={() => onApply(buildLeakPatch(item, locationCondition, location))}
                >
                  <strong>{location}</strong>
                </button>
              ))}
            </div>
            {photoHint && <small>Фото места утечки желательно: оно попадёт в клиентский отчёт с подписью.</small>}
          </div>
        )}
        <div className="diag-measure-auto-result" style={{ "--diag-status-color": statusLabel.color } as CSSProperties}>
          <b>{statusLabel.icon}</b>
          <strong>{statusLabel.label}</strong>
          <span>{item.comment || "Выберите состояние утечек, чтобы получить автоматический вывод."}</span>
        </div>
      </div>
    );
  }

  return null;
}

export function DiagnosticMapModal({
  open,
  onClose,
  diagnosticId,
  shipmentId,
  headerDraft,
  onDiagnosticCreated,
  onDiagnosticUpdated,
  onAddedToShipment,
}: DiagnosticMapModalProps) {
  const [activeId, setActiveId] = useState<string | null>(diagnosticId);
  const [data, setData] = useState<DiagnosticMapPayload | null>(null);
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [photoCaptions, setPhotoCaptions] = useState<Record<string, string>>({});
  const [photoUploads, setPhotoUploads] = useState<Record<string, PhotoUploadState[]>>({});
  const [mobileStructureOpen, setMobileStructureOpen] = useState(false);
  const [isEditingText, setIsEditingText] = useState(false);
  const [lightbox, setLightbox] = useState<{ title: string; photo: DiagnosticMapPhoto } | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const pendingSavesRef = useRef(new Set<Promise<unknown>>());
  const pendingUploadsRef = useRef(new Set<Promise<unknown>>());
  const debouncedPatchesRef = useRef(new Map<string, Partial<DiagnosticMapItem>>());
  const debounceTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastSaveErrorRef = useRef<string | null>(null);

  useEffect(() => setActiveId(diagnosticId), [diagnosticId]);

  useEffect(() => {
    if (!open) {
      setMobileStructureOpen(false);
      setIsEditingText(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !mobileStructureOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [mobileStructureOpen, open]);

  useEffect(() => {
    if (!open) return undefined;
    const isTextControl = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    };
    const onFocus = (event: FocusEvent) => {
      if (isTextControl(event.target)) setIsEditingText(true);
    };
    const onBlur = () => {
      window.setTimeout(() => setIsEditingText(isTextControl(document.activeElement)), 0);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, [open]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/diagnostics/${id}`);
      const json = await responseJson<DiagnosticMapPayload & { error?: string }>(response, {} as DiagnosticMapPayload);
      if (!response.ok) throw new Error(json.error ?? "Не удалось загрузить диагностику");
      setData(json);
      const firstBlock = json.blocks[0];
      setActiveBlock((current) => current ?? firstBlock?.code ?? null);
      setActiveItem((current) => current ?? firstBlock?.items[0]?.code ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить диагностику");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (activeId) {
      void load(activeId);
      return;
    }
    if (!shipmentId) return;
    let cancelled = false;
    async function create() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/diagnostics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipmentId,
            vin: headerDraft?.vin,
            brand: headerDraft?.brand,
            model: headerDraft?.model,
            year: headerDraft?.year,
            licensePlate: headerDraft?.licensePlate,
            mileage: headerDraft?.mileage,
            clientName: headerDraft?.clientName,
            clientPhone: headerDraft?.clientPhone,
            vehicleHints: headerDraft?.vehicleHints,
          }),
        });
        const json = await responseJson<{ diagnostic?: DiagnosticMapPayload; diagnosticId?: string; error?: string }>(response, {});
        if (!response.ok || !json.diagnostic?.id) throw new Error(json.error ?? "Не удалось создать диагностику");
        if (cancelled) return;
        setActiveId(json.diagnostic.id);
        setData(json.diagnostic);
        setActiveBlock(json.diagnostic.blocks[0]?.code ?? null);
        setActiveItem(json.diagnostic.blocks[0]?.items[0]?.code ?? null);
        onDiagnosticCreated?.(json.diagnostic.id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось создать диагностику");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void create();
    return () => {
      cancelled = true;
    };
  }, [activeId, headerDraft, load, onDiagnosticCreated, open, shipmentId]);

  const counts = useMemo(() => computeCounts(data?.blocks ?? []), [data?.blocks]);
  const completion = counts.total ? Math.round(((counts.total - counts.unchecked) / counts.total) * 100) : 0;
  const flatItems = useMemo(
    () => data?.blocks.flatMap((block) => block.items.map((item) => ({ ...item, blockCode: block.code }))) ?? [],
    [data?.blocks]
  );
  const block = data?.blocks.find((candidate) => candidate.code === activeBlock) ?? data?.blocks[0] ?? null;
  const item = flatItems.find((candidate) => candidate.code === activeItem) ?? block?.items[0] ?? null;
  const itemStatus = item ? DIAGNOSTIC_MAP_STATUSES[item.status] : DIAGNOSTIC_MAP_STATUSES.unchecked;
  const activeIndex = item ? flatItems.findIndex((candidate) => candidate.code === item.code) : -1;
  const currentField = item ? fieldContext(item) : null;
  const hasAutoMeasurement = item ? Boolean(autoMeasurementKind(item.code)) : false;
  const autoStatusCode = item ? autoStatusFromItem(item) : null;
  const autoStatus = autoStatusCode ? DIAGNOSTIC_MAP_STATUSES[autoStatusCode] : null;
  const manualStatusOverride = Boolean(hasAutoMeasurement && item && autoStatusCode && item.status !== "unchecked" && item.status !== autoStatusCode);
  const activeUploads = item ? photoUploads[item.code] ?? [] : [];

  const mutateItem = useCallback((itemCode: string, patch: Partial<DiagnosticMapItem>) => {
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        blocks: current.blocks.map((block) => ({
          ...block,
          items: block.items.map((candidate) => (candidate.code === itemCode ? { ...candidate, ...patch } : candidate)),
        })),
      };
    });
  }, []);

  const applySavedItem = useCallback((itemCode: string, saved: DiagnosticMapItem, requestPatch: Partial<DiagnosticMapItem>) => {
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        blocks: current.blocks.map((block) => ({
          ...block,
          items: block.items.map((candidate) => {
            if (candidate.code !== itemCode) return candidate;
            const next = { ...saved };
            for (const key of ["value", "comment", "recommendation"] as const) {
              if (key in requestPatch && candidate[key] !== requestPatch[key]) {
                next[key] = candidate[key];
              }
            }
            return next;
          }),
        })),
      };
    });
  }, []);

  const appendPhotoToItem = useCallback((itemCode: string, photo: DiagnosticMapPhoto) => {
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        blocks: current.blocks.map((block) => ({
          ...block,
          items: block.items.map((candidate) => (
            candidate.code === itemCode ? { ...candidate, photos: [...candidate.photos, photo] } : candidate
          )),
        })),
      };
    });
  }, []);

  const sendItemSave = useCallback(
    (itemCode: string, patch: Partial<DiagnosticMapItem>) => {
      if (!activeId) return Promise.resolve();
      lastSaveErrorRef.current = null;
      setSaveState("saving");
      const request = (async () => {
        const response = await fetch(`/api/diagnostics/${activeId}/item`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemCode, ...patch }),
        });
        const json = await responseJson<{ item?: DiagnosticMapItem; error?: string }>(response, {});
        if (!response.ok || !json.item) throw new Error(json.error ?? "Не удалось сохранить пункт");
        applySavedItem(itemCode, json.item, patch);
        setSaveState("saved");
      })().catch((e) => {
        const message = e instanceof Error ? e.message : "Не удалось сохранить пункт";
        lastSaveErrorRef.current = message;
        setSaveState("error");
        setError(message);
      });
      pendingSavesRef.current.add(request);
      request.finally(() => pendingSavesRef.current.delete(request)).catch(() => {});
      return request;
    },
    [activeId, applySavedItem]
  );

  const saveItem = useCallback(
    (itemCode: string, patch: Partial<DiagnosticMapItem>, options?: SaveOptions) => {
      mutateItem(itemCode, patch);
      if (!options?.debounce) return sendItemSave(itemCode, patch);

      lastSaveErrorRef.current = null;
      setSaveState("saving");
      debouncedPatchesRef.current.set(itemCode, {
        ...(debouncedPatchesRef.current.get(itemCode) ?? {}),
        ...patch,
      });
      const currentTimer = debounceTimersRef.current.get(itemCode);
      if (currentTimer) clearTimeout(currentTimer);
      const timer = setTimeout(() => {
        debounceTimersRef.current.delete(itemCode);
        const queuedPatch = debouncedPatchesRef.current.get(itemCode);
        if (!queuedPatch) return;
        debouncedPatchesRef.current.delete(itemCode);
        void sendItemSave(itemCode, queuedPatch);
      }, 450);
      debounceTimersRef.current.set(itemCode, timer);
      return Promise.resolve();
    },
    [mutateItem, sendItemSave]
  );

  function flushDebouncedSaves() {
    for (const [itemCode, timer] of debounceTimersRef.current.entries()) {
      clearTimeout(timer);
      debounceTimersRef.current.delete(itemCode);
      const queuedPatch = debouncedPatchesRef.current.get(itemCode);
      if (!queuedPatch) continue;
      debouncedPatchesRef.current.delete(itemCode);
      void sendItemSave(itemCode, queuedPatch);
    }
  }

  async function waitForPendingWork() {
    flushDebouncedSaves();
    while (pendingSavesRef.current.size > 0 || pendingUploadsRef.current.size > 0) {
      await Promise.allSettled([...pendingSavesRef.current, ...pendingUploadsRef.current]);
      flushDebouncedSaves();
    }
  }

  function gotoPrevious() {
    if (!item) return;
    const index = flatItems.findIndex((candidate) => candidate.code === item.code);
    const previous = flatItems[index - 1];
    if (previous) {
      setActiveBlock(previous.blockCode);
      setActiveItem(previous.code);
      setShowSummary(false);
    }
  }

  function gotoNext() {
    if (!item) return;
    const index = flatItems.findIndex((candidate) => candidate.code === item.code);
    const next = flatItems[index + 1];
    if (next) {
      setActiveBlock(next.blockCode);
      setActiveItem(next.code);
      setShowSummary(false);
    } else {
      setShowSummary(true);
    }
  }

  function uploadPhotoXhr(target: DiagnosticMapItem, upload: PhotoUploadState): Promise<DiagnosticMapPhoto> {
    return new Promise((resolve, reject) => {
      if (!activeId) {
        reject(new Error("Диагностика ещё не создана"));
        return;
      }
      const form = new FormData();
      form.set("itemCode", target.code);
      form.set("caption", upload.caption.trim());
      form.set("file", upload.file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/diagnostics/${activeId}/photos`);
      xhr.upload.onprogress = (event) => {
        const progress = event.lengthComputable ? Math.max(8, Math.round((event.loaded / event.total) * 92)) : 45;
        setPhotoUploads((current) => ({
          ...current,
          [target.code]: (current[target.code] ?? []).map((candidate) => (
            candidate.id === upload.id ? { ...candidate, progress } : candidate
          )),
        }));
      };
      xhr.onerror = () => reject(new Error("Не удалось отправить фото. Проверьте соединение и попробуйте ещё раз."));
      xhr.onload = () => {
        let json: { photo?: DiagnosticMapPhoto; error?: string } = {};
        try {
          json = JSON.parse(xhr.responseText || "{}") as { photo?: DiagnosticMapPhoto; error?: string };
        } catch {
          json = {};
        }
        if (xhr.status < 200 || xhr.status >= 300 || !json.photo) {
          reject(new Error(json.error ?? "Фото не загрузилось. Попробуйте повторить."));
          return;
        }
        resolve(json.photo);
      };
      xhr.send(form);
    });
  }

  function runPhotoUpload(target: DiagnosticMapItem, upload: PhotoUploadState) {
    setPhotoUploads((current) => ({
      ...current,
      [target.code]: (current[target.code] ?? []).map((candidate) => (
        candidate.id === upload.id ? { ...candidate, status: "uploading", progress: 6, error: undefined } : candidate
      )),
    }));
    const request = (async () => {
      const photo = await uploadPhotoXhr(target, upload);
      appendPhotoToItem(target.code, { ...photo, thumbnailUrl: photo.thumbnailUrl || photo.url });
      setPhotoUploads((current) => ({
        ...current,
        [target.code]: (current[target.code] ?? []).filter((candidate) => candidate.id !== upload.id),
      }));
      setPhotoCaptions((current) => ({ ...current, [target.code]: "" }));
      URL.revokeObjectURL(upload.previewUrl);
    })().catch((e) => {
      const message = e instanceof Error ? e.message : "Фото не загрузилось. Попробуйте повторить.";
      setPhotoUploads((current) => ({
        ...current,
        [target.code]: (current[target.code] ?? []).map((candidate) => (
          candidate.id === upload.id ? { ...candidate, status: "error", progress: 100, error: message } : candidate
        )),
      }));
      setError(message);
      throw e;
    });
    pendingUploadsRef.current.add(request);
    request.finally(() => pendingUploadsRef.current.delete(request)).catch(() => {});
    return request;
  }

  async function uploadPhoto(target: DiagnosticMapItem, file: File | null) {
    if (!activeId || !file) return;
    const caption = (photoCaptions[target.code] ?? "").trim();
    const upload: PhotoUploadState = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${file.name}`,
      file,
      caption,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
      status: "uploading",
    };
    setPhotoUploads((current) => ({ ...current, [target.code]: [...(current[target.code] ?? []), upload] }));
    await runPhotoUpload(target, upload).catch(() => {});
  }

  function updateUploadCaption(itemCode: string, uploadId: string, caption: string) {
    setPhotoUploads((current) => ({
      ...current,
      [itemCode]: (current[itemCode] ?? []).map((candidate) => (candidate.id === uploadId ? { ...candidate, caption } : candidate)),
    }));
  }

  function removeUpload(itemCode: string, upload: PhotoUploadState) {
    setPhotoUploads((current) => ({
      ...current,
      [itemCode]: (current[itemCode] ?? []).filter((candidate) => candidate.id !== upload.id),
    }));
    URL.revokeObjectURL(upload.previewUrl);
  }

  async function updatePhotoCaption(target: DiagnosticMapItem, photo: DiagnosticMapPhoto, caption: string) {
    if (!activeId) return;
    mutateItem(target.code, { photos: target.photos.map((candidate) => (candidate.id === photo.id ? { ...candidate, caption } : candidate)) });
    await fetch(`/api/diagnostics/${activeId}/photos/${photo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption }),
    });
  }

  async function deletePhoto(target: DiagnosticMapItem, photoId: string) {
    if (!activeId) return;
    mutateItem(target.code, { photos: target.photos.filter((photo) => photo.id !== photoId) });
    await fetch(`/api/diagnostics/${activeId}/photos/${photoId}`, { method: "DELETE" });
  }

  async function complete() {
    if (!activeId) return;
    setSaveState("saving");
    await waitForPendingWork();
    if (lastSaveErrorRef.current) {
      setSaveState("error");
      setError(`Не все поля сохранились: ${lastSaveErrorRef.current}`);
      return;
    }
    const failedUploads = Object.values(photoUploads).flat().filter((upload) => upload.status === "error");
    if (failedUploads.length > 0) {
      setSaveState("error");
      setError("Есть фото с ошибкой загрузки. Повторите загрузку или уберите карточку перед завершением.");
      return;
    }
    const response = await fetch(`/api/diagnostics/${activeId}/complete`, { method: "POST" });
    const json = await responseJson<DiagnosticMapPayload & { error?: string }>(response, {} as DiagnosticMapPayload);
    if (!response.ok) {
      setError(json.error ?? "Не удалось завершить диагностику");
      return;
    }
    setData(json);
    setSaveState("saved");
    onDiagnosticUpdated?.(json);
    setShowSummary(true);
  }

  async function copyReportLink() {
    if (!data?.reportUrl) return;
    await navigator.clipboard?.writeText(data.reportUrl);
    setSaveState("saved");
  }

  async function addRecommendationToShipment(target: DiagnosticMapItem) {
    if (!activeId) return;
    await fetch(`/api/diagnostics/${activeId}/recommendations/add-to-shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemCode: target.code }),
    });
    onAddedToShipment?.();
  }

  if (!open) return null;

  return (
    <div className={`diag-archive-screen ${mobileStructureOpen ? "has-mobile-structure" : ""} ${isEditingText ? "is-editing-text" : ""}`}>
      <header className="diag-archive-topbar">
        <button type="button" className="diag-archive-close" onClick={onClose}>
          <ChevronLeft size={16} /> Закрыть
        </button>
        <div className="diag-archive-separator" />
        <div className="diag-archive-title">
          <span>Диагностика · {counts.total || DIAGNOSTIC_MAP_CATALOG_TOTAL} пунктов · {data?.shipmentId ?? shipmentId ?? "отгрузка"}</span>
          <strong>
            {data?.vehicle.title ?? "Автомобиль"} · <b>{data?.vehicle.licensePlate || "номер не указан"}</b>
          </strong>
          <small>{data?.clientName || headerDraft?.clientName || "Клиент не указан"}</small>
        </div>
        <div className="diag-archive-actions">
          <CompletionRing pct={completion} />
          <div className="diag-archive-progress">
            <span>Прогресс</span>
            <strong>{counts.total - counts.unchecked} / {counts.total || DIAGNOSTIC_MAP_CATALOG_TOTAL}</strong>
          </div>
          {data?.reportUrl && (
            <a href={`${data.reportUrl}/print`} target="_blank" rel="noreferrer" className="diag-archive-btn is-dark">
              <Printer size={16} /> Печать карты
            </a>
          )}
          <button type="button" className="diag-archive-btn is-primary" onClick={() => setShowSummary(true)}>
            Завершить и отправить →
          </button>
        </div>
      </header>

      {error && (
        <div className="diag-archive-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}

      {loading || !data || !block || !item ? (
        <div className="diag-archive-loading">Загрузка карты диагностики...</div>
      ) : (
        <>
        {!showSummary && (
          <div className="diag-archive-mobilebar">
            <button type="button" className="diag-archive-mobilebar-structure" onClick={() => setMobileStructureOpen(true)}>
              <span>{block.title}</span>
              <strong>Пункт {Math.max(activeIndex + 1, 1)} из {flatItems.length || DIAGNOSTIC_MAP_CATALOG_TOTAL}</strong>
            </button>
            <button type="button" className="diag-archive-mobilebar-summary" onClick={() => setShowSummary(true)}>
              Итог
            </button>
          </div>
        )}
        <div className="diag-archive-body">
          {mobileStructureOpen && (
            <button
              type="button"
              aria-label="Закрыть структуру диагностики"
              className="diag-archive-drawer-backdrop"
              onClick={() => setMobileStructureOpen(false)}
            />
          )}
          <aside className="diag-archive-sidebar">
            <div className="diag-archive-sidebar-head">
              <span>Структура диагностики</span>
              <button type="button" aria-label="Закрыть структуру" onClick={() => setMobileStructureOpen(false)}>×</button>
            </div>
            {data.blocks.map((candidate) => {
              const openBlock = candidate.code === block.code;
              const blockCounts = computeCounts([candidate]);
              return (
                <section key={candidate.code} className="diag-archive-block">
                  <button
                    type="button"
                    className={`diag-archive-block-btn ${openBlock ? "is-open" : ""}`}
                    onClick={() => {
                      setActiveBlock(candidate.code);
                      setActiveItem(candidate.items[0]?.code ?? null);
                      setShowSummary(false);
                    }}
                  >
                    <span>
                      <strong>{candidate.title}</strong>
                      <small>{countLabel(candidate.items.length)}</small>
                    </span>
                    <i className="is-crit">{blockCounts.crit || ""}</i>
                    <i className="is-warn">{blockCounts.warn || ""}</i>
                    <i className="is-ind">{blockCounts.indirect || ""}</i>
                    <i className="is-good">{blockCounts.good || ""}</i>
                  </button>
                  {openBlock && (
                    <div className="diag-archive-items">
                      {candidate.items.map((candidateItem) => {
                        const status = DIAGNOSTIC_MAP_STATUSES[candidateItem.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
                        const active = candidateItem.code === item.code && !showSummary;
                        return (
                          <button
                            type="button"
                            key={candidateItem.code}
                            className={`diag-archive-item-btn ${active ? "is-active" : ""}`}
                            onClick={() => {
                              setActiveItem(candidateItem.code);
                              setShowSummary(false);
                              setMobileStructureOpen(false);
                            }}
                          >
                            <b style={{ background: status.color }}>{status.icon}</b>
                            <span>{candidateItem.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
            <div className="diag-archive-side-summary">
              <span>Сводка</span>
              <div>
                <p><i className="dot success" />Хорошо <b>{counts.good}</b></p>
                <p><i className="dot warning" />Внимание <b>{counts.warn}</b></p>
                <p><i className="dot danger" />Критично <b>{counts.crit}</b></p>
                <p><i className="dot info" />Косвенно <b>{counts.indirect}</b></p>
              </div>
            </div>
          </aside>

          <main className="diag-archive-main">
            {showSummary ? (
              <section className="diag-archive-summary">
                <div>
                  <span>Финальная сводка</span>
                  <h1>Диагностика готова к отправке</h1>
                  <p>{counts.total} пунктов проверены · {counts.recommendations} рекомендаций сформированы</p>
                </div>
                <button type="button" className="diag-archive-btn" onClick={() => setShowSummary(false)}>
                  <ChevronLeft size={16} /> Вернуться к проверкам
                </button>
                <div className="diag-archive-summary-grid">
                  <p style={{ borderTopColor: "#15803D" }}><span>Хорошо</span><b>{counts.good}</b></p>
                  <p style={{ borderTopColor: "#B45309" }}><span>Внимание</span><b>{counts.warn}</b></p>
                  <p style={{ borderTopColor: "#B91C1C" }}><span>Критично</span><b>{counts.crit}</b></p>
                  <p style={{ borderTopColor: "#1D4ED8" }}><span>Косвенно</span><b>{counts.indirect}</b></p>
                  <p style={{ borderTopColor: "#A3A3A3" }}><span>Не проверено</span><b>{counts.unchecked}</b></p>
                </div>
                <div className="diag-archive-summary-recs">
                  {flatItems.filter((candidate) => candidate.recommendation).map((candidate) => {
                    const status = DIAGNOSTIC_MAP_STATUSES[candidate.status] ?? DIAGNOSTIC_MAP_STATUSES.warn;
                    return (
                      <article key={candidate.code} style={{ borderLeftColor: status.color }}>
                        <strong>{candidate.title}</strong>
                        <span>{status.label}</span>
                        <p>{candidate.recommendation}</p>
                      </article>
                    );
                  })}
                </div>
                <div className="diag-archive-summary-actions">
                  {data.reportUrl && <a href={`${data.reportUrl}/print`} target="_blank" rel="noreferrer" className="diag-archive-btn"><Printer size={16} /> Печать карты</a>}
                  {data.reportUrl && <a href={data.reportUrl} target="_blank" rel="noreferrer" className="diag-archive-btn">Превью отчёта</a>}
                  <button type="button" className="diag-archive-btn" onClick={() => void copyReportLink()}><Copy size={16} /> Скопировать ссылку</button>
                  <button type="button" className="diag-archive-btn is-primary" onClick={() => void complete()}>Завершить и отправить →</button>
                </div>
              </section>
            ) : (
              <>
                <div className="diag-archive-item-head">
                  <div>
                    <span>{block.title}</span>
                    <h2>{item.title}</h2>
                    {item.norm && <p>Норма: <b>{item.norm}</b></p>}
                  </div>
                </div>

                <section className={`diag-archive-field ${currentField?.warning ? "has-warning" : ""} ${hasAutoMeasurement ? "is-primary-measure" : ""}`}>
                  <span>
                    <b>Оценка / замер</b>
                    <em>{currentField?.label || "Состояние / уровень"}{item.unit ? ` · ${item.unit}` : ""}</em>
                  </span>
                  {hasAutoMeasurement ? (
                    <MeasurementPrimaryControl item={item} onApply={(patch, options) => void saveItem(item.code, patch, options)} />
                  ) : (
                    <>
                      <input
                        value={item.value}
                        inputMode={currentField?.inputMode}
                        aria-invalid={Boolean(currentField?.warning)}
                        onChange={(event) => void saveItem(item.code, { value: event.target.value }, { debounce: true })}
                        placeholder={currentField?.placeholder || "Опиши результат"}
                      />
                      <p>{currentField?.warning || currentField?.helper}</p>
                    </>
                  )}
                </section>

                <section className="diag-archive-status is-secondary">
                  {hasAutoMeasurement && (
                    <p className="diag-archive-status-helper">
                      Результат ниже выставляется автоматически по выбранным значениям. Вручную меняйте только как осознанную корректировку мастера.
                    </p>
                  )}
                  {manualStatusOverride && autoStatus && autoStatusCode && (
                    <p className="diag-archive-status-helper is-override" style={{ "--diag-status-color": autoStatus.color } as CSSProperties}>
                      <span>
                        Ручная корректировка: авторасчёт даёт <b>{autoStatus.label}</b>, сейчас выбрано <b>{itemStatus.label}</b>.
                      </span>
                      <button type="button" onClick={() => void saveItem(item.code, { status: autoStatusCode })}>
                        Вернуть авто
                      </button>
                    </p>
                  )}
                  {DIAGNOSTIC_STATUS_GROUPS.map((group) => (
                    <div key={group.title}>
                      <span>{group.title}</span>
                      <div className={group.title === "Без прямого осмотра" ? "is-indirect" : ""}>
                        {group.statuses.map((statusCode) => {
                          const status = DIAGNOSTIC_MAP_STATUSES[statusCode];
                          const active = item.status === statusCode;
                          return (
                            <button
                              type="button"
                              key={statusCode}
                              className={active ? "is-active" : ""}
                              style={{ "--diag-status-color": status.color } as CSSProperties}
                              onClick={() => void saveItem(item.code, { status: statusCode })}
                            >
                              <b>{status.icon}</b>
                              <span>
                                <strong>{status.label}</strong>
                                {status.hint && <small>{status.hint}</small>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>

                <section className="diag-archive-photos">
                  <span>Фото · {item.photos.length + activeUploads.length}<small> · подпись можно добавить после загрузки</small></span>
                  <div>
                    {activeUploads.map((upload) => (
                      <figure key={upload.id} className={`diag-archive-photo-upload is-${upload.status}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                        <img src={upload.previewUrl} alt="Загрузка фото диагностики" />
                        <figcaption>
                          <b>{upload.status === "error" ? "ERROR" : `${upload.progress}%`}</b>
                          <input
                            value={upload.caption}
                            onChange={(event) => updateUploadCaption(item.code, upload.id, event.target.value)}
                            placeholder="Подпись необязательна"
                          />
                        </figcaption>
                        <div className="diag-archive-photo-progress" aria-label={`Загрузка ${upload.progress}%`}>
                          <i style={{ width: `${upload.progress}%` }} />
                        </div>
                        {upload.status === "error" && (
                          <div className="diag-archive-photo-error">
                            <small>{upload.error}</small>
                            <button type="button" onClick={() => void runPhotoUpload(item, upload)}>Повторить</button>
                            <button type="button" onClick={() => removeUpload(item.code, upload)}>Убрать</button>
                          </div>
                        )}
                      </figure>
                    ))}
                    {item.photos.map((photo, index) => (
                      <figure key={photo.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- local diagnostic photo */}
                        <img src={photo.thumbnailUrl} alt={photo.caption} onClick={() => setLightbox({ title: item.title, photo })} />
                        <figcaption>
                          <b>IMG_{String(index + 1).padStart(3, "0")}</b>
                          <input value={photo.caption} onChange={(event) => void updatePhotoCaption(item, photo, event.target.value)} />
                        </figcaption>
                        <button type="button" onClick={() => void deletePhoto(item, photo.id)}>×</button>
                      </figure>
                    ))}
                    <label className="diag-archive-photo-add">
                      <input
                        ref={(node) => {
                          fileInputs.current[item.code] = node;
                        }}
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          event.target.value = "";
                          void uploadPhoto(item, file);
                        }}
                      />
                      <input
                        value={photoCaptions[item.code] ?? ""}
                        onChange={(event) => setPhotoCaptions((current) => ({ ...current, [item.code]: event.target.value }))}
                        placeholder="Подпись необязательна"
                      />
                      <button type="button" onClick={() => fileInputs.current[item.code]?.click()}>+ Загрузить фото</button>
                    </label>
                  </div>
                </section>

                <section className="diag-archive-comment">
                  <span>
                    <b>Комментарий мастера</b>
                    <em>Пояснение клиенту: что увидели, почему выбран статус, что важно запомнить.</em>
                  </span>
                  {item.notes.length > 0 && (
                    <div>
                      {item.notes.map((note) => (
                        <button
                          key={note}
                          type="button"
                          className={`preset-chip ${item.selectedNotes.includes(note) ? "is-active" : ""}`}
                          onClick={() =>
                            void saveItem(item.code, {
                              comment: appendText(item.comment, note),
                              selectedNotes: Array.from(new Set([...item.selectedNotes, note])),
                            })
                          }
                        >
                          {note}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={item.comment}
                    onChange={(event) => void saveItem(item.code, { comment: event.target.value }, { debounce: true })}
                    placeholder="Что увидели · что насторожило · какие шумы / запахи"
                  />
                </section>

                {itemNeedsRecommendation(item) && (
                  <section className={`diag-archive-recommendation is-${itemStatus.tone}`}>
                    <span>{itemStatus.icon} Рекомендация клиенту</span>
                    <div>
                      {Array.from(new Set([...item.recs, ...REC_PRESETS_COMMON])).map((rec) => (
                        <button
                          key={rec}
                          type="button"
                          className={`preset-chip light ${item.selectedRecommendations.includes(rec) ? "is-active" : ""}`}
                          onClick={() => void saveItem(item.code, { recommendation: rec, selectedRecommendations: [rec] })}
                        >
                          {rec}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={item.recommendation}
                      onChange={(event) => void saveItem(item.code, { recommendation: event.target.value }, { debounce: true })}
                      placeholder="Что предлагаем сделать. С ценой и сроком."
                    />
                    <footer>
                      <small>Эта рекомендация попадёт в публичный отчёт клиенту.</small>
                      <button type="button" onClick={() => void addRecommendationToShipment(item)}>Добавить в отгрузку</button>
                    </footer>
                  </section>
                )}
                <div className="diag-archive-workbar">
                  <div>
                    <span>{block.short} · {Math.max(activeIndex + 1, 1)} / {flatItems.length || DIAGNOSTIC_MAP_CATALOG_TOTAL}</span>
                    <strong>{item.title}</strong>
                  </div>
                  <nav>
                    <button type="button" className="diag-archive-btn" onClick={gotoPrevious} disabled={activeIndex <= 0}>
                      <ChevronLeft size={16} /> Назад
                    </button>
                    <button type="button" className="diag-archive-btn is-primary" onClick={gotoNext}>
                      {activeIndex >= flatItems.length - 1 ? "К сводке" : "Дальше"} <ChevronRight size={16} />
                    </button>
                  </nav>
                </div>
              </>
            )}
          </main>
        </div>
        </>
      )}

      <div className={`diag-archive-save is-${saveState}`}>
        {saveState === "saving" ? "Сохраняем..." : saveState === "error" ? "Ошибка сохранения" : saveState === "saved" ? "Сохранено" : ""}
      </div>

      {lightbox && (
        <div className="diag-archive-lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <div onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setLightbox(null)}><X size={18} /></button>
            {/* eslint-disable-next-line @next/next/no-img-element -- local diagnostic photo */}
            <img src={lightbox.photo.url} alt={lightbox.photo.caption} />
            <strong>{lightbox.title}</strong>
            <p>{lightbox.photo.caption}</p>
          </div>
        </div>
      )}
    </div>
  );
}
