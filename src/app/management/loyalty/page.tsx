import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import { getBranchContext } from "@/lib/branch-context";
import { loyaltyPermissions } from "@/lib/loyalty/accounts";
import { LoyaltySettings } from "./LoyaltySettings";

export default async function LoyaltySettingsPage() {
  await requireAuthenticatedSession("/management/loyalty");
  const context = await getBranchContext({ allowAll: true, requireActive: false });
  if (!context || !loyaltyPermissions(context).manager) redirect("/");
  return <main className="eco-page eco-page--wide">
    <section className="eco-page-head">
      <div>
        <nav className="eco-page-crumbs"><Link href="/management">Управление</Link><span className="sep">/</span><span>Настройки</span></nav>
        <h1 className="eco-page-title">Программа лояльности</h1>
      </div>
    </section>
    <LoyaltySettings owner={context.isGroupOwner} branchId={context.branchId} />
  </main>;
}
