import { Suspense } from "react";
import StockDocumentClient from "@/app/inventory/StockDocumentClient";

export default function WarehouseAdjustmentsPage() {
  return (
    <Suspense fallback={null}>
      <StockDocumentClient type="writeoff" />
    </Suspense>
  );
}
