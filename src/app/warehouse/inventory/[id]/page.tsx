import { Suspense } from "react";
import { requireActiveShiftAccess } from "@/lib/app-access";
import WarehouseInventoryClient from "../WarehouseInventoryClient";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WarehouseInventoryDetailPage({ params }: PageProps) {
  const { id } = await params;
  await requireActiveShiftAccess(`/warehouse/inventory/${id}`);
  return (
    <main className="eco-page eco-page--wide">
      <Suspense fallback={null}>
        <WarehouseInventoryClient sessionId={id} />
      </Suspense>
    </main>
  );
}
