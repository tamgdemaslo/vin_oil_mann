export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { inProcessBackgroundWorkersEnabled } = await import("./lib/background-worker-policy");
    if (!inProcessBackgroundWorkersEnabled()) {
      console.info("[background-workers] disabled in web process");
      return;
    }
    const { startClientNotificationsWorker } = await import("./lib/client-notifications/worker");
    startClientNotificationsWorker();
    const { startProductOemWorker } = await import("./lib/product-oem-worker");
    startProductOemWorker();
    const { startTelegramSyncWorker } = await import("./lib/messenger/telegram-sync-worker");
    startTelegramSyncWorker();
  }
}
