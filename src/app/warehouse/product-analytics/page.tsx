import { Suspense } from "react";
import { requireOpenCashShiftAccess } from "@/lib/app-access";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import ProductAnalyticsClient from "./ProductAnalyticsClient";

export default async function WarehouseProductAnalyticsPage() {
  const session = await requireOpenCashShiftAccess("/warehouse/product-analytics");
  const allowed = await canViewWarehouseAnalytics(session.user);

  if (!allowed) {
    return (
      <main className="eco-page eco-page--wide">
        <section className="eco-card eco-card--padded">
          <p className="eco-page-kicker">Склад</p>
          <h1 className="eco-page-title">Аналитика товаров</h1>
          <p className="eco-page-subtitle">Для просмотра нужен доступ warehouse.analytics.view.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="eco-page eco-page--wide eco-product-analytics-page">
      <Suspense fallback={null}>
        <ProductAnalyticsClient />
      </Suspense>
    </main>
  );
}
