import { runForActiveBranches } from "@/lib/branch-workers";
import { syncTelegramUserAccount } from "@/lib/messenger/channels/telegram-user-session";

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;

type WorkerState = {
  started?: boolean;
  running?: boolean;
  timer?: ReturnType<typeof setInterval>;
};

const globalWorker = globalThis as typeof globalThis & { __telegramUserSyncWorker?: WorkerState };

function state() {
  globalWorker.__telegramUserSyncWorker ??= {};
  return globalWorker.__telegramUserSyncWorker;
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
  if (process.env.TELEGRAM_SYNC_WORKER_DISABLED === "1" || isBuildProcess()) return false;
  if (process.env.TELEGRAM_SYNC_WORKER_ENABLED === "0") return false;
  if (process.env.TELEGRAM_SYNC_WORKER_ENABLED === "1") return true;
  return process.env.NODE_ENV === "production";
}

function intervalMs() {
  const configured = Number(process.env.TELEGRAM_SYNC_WORKER_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(Math.floor(configured), MIN_INTERVAL_MS);
}

export async function runTelegramSyncWorkerOnce() {
  const current = state();
  if (current.running) return [];
  current.running = true;
  try {
    return await runForActiveBranches(() => syncTelegramUserAccount(undefined, 30));
  } finally {
    current.running = false;
  }
}

export function startTelegramSyncWorker() {
  const current = state();
  if (current.started || !workerEnabled()) return;
  current.started = true;

  const tick = () => {
    void runTelegramSyncWorkerOnce().then((results) => {
      const failures = results.filter((result) => !result.ok || result.result?.processed.some((item) => !item.ok));
      if (failures.length) {
        console.warn("[messenger.telegram_user.worker]", {
          action: "sync_failed",
          branches: failures.map((result) => ({ branchId: result.branchId, error: result.error })),
        });
      }
    }).catch((error) => {
      console.warn("[messenger.telegram_user.worker]", {
        action: "tick_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  current.timer = setInterval(tick, intervalMs());
  current.timer.unref?.();
  const initialTimer = setTimeout(tick, 10_000);
  initialTimer.unref?.();
}
