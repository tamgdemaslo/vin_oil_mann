import CounterpartiesClient from "@/app/inventory/counterparties/CounterpartiesClient";

export default function ClientCounterpartiesPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Клиенты</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Контрагенты, клиенты, поставщики и компании из локальной базы.
        </p>
      </div>
      <CounterpartiesClient />
    </main>
  );
}
