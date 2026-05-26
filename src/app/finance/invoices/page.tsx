import { Suspense } from "react";
import SupplierInvoicesClient from "./SupplierInvoicesClient";

export default function SupplierInvoicesPage() {
  return (
    <main className="eco-page">
      <div className="eco-page-head">
        <div>
          <div className="eco-page-kicker">Финансы</div>
          <h1 className="eco-page-title">Счета поставщиков</h1>
          <p className="eco-page-subtitle">
          Счета поставщиков и связанные складские документы.
        </p>
        </div>
      </div>
      <Suspense fallback={<div className="eco-card eco-card--padded text-sm text-[var(--eco-muted)]">Загрузка...</div>}>
        <SupplierInvoicesClient />
      </Suspense>
    </main>
  );
}
