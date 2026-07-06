import { processDueClientNotificationJobs } from "@/lib/client-notifications/client-notifications";
import {
  syncRecentYclientsRecordNotifications,
  type YclientsRecordNotificationSyncResult,
} from "@/lib/yclients/record-notifications";

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
      yclientsSync: YclientsRecordNotificationSyncResult | { ok: false; error: string };
      processed: Awaited<ReturnType<typeof processDueClientNotificationJobs>>;
      count: number;
    }
  | {
      ok: true;
      skipped: "already_running";
      yclientsSync: null;
      processed: [];
      count: 0;
    };

const workerState = globalThis as typeof globalThis & {
  __clientNotificationsWorker?: WorkerState;
};

function state() {
  workerState.__clientNotificationsWorker ??= {};
  return workerState.__clientNotificationsWorker;
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
  if (process.env.CLIENT_NOTIFICATIONS_WORKER_ENABLED === "1") return true;
  return Boolean(
    process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_ENVIRONMENT_ID ||
      process.env.RAILWAY_PROJECT_ID
  );
}

export async function runClientNotificationsWorkerOnce(limit = 50): Promise<WorkerResult> {
  const current = state();
  if (current.running) {
    return {
      ok: true,
      skipped: "already_running",
      yclientsSync: null,
      processed: [],
      count: 0,
    };
  }

  current.running = true;
  try {
    const yclientsSync = await syncRecentYclientsRecordNotifications().catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "Не удалось проверить свежие записи YCLIENTS",
    }));
    const processed = await processDueClientNotificationJobs(limit);
    return { ok: true, yclientsSync, processed, count: processed.length };
  } finally {
    current.running = false;
  }
}

export function startClientNotificationsWorker() {
  const current = state();
  if (current.started || !workerEnabled()) return;
  current.started = true;

  const tick = () => {
    runClientNotificationsWorkerOnce().catch((error) => {
      console.warn("[client-notifications/worker]", error);
    });
  };

  current.timer = setInterval(tick, workerIntervalMs());
  current.timer.unref?.();
  const initialTimer = setTimeout(tick, 5_000);
  initialTimer.unref?.();
}
