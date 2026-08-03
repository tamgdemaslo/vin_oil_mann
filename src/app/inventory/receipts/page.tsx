import { Suspense } from "react";
import StockDocumentClient from "../StockDocumentClient";

export default function InventoryReceiptsPage() {
  return (
    <Suspense fallback={null}>
      <StockDocumentClient type="receipt" />
    </Suspense>
  );
}
