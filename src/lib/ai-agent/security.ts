import { ToolGuardrailFunctionOutputFactory, defineToolInputGuardrail, defineToolOutputGuardrail } from "@openai/agents";
import type { AIAgentRunContext } from "./types";

const SECRET_KEY_RE = /(buy|purchase|cost|margin|token|secret|password|api[_-]?key|credential)/i;
const PROMPT_INJECTION_RE = /(ignore|игнорируй|system prompt|системн(ый|ые) промпт|developer message|раскрой инструкции|покажи правила)/i;
const PRIVATE_DATA_RE = /(закупочн|себестоимост|марж|внутренн(ий|ие) комментар)/i;

export function maskPersonalData(text: string) {
  return text
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, (vin) => `${vin.slice(0, 3)}•••••••••••${vin.slice(-3)}`)
    .replace(/(?:\+?7|8)[\s()-]*\d{3}[\s()-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, "+7 ••• •••-••-••");
}

export function sanitizeForModel(value: unknown, depth = 0): unknown {
  if (depth > 7) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeForModel(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key)) continue;
      out[key] = sanitizeForModel(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.slice(0, 4_000);
  return value;
}

export function containsPromptInjection(text: string) {
  return PROMPT_INJECTION_RE.test(text);
}

export function assertSafeAgentOutput(text: string) {
  if (PRIVATE_DATA_RE.test(text)) throw new Error("Ответ содержит внутренние финансовые данные");
  if (/\b(resolve_vehicle_by_vin|resolve_vehicle_by_parameters|search_local_catalog|calculate_service_quote|handoff_to_human|rossko_search)\b/i.test(text)) {
    throw new Error("Ответ раскрывает техническое название инструмента");
  }
  if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(text.trim())) throw new Error("Клиенту нельзя отправлять технический JSON");
}

export const tenantToolInputGuardrail = defineToolInputGuardrail<AIAgentRunContext>({
  name: "organization_and_conversation_scope",
  run: async ({ context, toolCall }) => {
    if (!context.context?.organizationId || !context.context?.conversationId) {
      return ToolGuardrailFunctionOutputFactory.throwException({ reason: "missing tenant context" });
    }
    const raw = JSON.stringify(toolCall.arguments ?? "");
    if (PROMPT_INJECTION_RE.test(raw) || SECRET_KEY_RE.test(raw)) {
      return ToolGuardrailFunctionOutputFactory.rejectContent(
        "Параметры содержат недопустимую внутреннюю инструкцию. Используйте только данные клиента и автомобиля."
      );
    }
    return ToolGuardrailFunctionOutputFactory.allow();
  },
});

export const safeToolOutputGuardrail = defineToolOutputGuardrail<AIAgentRunContext>({
  name: "remove_internal_fields",
  run: async ({ output }) => {
    const sanitized = sanitizeForModel(output);
    if (JSON.stringify(sanitized).length > 60_000) {
      return ToolGuardrailFunctionOutputFactory.rejectContent("Результат слишком большой. Уточните запрос.");
    }
    return ToolGuardrailFunctionOutputFactory.allow({ sanitized: true });
  },
});
