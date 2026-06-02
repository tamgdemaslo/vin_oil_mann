import {
  DIAGNOSTIC_MAP_STATUSES,
  type DiagnosticMapCheckMethod,
  type DiagnosticMapStatusCode,
} from "@/data/diagnostic-map";

export type DiagnosticReportTextInput = {
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
};

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

export function buildDiagnosticReportText(input: DiagnosticReportTextInput): DiagnosticReportText {
  const status = DIAGNOSTIC_MAP_STATUSES[input.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
  const value = cleanText(input.value);
  const comment = cleanText(input.comment);
  const recommendation = cleanText(input.recommendation);
  const mileageText = input.mileage ? ` Пробег на момент диагностики: ${input.mileage.toLocaleString("ru-RU")} км.` : "";
  const valueText = value ? ` Зафиксировано: ${value}.` : "";
  const commentText = comment ? ` Комментарий мастера: ${comment}.` : "";
  const photoText =
    (input.photoCount ?? 0) > 0
      ? `Есть фото: ${input.photoCount} шт.`
      : input.status === "warn" || input.status === "crit"
        ? "Фото не добавлено, рекомендация основана на записи мастера."
        : "Фото не требовалось.";

  return {
    title: input.title,
    statusLabel: status.label,
    sourceText: METHOD_TEXT[input.checkMethod] ?? status.clientText,
    resultText: `${STATUS_TEXT[input.status] ?? status.clientText}${valueText}${commentText}${mileageText}`.trim(),
    recommendationText: recommendation || STATUS_TEXT[input.status] || status.clientText,
    photoText,
  };
}
