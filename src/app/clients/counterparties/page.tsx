import { Suspense } from "react";
import CounterpartiesClient from "@/app/inventory/counterparties/CounterpartiesClient";

export default function ClientCounterpartiesPage() {
  return (
    <main className="eco-page eco-page--wide eco-clients-page">
      <Suspense fallback={<div className="eco-card eco-card--padded muted">Загружаем клиентов...</div>}>
        <CounterpartiesClient />
      </Suspense>
    </main>
  );
}
