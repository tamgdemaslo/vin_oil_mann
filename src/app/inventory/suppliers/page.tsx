import { Suspense } from "react";
import CounterpartiesClient from "../counterparties/CounterpartiesClient";
import "./suppliers.css";

export default function SuppliersPage() {
  return (
    <main className="eco-page eco-page--wide eco-clients-page">
      <Suspense fallback={<p role="status">Загружаем поставщиков…</p>}>
        <CounterpartiesClient suppliersOnly />
      </Suspense>
    </main>
  );
}
