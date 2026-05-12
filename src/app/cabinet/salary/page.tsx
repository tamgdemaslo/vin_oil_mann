import { requireActiveShiftAccess } from "@/lib/app-access";
import SalaryBlock from "./SalaryBlock";

export default async function CabinetSalaryPage() {
  const session = await requireActiveShiftAccess("/cabinet/salary");

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Зарплата и начисления</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Итог за период: ставки смен, сдельная часть, бонусы и штрафы.
      </p>
      <SalaryBlock role={session.user.role} login={session.user.login} />
    </div>
  );
}
