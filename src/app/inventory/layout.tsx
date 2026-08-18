import { requireOpenCashShiftAccess } from "@/lib/app-access";

export default async function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOpenCashShiftAccess("/inventory");
  return <main className="eco-page eco-page--wide eco-inventory-page">{children}</main>;
}
