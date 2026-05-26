import Link from "next/link";
import { requireActiveShiftAccess } from "@/lib/app-access";
import { EcoBadge } from "@/components/platform/EcoUI";
import SalaryBlock from "./SalaryBlock";

export default async function CabinetSalaryPage() {
  const session = await requireActiveShiftAccess("/cabinet/salary");

  return (
    <main className="eco-page">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <Link href="/cabinet">Кабинет</Link>
            <span className="sep">/</span>
            <span className="cur">Зарплата</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Зарплата и начисления</h1>
            <EcoBadge tone="rust">личный расчёт</EcoBadge>
          </div>
          <p className="eco-page-subtitle">
            Итог за период: ставки смен, сдельная часть, бонусы и штрафы.
          </p>
        </div>
      </section>
      <section className="eco-card eco-card--padded">
        <SalaryBlock role={session.user.role} login={session.user.login} />
      </section>
    </main>
  );
}
