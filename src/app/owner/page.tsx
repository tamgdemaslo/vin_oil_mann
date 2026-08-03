import { redirect } from "next/navigation";
import { requireBranchContext } from "@/lib/branch-context";
import { getOwnerDashboard } from "@/lib/owner-dashboard";

export const dynamic = "force-dynamic";

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value / 100);
}

export default async function OwnerDashboardPage() {
  const context = await requireBranchContext({ allowAll: true, requireActive: false });
  if (!context.groupRole) redirect("/");
  if (context.mode !== "all") redirect("/");
  const dashboard = await getOwnerDashboard(context);
  return (
    <main className="eco-owner-dashboard">
      <header className="eco-owner-dashboard__head">
        <div>
          <p>Владелец · Все филиалы</p>
          <h1>Сводка бизнеса</h1>
          <span>Агрегированный режим только для чтения. Для операции выберите конкретный филиал в шапке.</span>
        </div>
        <a href="/cabinet/branches" className="eco-btn eco-btn--secondary">Управление филиалами</a>
      </header>

      <section className="eco-owner-dashboard__totals" aria-label="Итоги месяца">
        <div><span>Выручка месяца</span><strong>{money(dashboard.total.revenueCents)}</strong></div>
        <div><span>Операционный результат</span><strong>{money(dashboard.total.operatingResultCents)}</strong></div>
        <div><span>Средний чек</span><strong>{money(dashboard.total.averageCheckCents)}</strong></div>
        <div><span>Отгрузки</span><strong>{dashboard.total.shipmentsCount}</strong></div>
      </section>

      <section className="eco-owner-dashboard__section">
        <div className="eco-owner-dashboard__section-head">
          <h2>Сравнение филиалов</h2>
          <span>С начала текущего месяца</span>
        </div>
        <div className="eco-owner-dashboard__table-wrap">
          <table>
            <thead><tr><th>Филиал</th><th>Выручка</th><th>Чек</th><th>Клиенты</th><th>Расходы</th><th>ФОТ</th><th>Результат</th></tr></thead>
            <tbody>
              {dashboard.branches.map((row) => (
                <tr key={row.branch.id}>
                  <th><span className={`eco-owner-dashboard__status is-${row.branch.status}`} />{row.branch.shortName}</th>
                  <td>{money(row.revenueCents)}</td>
                  <td>{money(row.averageCheckCents)}</td>
                  <td>{row.clientsCount}</td>
                  <td>{money(row.expensesCents)}</td>
                  <td>{money(row.payrollCents)}</td>
                  <td className={row.operatingResultCents < 0 ? "is-negative" : "is-positive"}>{money(row.operatingResultCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="eco-owner-dashboard__attention">
        <div><span>Незакрытые смены</span><strong>{dashboard.total.openShifts}</strong></div>
        <div><span>Просроченные дела</span><strong>{dashboard.total.overdueCases}</strong></div>
        <div><span>Товарных карточек</span><strong>{dashboard.total.productsCount}</strong></div>
        <div><span>Автомобилей в диагностиках</span><strong>{dashboard.total.vehiclesCount}</strong></div>
      </section>
    </main>
  );
}
