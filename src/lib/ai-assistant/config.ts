export const DEFAULT_ADMIN_ASSISTANT_MODEL = "gpt-5.6-terra";

export function adminAssistantConfig() {
  const configuredReasoning = process.env.OPENAI_ADMIN_ASSISTANT_REASONING?.trim().toLowerCase() || "max";
  const reasoning = ["none", "low", "medium", "high", "xhigh", "max"].includes(configuredReasoning) ? configuredReasoning : "max";
  return {
    model: process.env.OPENAI_ADMIN_ASSISTANT_MODEL?.trim() || DEFAULT_ADMIN_ASSISTANT_MODEL,
    reasoning,
    deepReasoning: process.env.OPENAI_ADMIN_ASSISTANT_DEEP_REASONING?.trim().toLowerCase() || "ultra",
    enabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}
