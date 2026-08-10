import { runForActiveBranches } from "@/lib/branch-workers";
import { processProductOemJobsForBranch } from "@/lib/product-oem-batches";

const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 2_000;

type WorkerState = {
  started?: boolean;
  running?: boolean;
  timer?: ReturnType<typeof setInterval>;
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

function intervalMs() {
  const value = Number(process.env.PRODUCT_OEM_WORKER_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? Math.max(Math.floor(value), MIN_INTERVAL_MS) : DEFAULT_INTERVAL_MS;
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

export function kickProductOemWorker() {
  void runProductOemWorkerOnce().catch((error) => console.warn("[product-oem/worker]", error));
}

export function startProductOemWorker() {
  const current = state();
  if (current.started || isBuildProcess() || process.env.PRODUCT_OEM_WORKER_DISABLED === "1") return;
  current.started = true;
  const tick = () => kickProductOemWorker();
  current.timer = setInterval(tick, intervalMs());
  current.timer.unref?.();
  const initialTimer = setTimeout(tick, 2_000);
  initialTimer.unref?.();
}
