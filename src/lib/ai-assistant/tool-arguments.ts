// Six services with their evidence, parts and vehicle snapshots fit within
// this common transport limit. Schema validation then checks each service.
export const MAX_TOOL_ARGUMENT_BYTES = 512 * 1024;
export const MAX_TOOL_ARGUMENT_DEPTH = 24;
export type ToolArgumentIssue = { path: string; code: string; received?: string | null; allowed?: readonly string[] };
export class ToolArgumentsError extends Error {
  constructor(public readonly code: string, message: string, public readonly issues: ToolArgumentIssue[] = []) { super(message); this.name = "ToolArgumentsError"; }
}
export const SERVICE_TYPE_ERROR_MESSAGE = "Помощник не смог определить вид работы для расчёта. Итоговая стоимость не рассчитана.";
export const QUOTE_INPUT_ERROR_MESSAGE = "Помощник передал некорректные данные для расчёта. Смета не сформирована.";

/** Also formats stored legacy Zod errors on read; never rewrites run history. */
export function assistantSchemaErrorMessage(error: unknown): string | null {
  if (error instanceof ToolArgumentsError && ["QUOTE_SERVICE_TYPE_INVALID", "QUOTE_INPUT_INVALID"].includes(error.code)) return error.message;
  const value = error instanceof Error ? error.message : error;
  if (typeof value !== "string" || value.length > MAX_TOOL_ARGUMENT_BYTES) return null;
  let issues: unknown;
  try { issues = JSON.parse(value); } catch { return null; }
  if (!Array.isArray(issues) || !issues.length || !issues.every(issue => issue && typeof issue === "object" && typeof issue.code === "string" && Array.isArray(issue.path))) return null;
  return issues.some(issue => issue.path.join(".") === "service.type") ? SERVICE_TYPE_ERROR_MESSAGE : QUOTE_INPUT_ERROR_MESSAGE;
}
export function parseAssistantToolArguments(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "string") throw new ToolArgumentsError("TOOL_ARGUMENTS_NOT_JSON", "Аргументы инструмента должны быть JSON-строкой");
  if (Buffer.byteLength(payload, "utf8") > MAX_TOOL_ARGUMENT_BYTES) throw new ToolArgumentsError("TOOL_ARGUMENTS_TOO_LARGE", `Размер аргументов превышает ${MAX_TOOL_ARGUMENT_BYTES} байт`);
  // Inspect nesting before JSON.parse, respecting escaped quotes.
  let depth = 0, quoted = false, escaped = false;
  for (const char of payload) {
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === "[" || char === "{") { if (++depth > MAX_TOOL_ARGUMENT_DEPTH) throw new ToolArgumentsError("TOOL_ARGUMENTS_TOO_DEEP", `Вложенность превышает ${MAX_TOOL_ARGUMENT_DEPTH}`); }
    else if (char === "]" || char === "}") depth--;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { throw new ToolArgumentsError("TOOL_ARGUMENTS_INVALID_JSON", "Некорректный JSON; передайте полный объект аргументов"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ToolArgumentsError("TOOL_ARGUMENTS_OBJECT_REQUIRED", "Нужен объект аргументов, не массив или null");
  const scan = (value: unknown) => { if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { if (["__proto__", "constructor", "prototype"].includes(key)) throw new ToolArgumentsError("TOOL_ARGUMENTS_UNSAFE_KEY", "Недопустимый ключ объекта"); scan(child); } };
  scan(parsed);
  return parsed as Record<string, unknown>;
}

/** Runtime validation for the same JSON-schema contract exposed to the model. */
export function validateAssistantToolArguments(value: unknown, schema: Record<string, unknown>, path = "$", depth = 0): void {
  if (depth > MAX_TOOL_ARGUMENT_DEPTH) throw new ToolArgumentsError("TOOL_ARGUMENTS_TOO_DEEP", `${path}: превышена вложенность`);
  const fail = (detail: string): never => { throw new ToolArgumentsError("TOOL_SCHEMA_INVALID", `${path}: ${detail}`); };
  const variants = schema.anyOf as Array<Record<string, unknown>> | undefined;
  if (variants) { for (const variant of variants) { try { validateAssistantToolArguments(value, variant, path, depth + 1); return; } catch { /* Try the next allowed schema. */ } } fail("значение не соответствует ни одному допустимому типу"); }
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.includes(type) && !(types.includes("integer") && typeof value === "number" && Number.isInteger(value))) fail(`ожидается ${types.join(" | ")}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail("недопустимое значение enum");
  if (typeof value === "string" && ((typeof schema.maxLength === "number" && value.length > schema.maxLength) || (typeof schema.minLength === "number" && value.length < schema.minLength))) fail("длина строки вне допустимого диапазона");
  if (typeof value === "number" && (!Number.isFinite(value) || (typeof schema.maximum === "number" && value > schema.maximum) || (typeof schema.minimum === "number" && value < schema.minimum))) fail("число вне допустимого диапазона");
  if (Array.isArray(value)) {
    if ((typeof schema.maxItems === "number" && value.length > schema.maxItems) || (typeof schema.minItems === "number" && value.length < schema.minItems)) fail("число элементов вне допустимого диапазона");
    if (schema.items) value.forEach((item, index) => validateAssistantToolArguments(item, schema.items as Record<string, unknown>, `${path}[${index}]`, depth + 1));
  } else if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const key of Array.isArray(schema.required) ? schema.required as string[] : []) if (!Object.hasOwn(row, key)) fail(`отсутствует обязательное поле ${key}`);
    for (const [key, item] of Object.entries(row)) {
      if (properties[key]) validateAssistantToolArguments(item, properties[key], `${path}.${key}`, depth + 1);
      else if (schema.additionalProperties === false) fail(`неизвестное поле ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validateAssistantToolArguments(item, schema.additionalProperties as Record<string, unknown>, `${path}.${key}`, depth + 1);
    }
  }
}
