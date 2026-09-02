import { Suspense } from "react";
import StorageCellsClient from "./StorageCellsClient";

export default function StorageCellsPage() {
  return (
    <Suspense fallback={null}>
      <StorageCellsClient />
    </Suspense>
  );
}
