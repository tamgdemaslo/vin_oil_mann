import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import { getCurrentShift } from "@/lib/cashbox";
import RestockClient from "./RestockClient";

export default async function OperationsRestockPage() {
  const { user } = await requireAuthenticatedSession("/operations/restock");
  if (user.role !== "admin" || (await getCurrentShift())?.status === "open") {
    redirect("/inventory/restock");
  }

  return (
    <main className="eco-page eco-page--wide eco-inventory-page">
      <RestockClient />
    </main>
  );
}
