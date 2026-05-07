import { requireActiveShiftAccess } from "@/lib/app-access";
import AnalyticsBlock from "./AnalyticsBlock";

export default async function CabinetAnalyticsPage() {
  const session = await requireActiveShiftAccess("/cabinet/analytics");
  const isOwner = session.user.role === "owner";

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        {isOwner ? "Выплаты и ставки" : "Подробный расчет зарплаты"}
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {isOwner
          ? "Все сотрудники: кто, за что и сколько получает, плюс управление ставками."
          : "Ваши смены, сдельная часть и детализация по отгрузкам за выбранный период."}
      </p>
      <AnalyticsBlock role={session.user.role} login={session.user.login} />
    </div>
  );
}
