import { warmOilProductsCache } from "@/lib/oil-recommendations";
import { refreshMoySkladStockCache } from "@/lib/moysklad-stock-cache";

let warmupInFlight: Promise<void> | null = null;

export function warmMoySkladLookupCaches(reason = "manual"): void {
  if (warmupInFlight) return;

  warmupInFlight = Promise.allSettled([
    refreshMoySkladStockCache(),
    warmOilProductsCache(),
  ])
    .then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.warn(
            "[moysklad-lookup-warmup] failed",
            reason,
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          );
        }
      }
    })
    .finally(() => {
      warmupInFlight = null;
    });
}
