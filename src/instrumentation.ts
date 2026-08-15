export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { startClientNotificationsWorker } = await import("./lib/client-notifications/worker");
  startClientNotificationsWorker();
  const { startProductOemWorker } = await import("./lib/product-oem-worker");
  startProductOemWorker();
  const { startTelegramSyncWorker } = await import("./lib/messenger/telegram-sync-worker");
  startTelegramSyncWorker();
}
