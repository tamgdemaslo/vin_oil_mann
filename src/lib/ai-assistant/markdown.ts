const OPENAI_CITATION_TOKEN = /\uE200cite\uE202[^\uE201]*\uE201/gu;

/**
 * OpenAI can place private-use citation markers directly in response text.
 * Sources are stored separately, so these transport markers must never reach
 * the assistant's readable Markdown.
 */
export function cleanAssistantMarkdown(value: string) {
  return value
    .replace(OPENAI_CITATION_TOKEN, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
