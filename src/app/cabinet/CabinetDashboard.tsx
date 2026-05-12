"use client";

import PasswordChangeCard from "./PasswordChangeCard";

export default function CabinetDashboard() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <section className="rounded-3xl border border-zinc-200 bg-white/95 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90 sm:p-6">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Смена пароля</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Обновите пароль для входа в систему.
          </p>
        </div>
          <PasswordChangeCard />
      </section>
    </main>
  );
}
