import OpenAI from "openai";
import { ProxyAgent } from "undici";

let proxyAgent: ProxyAgent | null | undefined;

function openAIProxyAgent(): ProxyAgent | undefined {
  const proxyUrl = process.env.OPENAI_PROXY_URL?.trim();
  if (!proxyUrl) return undefined;
  proxyAgent ??= new ProxyAgent(proxyUrl);
  return proxyAgent;
}

/**
 * All application OpenAI clients go through this factory. In production,
 * OPENAI_PROXY_URL points at the WireGuard-only HTTP CONNECT proxy; without it
 * the SDK keeps its normal direct behaviour for local development.
 */
export function createOpenAIClient(apiKey: string, options?: { timeout?: number; maxRetries?: number }): OpenAI {
  const dispatcher = openAIProxyAgent();
  return new OpenAI({
    apiKey,
    ...options,
    ...(dispatcher ? { fetchOptions: { dispatcher } } : {}),
  });
}
