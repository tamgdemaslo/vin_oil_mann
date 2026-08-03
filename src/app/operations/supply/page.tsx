import { requireActiveShiftAccess } from "@/lib/app-access";
import SupplyClient from "./SupplyClient";

export default async function SupplyPage() {
  await requireActiveShiftAccess("/operations/supply");
  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-4 py-6 sm:px-6">
      <SupplyClient />
    </main>
  );
}
