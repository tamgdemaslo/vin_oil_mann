import { Suspense } from "react";
import { requireActiveShiftAccess } from "@/lib/app-access";
import WarehouseInventoryClient from "./WarehouseInventoryClient";

export default async function WarehouseInventoryPage() {
  await requireActiveShiftAccess("/warehouse/inventory");
  return (
    <main className="eco-page eco-page--wide">
      <Suspense fallback={null}>
        <WarehouseInventoryClient />
      </Suspense>
    </main>
  );
}
