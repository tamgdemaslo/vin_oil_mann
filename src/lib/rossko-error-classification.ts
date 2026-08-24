export type RosskoRuntimeFailureCode =
  | "DATABASE_TEMPORARILY_UNAVAILABLE"
  | "ROSSKO_AUTH_FAILED"
  | "ROSSKO_TEMPORARILY_UNAVAILABLE"
  | "ROSSKO_SEARCH_FAILED";

type FailureOperation = "search" | "check" | "request";

type RuntimeErrorShape = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  cause?: unknown;
};

function record(value: unknown): RuntimeErrorShape {
  return value && typeof value === "object" ? value as RuntimeErrorShape : {};
}

function directMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  const value = record(error);
  return typeof value.message === "string" ? value.message : String(error);
}

function errorChain(error: unknown) {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current) && chain.length < 4) {
    chain.push(current);
    seen.add(current);
    current = record(current).cause;
  }
  return chain;
}

function rawMessage(error: unknown) {
  return errorChain(error).map(directMessage).join(" · ");
}

function runtimeCodes(error: unknown) {
  return errorChain(error).map((item) => {
    const value = record(item);
    return typeof value.code === "string" ? value.code.toUpperCase() : "";
  }).filter(Boolean);
}

function runtimeCode(error: unknown) {
  const value = record(error);
  return typeof value.code === "string" ? value.code.toUpperCase() : "";
}

export function isDatabaseAvailabilityError(error: unknown) {
  if (runtimeCodes(error).some((code) => ["P1001", "P1002", "P1017", "P2024", "57P01", "57P03", "57P05"].includes(code))) return true;
  const message = rawMessage(error).toLowerCase();
  return /timed out fetching a new connection|connection pool|can't reach database server|server has closed the connection|terminating connection|database system is (?:starting|shutting down)|too many connections/.test(message);
}

export function isRosskoAuthenticationError(error: unknown) {
  return /(auth|authoriz|ключ|key1|key2|access denied|forbidden|\b401\b|\b403\b)/i.test(rawMessage(error));
}

export function isRosskoTransportError(error: unknown) {
  if (runtimeCodes(error).some((code) => ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code))) return true;
  return /(timed?\s*out|timeout|socket hang up|network|fetch failed|getaddrinfo|econnreset|econnrefused|eai_again|enotfound|service unavailable|bad gateway|gateway timeout|\b502\b|\b503\b|\b504\b)/i.test(rawMessage(error));
}

/** Keep diagnostics useful in server logs and trace without retaining credentials. */
export function safeRosskoDiagnostic(error: unknown) {
  const diagnostic = errorChain(error).map((item) => {
    const code = runtimeCode(item);
    const name = item instanceof Error ? item.name : typeof record(item).name === "string" ? String(record(item).name) : "Error";
    return [name, code, directMessage(item)].filter(Boolean).join(" · ");
  }).join(" ← ")
    .replace(/(postgres(?:ql)?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1[redacted]@")
    .replace(/\b(KEY1|KEY2|TOKEN|PASSWORD|SECRET)\b\s*[:=]\s*[^\s,;}&]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  return diagnostic || "Unknown error";
}

function action(operation: FailureOperation) {
  if (operation === "check") return "проверить подключение к ROSSKO";
  if (operation === "request") return "выполнить запрос к ROSSKO";
  return "выполнить поиск в ROSSKO";
}

function operationLabel(operation: FailureOperation) {
  if (operation === "check") return "проверка подключения";
  if (operation === "request") return "запрос";
  return "поиск";
}

export function classifyRosskoRuntimeFailure(
  error: unknown,
  options: { operation?: FailureOperation; providerError?: boolean } = {},
): { code: RosskoRuntimeFailureCode; publicMessage: string; diagnosticMessage: string } {
  const operation = options.operation ?? "search";
  const diagnosticMessage = safeRosskoDiagnostic(error);
  if (isDatabaseAvailabilityError(error)) {
    return {
      code: "DATABASE_TEMPORARILY_UNAVAILABLE",
      publicMessage: `База данных временно перегружена: не удалось ${action(operation)}. Повторите попытку.`,
      diagnosticMessage,
    };
  }
  if (isRosskoAuthenticationError(error)) {
    return {
      code: "ROSSKO_AUTH_FAILED",
      publicMessage: "ROSSKO не принял ключи выбранного филиала. Проверьте подключение в Кабинете → Интеграции.",
      diagnosticMessage,
    };
  }
  if (isRosskoTransportError(error)) {
    return {
      code: "ROSSKO_TEMPORARILY_UNAVAILABLE",
      publicMessage: `Не удалось связаться с API ROSSKO и ${action(operation)}. Повторите попытку позже.`,
      diagnosticMessage,
    };
  }
  return {
    code: "ROSSKO_SEARCH_FAILED",
    publicMessage: options.providerError
      ? `ROSSKO не обработал запрос (${operationLabel(operation)}). Техническая причина сохранена в trace.`
      : `Внутренняя ошибка прервала ${operationLabel(operation)} ROSSKO. Техническая причина сохранена в trace.`,
    diagnosticMessage,
  };
}
