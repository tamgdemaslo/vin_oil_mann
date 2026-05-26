import { Suspense } from "react";
import { NewShipmentPageClient } from "./NewShipmentPageClient";

export default function NewShipmentPage() {
  return (
    <Suspense
      fallback={
        <div className="eco-page text-sm text-[var(--eco-muted)]">
          Загрузка...
        </div>
      }
    >
      <NewShipmentPageClient />
    </Suspense>
  );
}
