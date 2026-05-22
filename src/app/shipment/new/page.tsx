import { Suspense } from "react";
import { NewShipmentPageClient } from "./NewShipmentPageClient";

export default function NewShipmentPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-zinc-500 dark:text-zinc-400">
          Загрузка…
        </div>
      }
    >
      <NewShipmentPageClient />
    </Suspense>
  );
}
