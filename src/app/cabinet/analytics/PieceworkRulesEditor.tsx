"use client";

import Link from "next/link";

export default function PieceworkRulesEditor(props: { onSaved?: () => void }) {
  void props;
  return (
    <section className="rounded-lg border border-zinc-200 p-4">
      <h3 className="font-semibold">Индивидуальные сдельные правила</h3>
      <p className="mt-1 text-sm">Выберите сотрудника и настройте его начисления в разделе зарплаты.</p>
      <Link className="mt-3 inline-block underline" href="/salary?tab=rules">Открыть правила сотрудников</Link>
    </section>
  );
}
