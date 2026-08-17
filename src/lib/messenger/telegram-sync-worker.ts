import { runForActiveBranches } from "@/lib/branch-workers";
import { syncTelegramUserAccount } from "@/lib/messenger/channels/telegram-user-session";

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;
const DEFAULT_FAILURE_LOG_INTERVAL_MS = 60 * 60_000;

type WorkerState = {
  started?: boolean;
  running?: boolean;
  timer?: ReturnType<typeof setInterval>;
  lastFailureFingerprint?: string;
  lastFailureLoggedAt?: number;
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
  // Telegram user-session sync is an external, stateful integration. Keep it
  // opt-in so a broken transport cannot start a retry storm on every replica.
  return process.env.TELEGRAM_SYNC_WORKER_ENABLED === "1";
}

function intervalMs() {
  const configured = Number(process.env.TELEGRAM_SYNC_WORKER_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(Math.floor(configured), MIN_INTERVAL_MS);
}

function failureLogIntervalMs() {
  const configured = Number(process.env.TELEGRAM_SYNC_FAILURE_LOG_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_FAILURE_LOG_INTERVAL_MS;
  return Math.max(60_000, Math.floor(configured));
}

export async function runTelegramSyncWorkerOnce() {
  const current = state();
  if (current.running) return [];
  current.running = true;
  try {
    return await runForActiveBranches(() => syncTelegramUserAccount(undefined, 30, { worker: true }));
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
      const failures: Array<{ branchId: string; accountId?: string; error: string }> = [];
      for (const result of results) {
        if (!result.ok) {
          failures.push({ branchId: result.branchId, error: result.error ?? "Telegram branch sync failed" });
          continue;
        }
        for (const item of result.result?.processed ?? []) {
          if (!item.ok) {
            failures.push({
              branchId: result.branchId,
              accountId: item.accountId,
              error: item.error ?? "Telegram account sync failed",
            });
          }
        }
      }
      if (failures.length) {
        const fingerprint = JSON.stringify(failures);
        const now = Date.now();
        if (fingerprint !== current.lastFailureFingerprint || now - (current.lastFailureLoggedAt ?? 0) >= failureLogIntervalMs()) {
          console.warn("[messenger.telegram_user.worker]", JSON.stringify({ action: "sync_failed", failures }));
          current.lastFailureFingerprint = fingerprint;
          current.lastFailureLoggedAt = now;
        }
      } else if (current.lastFailureFingerprint) {
        console.info("[messenger.telegram_user.worker]", JSON.stringify({ action: "sync_recovered" }));
        current.lastFailureFingerprint = undefined;
        current.lastFailureLoggedAt = undefined;
      }
    }).catch((error) => {
      console.warn("[messenger.telegram_user.worker]", JSON.stringify({
        action: "tick_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  };

  current.timer = setInterval(tick, intervalMs());
  current.timer.unref?.();
  const initialTimer = setTimeout(tick, 10_000);
  initialTimer.unref?.();
}
