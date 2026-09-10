import { AsyncLocalStorage } from "node:async_hooks";

export class AssistantBoundaryError extends Error {
  constructor(public readonly code: "RUN_TIMEOUT" | "RUN_CANCELLED" | "RUN_INTERRUPTED", message: string) { super(message); }
}
export type AssistantExecution = {
  deadline: number;
  controller: AbortController;
  cache: Map<string, Promise<unknown>>;
  events: Array<Record<string, unknown>>;
  partialResults: Array<{ toolName: string; result: unknown }>;
};
const storage = new AsyncLocalStorage<AssistantExecution>();
export const assistantExecution = () => storage.getStore();
export const assistantSignal = () => assistantExecution()?.controller.signal;
export function assistantRemainingMs(fallback = 240_000) {
  const execution = assistantExecution();
  return execution ? Math.max(1, execution.deadline - Date.now()) : fallback;
}
export async function withAssistantExecution<T>(durationMs: number, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  if (assistantExecution()) return work();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason instanceof AssistantBoundaryError
    ? signal.reason
    : new AssistantBoundaryError("RUN_INTERRUPTED", "Выполнение запроса прервано; команда отмены сотрудником не получена"));
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new AssistantBoundaryError("RUN_TIMEOUT", "Общий срок выполнения запроса истёк")), durationMs);
  try { return await storage.run({ deadline: Date.now() + durationMs, controller, cache: new Map(), partialResults: [], events: [{ toolName: "assistant_instrumentation", version: 1 }] }, work); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}
export async function withinAssistantDeadline<T>(work: () => Promise<T>): Promise<T> {
  const signal = assistantSignal();
  if (!signal) return work();
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([work(), cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${stable(v)}`).join(",")}`;
  return JSON.stringify(value) ?? "null";
}
export async function assistantMemo<T>(scope: string, input: unknown, work: () => Promise<T>): Promise<T> {
  const execution = assistantExecution();
  if (!execution) return work();
  execution.controller.signal.throwIfAborted();
  const key = `${scope}:${stable(input)}`;
  if (!execution.cache.has(key)) execution.cache.set(key, withinAssistantDeadline(work));
  return execution.cache.get(key) as Promise<T>;
}
export async function assistantMap<T, R>(items: T[], work: (item: T, index: number) => Promise<R>, concurrency = 3): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await work(items[index], index); }
  }));
  return result;
}

export function assistantEvent(event: Record<string, unknown>) { assistantExecution()?.events.push({ ...event, at: new Date().toISOString() }); }
