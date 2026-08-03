import { Suspense } from "react";
import StockDocumentClient from "../StockDocumentClient";

export default function InventoryWriteoffsPage() {
  return (
    <Suspense fallback={null}>
      <StockDocumentClient type="writeoff" />
    </Suspense>
  );
}
