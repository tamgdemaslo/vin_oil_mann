import { requireActiveShiftAccess } from "@/lib/app-access";
import PenaltiesList from "./PenaltiesList";

export default async function CabinetPenaltiesPage() {
  const session = await requireActiveShiftAccess("/cabinet/penalties");

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Бонусы и штрафы</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Дата, сумма, причина, тип. Редактировать и удалять может только владелец.
      </p>
      <PenaltiesList role={session.user.role} />
    </div>
  );
}
