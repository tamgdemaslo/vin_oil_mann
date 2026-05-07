import { requireActiveShiftAccess } from "@/lib/app-access";
import CabinetDashboard from "./CabinetDashboard";

export default async function CabinetPage() {
  const session = await requireActiveShiftAccess("/cabinet");

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Личный кабинет
          </h1>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {session.user.name ?? session.user.login}
            <span className="ml-2 text-zinc-400 dark:text-zinc-500">
              {session.user.role === "owner"
                ? "· Владелец"
                : session.user.role === "admin"
                  ? "· Администратор"
                  : "· Мастер"}
            </span>
          </span>
        </div>
      </div>
      <CabinetDashboard />
    </div>
  );
}
