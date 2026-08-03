export type AIAssistantRecommendation = {
  title: string;
  detail: string;
  priority: "normal" | "important";
};

export type AIAssistantStructuredResponse = {
  summaryMarkdown: string;
  confirmed: string[];
  assumptions: string[];
  requiresVerification: string[];
  recommendations: AIAssistantRecommendation[];
  clientMessage: string | null;
};

export const AI_ASSISTANT_STRUCTURED_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summaryMarkdown", "confirmed", "assumptions", "requiresVerification", "recommendations", "clientMessage"],
  properties: {
    summaryMarkdown: { type: "string", maxLength: 4000 },
    confirmed: { type: "array", maxItems: 12, items: { type: "string", maxLength: 360 } },
    assumptions: { type: "array", maxItems: 12, items: { type: "string", maxLength: 360 } },
    requiresVerification: { type: "array", maxItems: 12, items: { type: "string", maxLength: 360 } },
    recommendations: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "priority"],
        properties: {
          title: { type: "string", maxLength: 160 },
          detail: { type: "string", maxLength: 500 },
          priority: { type: "string", enum: ["normal", "important"] },
        },
      },
    },
    clientMessage: { type: ["string", "null"], maxLength: 3000 },
  },
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => clean(item, 360)).filter(Boolean).slice(0, 12) : [];
}

export function parseAIAssistantStructuredResponse(value: unknown): AIAssistantStructuredResponse | null {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { return null; }
  }
  const input = record(source);
  const summaryMarkdown = clean(input.summaryMarkdown, 4000);
  const recommendations = Array.isArray(input.recommendations)
    ? input.recommendations.map((item) => {
        const recommendation = record(item);
        const title = clean(recommendation.title, 160);
        const detail = clean(recommendation.detail, 500);
        if (!title || !detail) return null;
        return { title, detail, priority: recommendation.priority === "important" ? "important" as const : "normal" as const };
      }).filter((item): item is AIAssistantRecommendation => Boolean(item)).slice(0, 8)
    : [];
  const clientMessage = input.clientMessage == null ? null : clean(input.clientMessage, 3000) || null;
  if (!summaryMarkdown && !recommendations.length && !clientMessage && !stringList(input.confirmed).length && !stringList(input.assumptions).length && !stringList(input.requiresVerification).length) return null;
  return {
    summaryMarkdown,
    confirmed: stringList(input.confirmed),
    assumptions: stringList(input.assumptions),
    requiresVerification: stringList(input.requiresVerification),
    recommendations,
    clientMessage,
  };
}

export function structuredResponseToMarkdown(value: AIAssistantStructuredResponse) {
  const sections = [value.summaryMarkdown];
  if (value.confirmed.length) sections.push(`## Подтверждено\n\n${value.confirmed.map((item) => `- ${item}`).join("\n")}`);
  if (value.assumptions.length) sections.push(`## Рабочие допущения\n\n${value.assumptions.map((item) => `- ${item}`).join("\n")}`);
  if (value.requiresVerification.length) sections.push(`## Проверить перед работой\n\n${value.requiresVerification.map((item) => `- ${item}`).join("\n")}`);
  if (value.recommendations.length) sections.push(`## Рекомендации\n\n${value.recommendations.map((item) => `- **${item.title}:** ${item.detail}`).join("\n")}`);
  if (value.clientMessage) sections.push(`## Сообщение клиенту\n\n${value.clientMessage}`);
  return sections.filter(Boolean).join("\n\n");
}
