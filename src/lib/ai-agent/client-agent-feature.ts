/**
 * Client-facing automation is deliberately disabled while the internal
 * assistant is introduced. An absent variable must never be treated as
 * consent to send or prepare a response for a customer.
 */
export function isClientAIAgentEnabled() {
  return process.env.CLIENT_AI_AGENT_ENABLED?.trim().toLowerCase() === "true";
}

export function clientAIAgentDisabledError() {
  return "Клиентский ИИ-агент отключён. Используйте внутренний раздел «ИИ-помощник».";
}
