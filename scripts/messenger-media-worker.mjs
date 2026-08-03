import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { processMessengerMediaJobs } = await jiti.import("../src/lib/messenger/messenger-media.ts");

const intervalMs = Number(process.env.MESSENGER_MEDIA_WORKER_INTERVAL_MS ?? 15000);
const limit = Number(process.env.MESSENGER_MEDIA_WORKER_LIMIT ?? 5);
const workerId = `cli-${process.pid}`;
let stopping = false;

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

console.info("[messenger.media.worker]", { action: "started", workerId, intervalMs, limit });

while (!stopping) {
  try {
    const result = await processMessengerMediaJobs({ limit, workerId });
    if (result.processed.length) {
      console.info("[messenger.media.worker]", {
        action: "processed",
        workerId,
        count: result.processed.length,
        failed: result.processed.filter((item) => !item.ok).length,
      });
    }
  } catch (error) {
    console.warn("[messenger.media.worker]", {
      action: "failed",
      workerId,
      error: error instanceof Error ? error.message : "media worker failed",
    });
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.info("[messenger.media.worker]", { action: "stopped", workerId });
