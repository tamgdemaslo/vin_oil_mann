import { Suspense } from "react";
import RecordsPageClient from "./RecordsPageClient";

export default function RecordsPage() {
  return (
    <Suspense fallback={null}>
      <RecordsPageClient />
    </Suspense>
  );
}
