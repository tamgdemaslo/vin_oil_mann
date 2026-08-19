import { runForActiveBranches } from "@/lib/branch-workers";
import { processProductOemJobsForBranch } from "@/lib/product-oem-batches";
import { inProcessBackgroundWorkersEnabled } from "@/lib/background-worker-policy";

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_IDLE_INTERVAL_MS = 60_000;
const DEFAULT_ERROR_BACKOFF_MS = 30_000;
const DEFAULT_MAX_ERROR_BACKOFF_MS = 5 * 60_000;
const MIN_INTERVAL_MS = 2_000;
const MIN_IDLE_INTERVAL_MS = 15_000;

type WorkerState = {
  started?: boolean;
  running?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  consecutiveFailures?: number;
};

const globalWorker = globalThis as typeof globalThis & { __productOemWorker?: WorkerState };

function state() {
  globalWorker.__productOemWorker ??= {};
  return globalWorker.__productOemWorker;
}

function isBuildProcess() {
  const args = process.argv.join(" ");
  return (
    process.env.npm_lifecycle_event === "build" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    /\bnext(?:\.js)?\s+build\b/.test(args) ||
    /\bnext\b.*\bbuild\b/.test(args)
  );
}

function configuredInterval(value: string | undefined, fallback: number, minimum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(Math.floor(parsed), minimum) : fallback;
}

function activeIntervalMs() {
  return configuredInterval(process.env.PRODUCT_OEM_WORKER_INTERVAL_MS, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
}

function idleIntervalMs() {
  return configuredInterval(process.env.PRODUCT_OEM_WORKER_IDLE_INTERVAL_MS, DEFAULT_IDLE_INTERVAL_MS, MIN_IDLE_INTERVAL_MS);
}

function errorBackoffMs(consecutiveFailures: number) {
  const base = configuredInterval(
    process.env.PRODUCT_OEM_WORKER_ERROR_BACKOFF_MS,
    DEFAULT_ERROR_BACKOFF_MS,
    MIN_IDLE_INTERVAL_MS
  );
  const maximum = configuredInterval(
    process.env.PRODUCT_OEM_WORKER_MAX_ERROR_BACKOFF_MS,
    DEFAULT_MAX_ERROR_BACKOFF_MS,
    base
  );
  return Math.min(maximum, base * (2 ** Math.max(0, consecutiveFailures - 1)));
}

export async function runProductOemWorkerOnce() {
  const current = state();
  if (current.running) return [];
  current.running = true;
  try {
    return await runForActiveBranches((branch) => processProductOemJobsForBranch(branch.id, 1));
  } finally {
    current.running = false;
  }
}

function scheduleNext(delayMs: number) {
  const current = state();
  if (!current.started) return;
  if (current.timer) clearTimeout(current.timer);
  current.timer = setTimeout(() => {
    current.timer = undefined;
    void tickProductOemWorker();
  }, delayMs);
  current.timer.unref?.();
}

function processedItemCount(results: Awaited<ReturnType<typeof runProductOemWorkerOnce>>) {
  return results.reduce((count, branch) => count + (branch.ok && Array.isArray(branch.result) ? branch.result.length : 0), 0);
}

async function tickProductOemWorker() {
  const current = state();
  if (current.running) return;
  try {
    const results = await runProductOemWorkerOnce();
    const failures = results.filter((branch) => !branch.ok);
    if (failures.length) {
      current.consecutiveFailures = (current.consecutiveFailures ?? 0) + 1;
      console.warn("[product-oem/worker]", {
        action: "branch_processing_failed",
        failures: failures.map(({ branchId, error }) => ({ branchId, error })),
        retryInMs: errorBackoffMs(current.consecutiveFailures),
      });
      scheduleNext(errorBackoffMs(current.consecutiveFailures));
      return;
    }

    current.consecutiveFailures = 0;
    scheduleNext(processedItemCount(results) > 0 ? activeIntervalMs() : idleIntervalMs());
  } catch (error) {
    current.consecutiveFailures = (current.consecutiveFailures ?? 0) + 1;
    const retryInMs = errorBackoffMs(current.consecutiveFailures);
    console.warn("[product-oem/worker]", {
      action: "tick_failed",
      error: error instanceof Error ? error.message : String(error),
      retryInMs,
    });
    scheduleNext(retryInMs);
  }
}

export function kickProductOemWorker() {
  const current = state();
  if (current.timer) {
    clearTimeout(current.timer);
    current.timer = undefined;
  }
  void tickProductOemWorker();
}

export function startProductOemWorker() {
  const current = state();
  if (
    current.started ||
    isBuildProcess() ||
    process.env.PRODUCT_OEM_WORKER_DISABLED === "1" ||
    process.env.PRODUCT_OEM_WORKER_ENABLED !== "1" ||
    !inProcessBackgroundWorkersEnabled()
  ) return;
  current.started = true;
  scheduleNext(2_000);
}
