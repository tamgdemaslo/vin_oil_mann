import { Suspense } from "react";
import { NewShipmentPageClient } from "../../new/NewShipmentPageClient";

export default async function EditShipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ copied?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  return (
    <Suspense
      fallback={
        <div className="eco-page text-sm text-[var(--eco-muted)]">
          Загрузка...
        </div>
      }
    >
      <NewShipmentPageClient demandId={id} copied={sp.copied === "1"} />
    </Suspense>
  );
}
