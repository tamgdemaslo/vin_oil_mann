// Aggregation consumes private rows in memory and emits only non-identifying
// metrics. Missing instrumentation remains null, never an inferred zero.
const percentile = (values: number[], p: number) => { const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b); return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null; };
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(obj) : [];
export type AssistantRunSample = { id: string; status: string; model: string; startedAt: Date | string; completedAt?: Date | string | null; durationMs: number | null; inputTokens: number | null; outputTokens: number | null; toolSummaryJson: unknown; tools: Array<{ toolName: string; status: string; durationMs: number | null; argumentsJson: unknown; createdAt?: Date | string }>; quotes: Array<{ createdAt: Date | string; baseTotalCents: number }>; messages: Array<{ attachmentsJson: unknown }> };
export function summarizeAssistantRuns(runs: AssistantRunSample[], metadata: { asOf: string; since: string; availableInWindow: number; limit: number; source: string }) {
  const totalDurations = runs.filter(run => run.status === "completed" && run.completedAt && run.durationMs != null).map(run => run.durationMs!);
  const usefulDurations: number[] = [];
  const stages: Record<string, number[]> = {};
  const errors: Record<string, number> = {};
  const statuses: Record<string, number> = {};
  let knownQuoteRuns = 0, completeQuoteRuns = 0, subtotalQuoteRuns = 0, arithmeticFailures = 0, auditedOptions = 0, repeatedToolCalls = 0;
  for (const run of runs) {
    statuses[run.status] = (statuses[run.status] ?? 0) + 1;
    const quotes = run.quotes.filter(quote => Number.isInteger(quote.baseTotalCents) && quote.baseTotalCents >= 0);
    if (quotes.length) usefulDurations.push(Math.max(0, Math.min(...quotes.map(quote => new Date(quote.createdAt).getTime())) - new Date(run.startedAt).getTime()));
    const artifacts = run.messages.flatMap(message => { const artifact = obj(obj(message.attachmentsJson).quoteAndTechCard); return artifact.scenario === "quote_and_tech_card_bundle" ? list(artifact.results) : artifact.scenario === "quote_and_tech_card" ? [artifact] : []; });
    let known = quotes.length > 0;
    let complete = false, subtotal = false;
    for (const artifact of artifacts) for (const option of list(obj(artifact.quoteSet).options)) {
      if (typeof option.totalCents !== "number") continue;
      known = true; auditedOptions++;
      if (option.priceCompleteness === "complete") complete = true;
      if (option.priceCompleteness === "subtotal") subtotal = true;
      if (list(option.lines).reduce((sum,line) => sum + (typeof line.totalCents === "number" ? line.totalCents : 0),0) !== option.totalCents) arithmeticFailures++;
    }
    if (known) knownQuoteRuns++;
    if (complete) completeQuoteRuns++;
    if (subtotal) subtotalQuoteRuns++;
    const seen = new Set<string>();
    for (const tool of run.tools) {
      if (tool.durationMs != null) (stages[tool.toolName] ??= []).push(tool.durationMs);
      if (tool.status === "failed") errors[tool.toolName] = (errors[tool.toolName] ?? 0) + 1;
      const key = `${tool.toolName}:${JSON.stringify(tool.argumentsJson)}`;
      if (seen.has(key)) repeatedToolCalls++;
      seen.add(key);
    }
  }
  const summaries = runs.flatMap(run => list(run.toolSummaryJson));
  const modelCalls = summaries.filter(row => row.toolName === "model_request");
  const providerCalls = summaries.filter(row => row.toolName === "provider_request");
  const fullyInstrumented = runs.length > 0 && runs.every(run => list(run.toolSummaryJson).some(row => row.toolName === "assistant_instrumentation" && row.version === 1));
  const pricedTokens = modelCalls.length > 0 && modelCalls.every(row => row.status === "completed" && row.model === "gpt-5.6-terra" && typeof row.inputTokens === "number" && typeof row.cachedInputTokens === "number" && typeof row.outputTokens === "number");
  const modelTokenCostUsd = pricedTokens ? modelCalls.reduce((sum,row) => sum + ((Number(row.inputTokens) - Number(row.cachedInputTokens)) * 2 + Number(row.cachedInputTokens) * .2 + Number(row.outputTokens) * 12)/1_000_000, 0) : fullyInstrumented && modelCalls.length === 0 ? 0 : null;
  return {
    ...metadata, sampledRuns: runs.length, coverage: { completeWindow: metadata.availableInWindow <= runs.length, fraction: metadata.availableInWindow ? runs.length / metadata.availableInWindow : null }, statuses,
    fullResponseMs: { p50: percentile(totalDurations, .5), p95: percentile(totalDurations, .95), measuredRuns: totalDurations.length },
    firstPersistedQuoteMs: { p50: percentile(usefulDurations, .5), p95: percentile(usefulDurations, .95), measuredRuns: usefulDurations.length, limitation: "Snapshot creation time; historical UI delivery time is not recorded" },
    stages: Object.fromEntries(Object.entries(stages).map(([name,values]) => [name,{calls:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95)}])),
    repeatedIdenticalToolCalls: repeatedToolCalls, failedTools: errors,
    knownQuoteRuns, knownQuoteRunFraction: runs.length ? knownQuoteRuns/runs.length : null,
    completeQuoteRuns, completeQuoteRunFraction: runs.length ? completeQuoteRuns/runs.length : null, subtotalQuoteRuns,
    quoteCompletenessLimitation: "Known amounts include subtotals; completeness requires explicit QuoteSet metadata, unavailable for legacy snapshots",
    arithmeticChecks: { options: auditedOptions, failures: arithmeticFailures },
    dangerousTechnicalErrorFraction: null, dangerousTechnicalErrorLimitation: "Requires adjudicated applicable technical sources; completed status is not a safety label",
    modelRequestCount: fullyInstrumented ? modelCalls.length : null, providerRequestCount: fullyInstrumented ? providerCalls.length : null,
    instrumentedModelRequests: modelCalls.length, instrumentedProviderRequests: providerCalls.length,
    modelTokenCostUsd, pricingAsOf: modelTokenCostUsd == null ? null : "2026-09-09", pricingSource: modelTokenCostUsd == null ? null : "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
    costUsd: null, costLimitation: "Historical cached-token, model-version and built-in-tool usage must be known before applying a dated price tariff",
  };
}
