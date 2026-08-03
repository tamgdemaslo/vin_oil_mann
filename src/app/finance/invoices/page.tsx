import { Suspense } from "react";
import SupplierInvoicesClient from "./SupplierInvoicesClient";

export default function SupplierInvoicesPage() {
  return (
    <main className="eco-page eco-page--wide">
      <Suspense fallback={<div className="eco-card eco-card--padded text-sm text-[var(--eco-muted)]">Загрузка счетов поставщиков...</div>}>
        <SupplierInvoicesClient />
      </Suspense>
    </main>
  );
}
