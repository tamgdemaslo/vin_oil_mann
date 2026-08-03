import {
  DIAGNOSTIC_MAP_STATUSES,
  type DiagnosticMapCheckMethod,
  type DiagnosticMapStatusCode,
} from "@/data/diagnostic-map";

export type DiagnosticReportTextInput = {
  code?: string;
  title: string;
  status: DiagnosticMapStatusCode;
  checkMethod: DiagnosticMapCheckMethod;
  value?: string | null;
  comment?: string | null;
  recommendation?: string | null;
  photoCount?: number;
  mileage?: number | null;
  date?: string | null;
};

export type DiagnosticReportText = {
  title: string;
  statusLabel: string;
  sourceText: string;
  resultText: string;
  recommendationText: string;
  photoText: string;
  shortText: string;
};

type DiagnosticItemSpecificText = Partial<DiagnosticReportText> & Pick<DiagnosticReportText, "resultText" | "recommendationText" | "shortText">;

const METHOD_TEXT: Record<DiagnosticMapCheckMethod, string> = {
  inspection: "Пункт оценён прямым осмотром мастера.",
  mileage: "Рекомендация сформирована по пробегу и регламенту обслуживания, без прямого осмотра узла.",
  client_words: "Информация указана со слов клиента и требует подтверждения при осмотре.",
  no_access: "Узел не удалось проверить без дополнительного доступа или разборки.",
  skipped: "Пункт пока не проверялся в рамках этой диагностики.",
};

const STATUS_TEXT: Record<DiagnosticMapStatusCode, string> = {
  unchecked: "Пункт пока не заполнен мастером.",
  good: "Пункт проверен. Отклонений не выявлено.",
  warn: "Пункт требует внимания. Рекомендуем проконтролировать состояние и запланировать обслуживание.",
  crit: "Рекомендуем выполнить обслуживание в ближайшее время.",
  "no-access": "Узел не удалось проверить без дополнительного доступа или разборки.",
  "by-mileage": "Рекомендация сформирована по пробегу и регламенту обслуживания, без прямого осмотра узла.",
  "by-client": "Информация указана со слов клиента и требует подтверждения при осмотре.",
};

function cleanText(value?: string | null): string {
  return (value ?? "").trim();
}

function stripFinalDot(value: string): string {
  return value.replace(/[.\s]+$/u, "").trim();
}

function sentence(value?: string | null): string {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function lowerFirst(value: string): string {
  return value ? `${value.slice(0, 1).toLowerCase()}${value.slice(1)}` : value;
}

function recommendationSentence(value?: string | null, fallback?: string): string {
  const text = cleanText(value);
  if (!text) return sentence(fallback);
  if (/^рекоменду/iu.test(text)) return sentence(text);
  if (/^замена\s+/iu.test(text)) return sentence(`Рекомендуем ${text.replace(/^замена\s+/iu, "замену ")}`);
  if (/^проверка\s+/iu.test(text)) return sentence(`Рекомендуем ${text.replace(/^проверка\s+/iu, "проверку ")}`);
  if (/^диагностика\s+/iu.test(text)) return sentence(`Рекомендуем ${text.replace(/^диагностика\s+/iu, "диагностику ")}`);
  if (/^устранение\s+/iu.test(text)) return sentence(`Рекомендуем ${text.replace(/^устранение\s+/iu, "устранить ")}`);
  return sentence(`Рекомендуем ${lowerFirst(text)}`);
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

function firstValuePart(value: string, key: string): string {
  return valueParts(value)[key] ?? "";
}

function humanGenericValue(value: string): string {
  const text = cleanText(value)
    .replace(/^Состояние:\s*/iu, "")
    .replace(/^Утечка:\s*/iu, "")
    .replace(/\s+·\s+/gu, ", ")
    .replace(/\bПЛ:/gu, "переднее левое:")
    .replace(/\bПП:/gu, "переднее правое:")
    .replace(/\bЗЛ:/gu, "заднее левое:")
    .replace(/\bЗП:/gu, "заднее правое:");
  return stripFinalDot(text);
}

function numericValue(value?: string): number | null {
  if (!value) return null;
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : null;
}

function batterySohPercent(value?: string | null): number | null {
  const raw = cleanText(value);
  if (!raw || /(?:^|\s)(?:в|v)(?:\s|$|[.,])/iu.test(raw)) return null;
  const parts = valueParts(raw);
  const candidate = parts.SOH ?? parts["Здоровье АКБ"] ?? raw;
  const hasSohSignal = /soh|здоров|%/iu.test(raw) || /^\d{1,3}$/u.test(raw);
  if (!hasSohSignal) return null;
  const parsed = numericValue(candidate);
  if (parsed === null || parsed < 0 || parsed > 100) return null;
  return Math.round(parsed);
}

function locationPhrase(location: string): string {
  const place = cleanText(location);
  if (!place || place === "неизвестно") return "";
  if (place === "антифриз / система охлаждения") return "в системе охлаждения";
  if (place === "тормозная система") return "в тормозной системе";
  if (place === "рулевая рейка") return "в районе рулевой рейки";
  return `в районе ${place}`;
}

function axisStatusByPercent(value: number | null): DiagnosticMapStatusCode | null {
  if (value === null) return null;
  if (value >= 50) return "good";
  if (value >= 20) return "warn";
  return "crit";
}

function formatPercent(value: number | null): string {
  if (value === null) return "не указано";
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function reportForBattery(value: string, status: DiagnosticMapStatusCode): DiagnosticReportText | null {
  const soh = batterySohPercent(value);
  const sohText = soh !== null ? ` Здоровье АКБ: ${soh}%.` : "";
  const statusLabel = DIAGNOSTIC_MAP_STATUSES[status]?.label ?? "Не проверено";
  if (status === "good") {
    return {
      title: "АКБ — состояние аккумулятора",
      statusLabel,
      sourceText: "Состояние аккумулятора оценено по SOH тестера.",
      resultText: `Аккумулятор в хорошем состоянии.${sohText}`,
      recommendationText: "",
      photoText: "",
      shortText: soh !== null ? `SOH ${soh}% · Хорошо` : "Хорошо · аккумулятор в хорошем состоянии",
    };
  }
  if (status === "warn") {
    return {
      title: "АКБ — состояние аккумулятора",
      statusLabel,
      sourceText: "Состояние аккумулятора оценено по SOH тестера.",
      resultText: `Аккумулятор имеет признаки износа.${sohText}`,
      recommendationText: "Рекомендуем контролировать состояние аккумулятора, особенно перед холодным сезоном.",
      photoText: "",
      shortText: soh !== null ? `SOH ${soh}% · Внимание` : "Внимание · есть признаки износа",
    };
  }
  if (status === "crit") {
    return {
      title: "АКБ — состояние аккумулятора",
      statusLabel,
      sourceText: "Состояние аккумулятора оценено по SOH тестера.",
      resultText: `Аккумулятор слабый. Возможны проблемы с запуском.${sohText}`,
      recommendationText: "Рекомендуем заменить аккумулятор, чтобы избежать проблем с запуском.",
      photoText: "",
      shortText: soh !== null ? `SOH ${soh}% · Критично` : "Критично · рекомендуется замена",
    };
  }
  if (status === "unchecked") {
    return {
      title: "АКБ — состояние аккумулятора",
      statusLabel,
      sourceText: "Состояние аккумулятора не проверено.",
      resultText: "Состояние аккумулятора не проверено.",
      recommendationText: "",
      photoText: "",
      shortText: "Состояние аккумулятора не проверено",
    };
  }
  if (soh === null && value) {
    return {
      title: "АКБ — состояние аккумулятора",
      statusLabel,
      sourceText: "Старый формат проверки АКБ.",
      resultText: "АКБ проверялась в старом формате. Статус сохранён без пересчёта по SOH.",
      recommendationText: "",
      photoText: "",
      shortText: "Старый формат проверки АКБ",
    };
  }
  return null;
}

function brakePadConclusion(front: number | null, rear: number | null): string {
  const frontStatus = axisStatusByPercent(front);
  const rearStatus = axisStatusByPercent(rear);
  if (frontStatus === "crit" && rearStatus === "crit") return "колодки требуют замены по обеим осям";
  if (frontStatus === "crit") return "передние колодки требуют замены в ближайшее время";
  if (rearStatus === "crit" || (rear !== null && rear <= 20)) return "задние колодки требуют замены в ближайшее время";
  if (frontStatus === "warn" && rearStatus === "warn") return "остаток приближается к минимальному по обеим осям";
  if (frontStatus === "warn") return "передние колодки требуют контроля";
  if (rearStatus === "warn") return "задние колодки требуют контроля";
  return "остаток в норме";
}

function brakeDiscPhrase(axis: "Передние" | "Задние", value?: string): string {
  const state = cleanText(value);
  const axisText = axis.toLowerCase();
  if (!state) return "";
  if (/без выраженной/iu.test(state)) return `${axisText} диски без выраженной выработки`;
  if (/небольшая/iu.test(state)) return `${axisText} диски с небольшой выработкой`;
  if (/выраженная|бурт/iu.test(state)) return `${axisText} диски с выраженной выработкой`;
  if (/борозды|канавки/iu.test(state)) return `${axisText} диски с бороздами на рабочей поверхности`;
  if (/перегрев|синеват/iu.test(state)) return `${axisText} диски со следами перегрева`;
  if (/корроз/iu.test(state)) return `${axisText} диски с коррозией рабочей поверхности`;
  if (/трещ/iu.test(state)) return `${axisText} диски с трещинами`;
  if (/биение|вибрац/iu.test(state)) return `${axisText} диски требуют проверки из-за биения`;
  if (/не удалось/iu.test(state)) return `${axisText} диски не удалось проверить`;
  return `${axisText} диски: ${lowerFirst(state)}`;
}

function wheelDepthStatus(value: number | null): DiagnosticMapStatusCode | null {
  if (value === null) return null;
  if (value >= 5) return "good";
  if (value >= 3) return "warn";
  return "crit";
}

function parseWheel(value?: string): { depth: number | null; damage: string } {
  const [depthPart = "", damagePart = ""] = cleanText(value).split("/").map((part) => part.trim());
  return { depth: numericValue(depthPart), damage: damagePart };
}

function formatDepth(value: number | null): string {
  if (value === null) return "не указано";
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} мм`;
}

function reportForBelts(value: string, comment: string, recommendation: string, status: DiagnosticMapStatusCode) {
  const condition = firstValuePart(value, "Состояние") || humanGenericValue(value);
  let result = comment;
  if (status === "good") result = "Ремень навесного оборудования без видимых трещин и повреждений";
  else if (/микротрещ/iu.test(condition)) result = "Ремень навесного оборудования имеет микротрещины — рекомендуем контроль";
  else if (/давно не менялся|по пробегу/iu.test(condition)) result = "Ремень давно не менялся по пробегу — рекомендуем плановую замену";
  else if (/масл/iu.test(condition)) result = "На ремне есть следы масла — рекомендуем проверить причину загрязнения";
  else if (/глубок|рассло|надрыв|износ дорожек|свист|шум/iu.test(condition)) result = "Ремень навесного оборудования имеет выраженные повреждения — рекомендуем замену";
  else if (status === "no-access") result = "Осмотр ремня затруднён без дополнительного доступа";
  return {
    resultText: sentence(result),
    recommendationText: recommendationSentence(recommendation, "Рекомендуем согласовать дальнейшие действия с мастером."),
    shortText: condition || status,
  };
}

function reportForLeaks(value: string, comment: string, recommendation: string, status: DiagnosticMapStatusCode) {
  const parts = valueParts(value);
  const leak = parts["Утечка"] || humanGenericValue(value);
  const place = locationPhrase(parts["Где"] ?? "");
  let result = comment;
  if (status === "good") result = "Следов утечек не обнаружено";
  else if (status === "no-access") result = "Осмотр на утечки затруднён без дополнительного доступа";
  else if (/запотев/iu.test(leak)) result = `Есть следы запотевания${place ? ` ${place}` : ""}. Рекомендуем контроль`;
  else if (/явная|капает|активная/iu.test(leak) || status === "crit") result = `Обнаружена утечка${place ? ` ${place}` : ""}. Рекомендуем диагностику источника`;
  return {
    resultText: sentence(result),
    recommendationText: recommendationSentence(recommendation, "Рекомендуем диагностику источника утечки."),
    shortText: status === "good" ? "утечки не обнаружены" : [leak, parts["Где"]].filter(Boolean).join(" · "),
  };
}

function reportForPads(value: string, recommendation: string) {
  const parts = valueParts(value);
  const front = numericValue(parts["Передние"]);
  const rear = numericValue(parts["Задние"]);
  const summary = `Передние ${formatPercent(front)}, задние ${formatPercent(rear)}`;
  const conclusion = brakePadConclusion(front, rear);
  const result = `${summary} — ${conclusion}`;
  return {
    resultText: sentence(result),
    recommendationText: recommendationSentence(recommendation, conclusion.includes("замены") ? "Рекомендуем согласовать замену колодок." : "Рекомендуем контроль на следующем визите."),
    shortText: result,
  };
}

function reportForBrakeDiscs(value: string, recommendation: string) {
  const parts = valueParts(value);
  const phrases = [brakeDiscPhrase("Передние", parts["Передние"]), brakeDiscPhrase("Задние", parts["Задние"])].filter(Boolean);
  const result = phrases.length ? `${phrases.join(". ")}.` : humanGenericValue(value);
  const fallback = /выраженная|бурт|борозд/iu.test(value)
    ? "Рекомендуем замер толщины дисков и возможную замену."
    : "Рекомендуем контроль дисков.";
  return {
    resultText: sentence(result),
    recommendationText: recommendationSentence(recommendation, fallback),
    shortText: phrases.length ? phrases.join("; ") : humanGenericValue(value),
  };
}

function reportForTires(value: string, recommendation: string) {
  const parts = valueParts(value);
  const wheels = [
    { key: "ПЛ", label: "Переднее левое", axle: "front" },
    { key: "ПП", label: "Переднее правое", axle: "front" },
    { key: "ЗЛ", label: "Заднее левое", axle: "rear" },
    { key: "ЗП", label: "Заднее правое", axle: "rear" },
  ] as const;
  const parsed = wheels.map((wheel) => ({ ...wheel, ...parseWheel(parts[wheel.key]) }));
  const summary = parsed.map((wheel) => `${wheel.label.toLowerCase()} ${formatDepth(wheel.depth)}`).join(", ");
  const frontStatuses = parsed.filter((wheel) => wheel.axle === "front").map((wheel) => wheelDepthStatus(wheel.depth));
  const rearStatuses = parsed.filter((wheel) => wheel.axle === "rear").map((wheel) => wheelDepthStatus(wheel.depth));
  const hasSevereDamage = parsed.find((wheel) => /грыжа|боковин|сильный порез/iu.test(wheel.damage));
  const hasUneven = parsed.find((wheel) => /неравномер|внутрен|внешн/iu.test(wheel.damage));
  let conclusion = "шины в норме";
  if (hasSevereDamage) conclusion = `${hasSevereDamage.label.toLowerCase()}: обнаружено повреждение, требуется замена шины`;
  else if (rearStatuses.includes("crit")) conclusion = "задняя ось требует замены";
  else if (frontStatuses.includes("crit")) conclusion = "передняя ось требует замены";
  else if (rearStatuses.includes("warn")) conclusion = "задняя ось требует внимания";
  else if (frontStatuses.includes("warn")) conclusion = "передняя ось требует внимания";
  else if (hasUneven) conclusion = "есть неравномерный износ, рекомендуется проверка сход-развала";
  const result = `${summary} — ${conclusion}`;
  return {
    resultText: sentence(result),
    recommendationText: recommendationSentence(recommendation, "Рекомендуем контроль шин."),
    shortText: result,
  };
}

function reportForSuspension(value: string, comment: string, recommendation: string, status: DiagnosticMapStatusCode) {
  const condition = firstValuePart(value, "Состояние") || humanGenericValue(value);
  let result = comment;
  if (status === "good") result = "Видимых повреждений подвески не обнаружено";
  else if (/разрыв сайлентблока/iu.test(condition)) result = "Обнаружен разрыв сайлентблока, рекомендуется замена";
  else if (/люфт/iu.test(condition)) result = "Есть люфт рычага, требуется дополнительная проверка";
  else if (/течь/iu.test(condition)) result = "Обнаружена течь амортизатора, требуется замена или диагностика";
  else if (/пыльник/iu.test(condition)) result = "Обнаружено повреждение пыльника, рекомендуется диагностика подвески";
  else if (status === "no-access") result = "Осмотр подвески затруднён без дополнительного доступа";
  return {
    resultText: sentence(result),
    recommendationText: recommendationSentence(recommendation, "Рекомендуем диагностику подвески."),
    shortText: condition || status,
  };
}

function buildItemSpecificText(input: DiagnosticReportTextInput, value: string, comment: string, recommendation: string): DiagnosticItemSpecificText | null {
  switch (input.code) {
    case "battery":
      return reportForBattery(value, input.status);
    case "belts":
      return reportForBelts(value, comment, recommendation, input.status);
    case "leaks":
      return reportForLeaks(value, comment, recommendation, input.status);
    case "pads":
      return reportForPads(value, recommendation);
    case "brake-discs":
      return reportForBrakeDiscs(value, recommendation);
    case "tires":
      return reportForTires(value, recommendation);
    case "suspension":
      return reportForSuspension(value, comment, recommendation, input.status);
    default:
      return null;
  }
}

export function buildDiagnosticReportText(input: DiagnosticReportTextInput): DiagnosticReportText {
  const status = DIAGNOSTIC_MAP_STATUSES[input.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
  const value = cleanText(input.value);
  const comment = cleanText(input.comment);
  const recommendation = cleanText(input.recommendation);
  const itemSpecific = buildItemSpecificText(input, value, comment, recommendation);
  const mileageText = input.mileage ? ` Пробег на момент диагностики: ${input.mileage.toLocaleString("ru-RU")} км.` : "";
  const humanValue = humanGenericValue(value);
  const valueText = humanValue ? ` Результат проверки: ${humanValue}.` : "";
  const commentText = comment ? ` Комментарий мастера: ${stripFinalDot(comment)}.` : "";
  const photoText =
    (input.photoCount ?? 0) > 0
      ? `Есть фото: ${input.photoCount} шт.`
      : input.status === "warn" || input.status === "crit"
        ? "Фото не добавлено, рекомендация основана на записи мастера."
        : "Фото не требовалось.";

	  return {
	    title: itemSpecific?.title ?? input.title,
	    statusLabel: itemSpecific?.statusLabel ?? status.label,
	    sourceText: itemSpecific?.sourceText ?? METHOD_TEXT[input.checkMethod] ?? status.clientText,
	    resultText: itemSpecific?.resultText ?? `${STATUS_TEXT[input.status] ?? status.clientText}${valueText}${commentText}${mileageText}`.trim(),
	    recommendationText: itemSpecific?.recommendationText ?? recommendationSentence(recommendation, STATUS_TEXT[input.status] || status.clientText),
	    photoText: itemSpecific?.photoText || photoText,
	    shortText: itemSpecific?.shortText ?? (humanValue || status.label),
	  };
}
