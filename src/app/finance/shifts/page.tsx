import Link from "next/link";
import { EcoBadge } from "@/components/platform/EcoUI";
import { requireActiveShiftAccess } from "@/lib/app-access";
import ShiftsList from "@/app/cabinet/shifts/ShiftsList";

export default async function FinanceShiftsPage() {
  const session = await requireActiveShiftAccess("/finance/shifts");

  return (
    <main className="eco-page eco-page--wide">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <span>Финансы</span>
            <span className="sep">/</span>
            <span className="cur">Смены</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Смены</h1>
            <EcoBadge tone="info">рабочие смены сотрудников</EcoBadge>
          </div>
          <p className="eco-page-subtitle">
            История рабочих дней, фактических смен сотрудников и закрытий смен без смешения с кассовой сменой.
          </p>
        </div>
      </section>

      <section className="eco-card eco-card--padded">
        <ShiftsList role={session.user.role} backHref="/salary" backLabel="К зарплате" />
      </section>
    </main>
  );
}
