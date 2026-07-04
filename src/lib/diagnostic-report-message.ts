export type DiagnosticReportMessageInput = {
  clientName?: string | null;
  car?: string | null;
  reportUrl?: string | null;
  checkedCount?: number | null;
  recommendationCount?: number | null;
  criticalCount?: number | null;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function nonNegativeCount(value: unknown, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.trunc(number));
}

export function pluralRu(count: number, one: string, few: string, many: string) {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function diagnosticRecommendationText(count: unknown) {
  const value = nonNegativeCount(count);
  if (value === 0) return "Рекомендаций нет.";
  return `Есть ${value} ${pluralRu(value, "рекомендация", "рекомендации", "рекомендаций")}.`;
}

export function diagnosticCriticalText(count: unknown) {
  const value = nonNegativeCount(count);
  if (value === 0) return "Критичных замечаний нет.";
  return `Есть ${value} ${pluralRu(value, "критичное замечание", "критичных замечания", "критичных замечаний")}.`;
}

export function diagnosticCheckedText(count: unknown) {
  const value = nonNegativeCount(count);
  return `Проверено ${value} ${pluralRu(value, "пункт", "пункта", "пунктов")}.`;
}

export function diagnosticPreviewDescription(input: Pick<DiagnosticReportMessageInput, "checkedCount" | "recommendationCount" | "criticalCount">) {
  const checkedCount = nonNegativeCount(input.checkedCount);
  const recommendationCount = nonNegativeCount(input.recommendationCount);
  const criticalCount = nonNegativeCount(input.criticalCount);
  if (recommendationCount === 0 && criticalCount === 0) {
    return `${diagnosticCheckedText(checkedCount)} Критичных замечаний и рекомендаций нет.`;
  }
  return [diagnosticCheckedText(checkedCount), diagnosticRecommendationText(recommendationCount), diagnosticCriticalText(criticalCount)].join(" ");
}

export function buildDiagnosticReportMessage(input: DiagnosticReportMessageInput, options: { includeLink?: boolean } = {}) {
  const clientName = cleanText(input.clientName);
  const car = cleanText(input.car) || "вашего автомобиля";
  const lines = [
    `${clientName ? `${clientName}, ` : ""}диагностика ${car} готова.`,
    "",
    diagnosticCheckedText(input.checkedCount),
    diagnosticRecommendationText(input.recommendationCount),
    diagnosticCriticalText(input.criticalCount),
  ];
  const reportUrl = cleanText(input.reportUrl);
  if (options.includeLink !== false && reportUrl) {
    lines.push("", `Открыть отчёт: ${reportUrl}`);
  }
  return lines.join("\n").trim();
}

export function stripDiagnosticReportLink(text: string, reportUrl?: string | null) {
  const url = cleanText(reportUrl);
  return text
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (url && trimmed === url) return false;
      if (url && trimmed === `Открыть отчёт: ${url}`) return false;
      return !/^Открыть отч[её]т:\s*https?:\/\//iu.test(trimmed);
    })
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
