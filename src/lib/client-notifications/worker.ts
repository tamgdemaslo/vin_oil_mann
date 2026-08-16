import { processDueClientNotificationJobs } from "@/lib/client-notifications/client-notifications";
import { runForActiveBranches } from "@/lib/branch-workers";
import { getScopedBranchId } from "@/lib/request-tenant-store";

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;

type WorkerState = {
  started?: boolean;
  running?: boolean;
  timer?: ReturnType<typeof setInterval>;
};

type WorkerResult =
  | {
      ok: true;
      processed: Awaited<ReturnType<typeof processDueClientNotificationJobs>>;
      count: number;
    }
  | {
      ok: true;
      skipped: "already_running";
      processed: [];
      count: 0;
    };

const workerState = globalThis as typeof globalThis & {
  __clientNotificationsWorkers?: Map<string, WorkerState>;
  __clientNotificationsWorkerScheduler?: WorkerState;
};

function state() {
  workerState.__clientNotificationsWorkers ??= new Map();
  const branchId = getScopedBranchId();
  const existing = workerState.__clientNotificationsWorkers.get(branchId);
  if (existing) return existing;
  const created: WorkerState = {};
  workerState.__clientNotificationsWorkers.set(branchId, created);
  return created;
}

function schedulerState() {
  workerState.__clientNotificationsWorkerScheduler ??= {};
  return workerState.__clientNotificationsWorkerScheduler;
}

function workerIntervalMs() {
  const configured = Number(process.env.CLIENT_NOTIFICATIONS_WORKER_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(Math.floor(configured), MIN_INTERVAL_MS);
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

function workerEnabled() {
  if (process.env.CLIENT_NOTIFICATIONS_WORKER_DISABLED === "1") return false;
  if (isBuildProcess()) return false;
  return process.env.CLIENT_NOTIFICATIONS_WORKER_ENABLED === "1";
}

export async function runClientNotificationsWorkerOnce(limit = 50): Promise<WorkerResult> {
  const current = state();
  if (current.running) {
    return {
      ok: true,
      skipped: "already_running",
      processed: [],
      count: 0,
    };
  }

  current.running = true;
  try {
    const processed = await processDueClientNotificationJobs(limit);
    return { ok: true, processed, count: processed.length };
  } finally {
    current.running = false;
  }
}

export function startClientNotificationsWorker() {
  const current = schedulerState();
  if (current.started || !workerEnabled()) return;
  current.started = true;

  const tick = () => {
    runForActiveBranches(() => runClientNotificationsWorkerOnce(50)).catch((error) => {
      console.warn("[client-notifications/worker]", error);
    });
  };

  current.timer = setInterval(tick, workerIntervalMs());
  current.timer.unref?.();
  const initialTimer = setTimeout(tick, 5_000);
  initialTimer.unref?.();
}
