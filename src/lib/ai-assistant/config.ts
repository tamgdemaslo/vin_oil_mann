export const DEFAULT_ADMIN_ASSISTANT_MODEL = "gpt-5.6-terra";

export function adminAssistantConfig() {
  const configuredReasoning = process.env.OPENAI_ADMIN_ASSISTANT_REASONING?.trim().toLowerCase() || "max";
  const reasoning = ["none", "low", "medium", "high", "xhigh", "max"].includes(configuredReasoning) ? configuredReasoning : "max";
  const configuredTimeoutMs = Number(process.env.OPENAI_ADMIN_ASSISTANT_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(configuredTimeoutMs) && configuredTimeoutMs >= 10_000 && configuredTimeoutMs <= 120_000 ? configuredTimeoutMs : 120_000;
  return {
    model: process.env.OPENAI_ADMIN_ASSISTANT_MODEL?.trim() || DEFAULT_ADMIN_ASSISTANT_MODEL,
    reasoning,
    deepReasoning: process.env.OPENAI_ADMIN_ASSISTANT_DEEP_REASONING?.trim().toLowerCase() || "ultra",
    enabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
    timeoutMs,
  };
}
