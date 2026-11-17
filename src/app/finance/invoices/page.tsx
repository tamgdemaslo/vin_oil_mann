import { getSession } from "@/lib/auth";
import { Suspense } from "react";
import SupplierInvoicesClient from "./SupplierInvoicesClient";

export default async function SupplierInvoicesPage() {
  const session = await getSession();
  const canManageInvoices = session?.user.role === "owner" || session?.user.role === "admin";
  return (
    <main className="eco-page eco-page--wide">
      <Suspense fallback={<div className="eco-card eco-card--padded text-sm text-[var(--eco-muted)]">Загрузка счетов поставщиков...</div>}>
        <SupplierInvoicesClient canManageInvoices={canManageInvoices} />
      </Suspense>
    </main>
  );
}
