import { requireActiveShiftAccess } from "@/lib/app-access";
import RestockClient from "./RestockClient";

export default async function RestockPage() {
  await requireActiveShiftAccess("/operations/restock");
  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-4 py-6 sm:px-6">
      <RestockClient />
    </main>
  );
}
