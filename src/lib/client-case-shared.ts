export const CLIENT_CASE_STATUS_ORDER = [
  "calculation_needed",
  "calculation_sent",
  "check_response",
  "client_replied",
  "waiting_parts",
  "parts_arrived",
  "postponed",
  "cancelled",
  "duplicate",
  "closed",
] as const;

export type ClientCaseStatus = (typeof CLIENT_CASE_STATUS_ORDER)[number];

export type ClientCaseAction =
  | "calculate"
  | "mark_calculation_sent"
  | "check_response"
  | "client_replied"
  | "client_agreed"
  | "waiting_parts"
  | "parts_arrived"
  | "create_appointment"
  | "create_shipment"
  | "postpone"
  | "close"
  | "refused"
  | "duplicate";

export const CLIENT_CASE_STATUS_META: Record<
  ClientCaseStatus,
  { label: string; shortLabel: string; tone: "neutral" | "rust" | "success" | "warning" | "danger" | "info"; rank: number }
> = {
  calculation_needed: { label: "Нужно рассчитать", shortLabel: "Рассчитать", tone: "rust", rank: 30 },
  calculation_sent: { label: "Расчёт отправлен", shortLabel: "Отправлен", tone: "info", rank: 50 },
  check_response: { label: "Проверить ответ", shortLabel: "Проверить", tone: "warning", rank: 20 },
  client_replied: { label: "Клиент ответил", shortLabel: "Есть ответ", tone: "success", rank: 10 },
  waiting_parts: { label: "Ожидает запчасти", shortLabel: "Ждём запчасти", tone: "warning", rank: 40 },
  parts_arrived: { label: "Запчасти пришли", shortLabel: "Пришли", tone: "success", rank: 15 },
  postponed: { label: "Отложено", shortLabel: "Отложено", tone: "neutral", rank: 90 },
  cancelled: { label: "Клиент отказался", shortLabel: "Отказ", tone: "danger", rank: 120 },
  duplicate: { label: "Дубль", shortLabel: "Дубль", tone: "neutral", rank: 130 },
  closed: { label: "Закрыто", shortLabel: "Закрыто", tone: "success", rank: 140 },
};

const STATUS_WORDS: Array<[ClientCaseStatus, string[]]> = [
  ["calculation_sent", ["расчет отправлен", "расчёт отправлен", "отправлен"]],
  ["check_response", ["проверить ответ", "контроль ответа"]],
  ["client_replied", ["клиент ответил", "есть ответ", "ответил"]],
  ["waiting_parts", ["ожидает запчаст", "ждем запчаст", "ждём запчаст", "ожидает расход", "ждем расход", "ждём расход"]],
  ["parts_arrived", ["запчасти пришли", "расходники пришли"]],
  ["postponed", ["отлож"]],
  ["cancelled", ["отказ"]],
  ["duplicate", ["дубль"]],
  ["closed", ["закры", "архив", "выполн"]],
  ["calculation_needed", ["нужно рассчитать", "рассчитать", "новый запрос", "разобрать"]],
];

export function normalizeCaseText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/ё/g, "е");
}

export function isClientCaseStatus(value: unknown): value is ClientCaseStatus {
  return typeof value === "string" && (CLIENT_CASE_STATUS_ORDER as readonly string[]).includes(value);
}

export function caseStatusFromStageName(stageName?: string | null): ClientCaseStatus {
  const normalized = normalizeCaseText(stageName);
  for (const [status, words] of STATUS_WORDS) {
    if (words.some((word) => normalized.includes(word.replace(/ё/g, "е")))) return status;
  }
  return "calculation_needed";
}

export function normalizeClientCaseStatus(value: unknown, stageName?: string | null): ClientCaseStatus {
  return isClientCaseStatus(value) ? value : caseStatusFromStageName(stageName);
}

export function clientCaseStatusLabel(status: unknown, stageName?: string | null) {
  return CLIENT_CASE_STATUS_META[normalizeClientCaseStatus(status, stageName)].label;
}

export function defaultNextActionForCaseStatus(status: unknown, stageName?: string | null) {
  const normalized = normalizeClientCaseStatus(status, stageName);
  if (normalized === "calculation_needed") return "Подготовить расчёт";
  if (normalized === "calculation_sent") return "Проверить ответ клиента";
  if (normalized === "check_response") return "Написать клиенту";
  if (normalized === "client_replied") return "Открыть диалог";
  if (normalized === "waiting_parts") return "Ждать поставку запчастей";
  if (normalized === "parts_arrived") return "Сообщить клиенту, запчасти пришли";
  if (normalized === "postponed") return "Вернуться к делу позже";
  if (normalized === "cancelled") return "Клиент отказался";
  if (normalized === "duplicate") return "Дубль";
  return "Закрыто";
}

export function primaryActionForCaseStatus(status: unknown, stageName?: string | null): { action: ClientCaseAction; label: string } {
  const normalized = normalizeClientCaseStatus(status, stageName);
  if (normalized === "calculation_needed") return { action: "calculate", label: "Рассчитать" };
  if (normalized === "calculation_sent") return { action: "check_response", label: "Проверить ответ" };
  if (normalized === "check_response") return { action: "check_response", label: "Написать клиенту" };
  if (normalized === "client_replied") return { action: "client_agreed", label: "Клиент согласовал" };
  if (normalized === "waiting_parts") return { action: "parts_arrived", label: "Запчасти пришли" };
  if (normalized === "parts_arrived") return { action: "create_appointment", label: "Создать запись" };
  if (normalized === "postponed") return { action: "check_response", label: "Вернуть в работу" };
  return { action: "close", label: "Закрыть" };
}

export function isClientCaseClosedStatus(status: unknown, stageName?: string | null) {
  const normalized = normalizeClientCaseStatus(status, stageName);
  return normalized === "closed" || normalized === "cancelled" || normalized === "duplicate";
}
