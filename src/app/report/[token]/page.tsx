"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ALL_NODES } from "@/data/diagnostic-catalog";

type PublicPayload = {
  header: {
    brand: string | null;
    model: string | null;
    year: number | null;
    licensePlate: string | null;
    mileage: number | null;
    vin: string | null;
    startedAt: string;
    completedAt: string | null;
    summaryGreen: number;
    summaryYellow: number;
    summaryRed: number;
    mechanicLogin: string | null;
  };
  clientWantsReminder: boolean;
  positions: {
    id: string;
    block: string;
    node: string;
    status: string;
    tags: string[];
    recommendation: string | null;
    photos: { id: string; caption: string | null; url: string }[];
  }[];
};

export default function ClientReportPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<PublicPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reminder, setReminder] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/diagnostic/public/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Ошибка");
        return j;
      })
      .then((j) => {
        setData(j as PublicPayload);
        setReminder(Boolean(j.clientWantsReminder));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка"));
  }, [token]);

  async function saveReminder(next: boolean) {
    setReminder(next);
    await fetch(`/api/diagnostic/public/${encodeURIComponent(token)}/reminder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientWantsReminder: next }),
    });
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center text-sm text-red-600">{error}</div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center text-sm text-zinc-500">Загрузка…</div>
    );
  }

  const h = data.header;
  const title = [h.brand, h.model, h.year].filter(Boolean).join(" ");

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-zinc-50 px-4 py-8 dark:bg-zinc-950">
      <header className="mb-6 text-center">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{title || "Отчёт диагностики"}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {h.licensePlate ? `${h.licensePlate} · ` : ""}
          {new Date(h.startedAt).toLocaleString("ru-RU")}
          {h.mileage != null ? ` · пробег ${h.mileage.toLocaleString("ru-RU")} км` : ""}
        </p>
        {h.mechanicLogin && (
          <p className="mt-1 text-xs text-zinc-500">Мастер: {h.mechanicLogin}</p>
        )}
      </header>

      <div className="mb-6 flex justify-center gap-4 text-center">
        <div className="rounded-xl bg-white px-4 py-2 shadow dark:bg-zinc-900">
          <div className="text-2xl font-bold text-emerald-600">{h.summaryGreen}</div>
          <div className="text-xs text-zinc-500">норма</div>
        </div>
        <div className="rounded-xl bg-white px-4 py-2 shadow dark:bg-zinc-900">
          <div className="text-2xl font-bold text-amber-600">{h.summaryYellow}</div>
          <div className="text-xs text-zinc-500">внимание</div>
        </div>
        <div className="rounded-xl bg-white px-4 py-2 shadow dark:bg-zinc-900">
          <div className="text-2xl font-bold text-red-600">{h.summaryRed}</div>
          <div className="text-xs text-zinc-500">замена</div>
        </div>
      </div>

      <section className="space-y-4">
        {data.positions.map((p) => (
          <article
            key={p.id}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="border-b border-zinc-100 px-4 py-2 text-sm font-semibold dark:border-zinc-800">
              {ALL_NODES.find((n) => n.node === p.node)?.title ?? p.node} ·{" "}
              {p.status === "RED" ? "🔴" : "🟡"}
            </div>
            <div className="grid gap-2 px-4 py-3 sm:grid-cols-2">
              {p.photos.map((ph) => (
                <figure key={ph.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ph.url}
                    alt={ph.caption ?? ""}
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
                  />
                  {ph.caption && (
                    <figcaption className="mt-1 text-xs text-zinc-500">{ph.caption}</figcaption>
                  )}
                </figure>
              ))}
            </div>
            {p.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 px-4 pb-2">
                {p.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            {p.recommendation && (
              <p className="border-t border-zinc-100 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                {p.recommendation}
              </p>
            )}
            {p.status === "RED" && (
              <p className="border-t border-zinc-100 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-zinc-800 dark:bg-amber-950/30 dark:text-amber-100">
                Рекомендуем выполнить работы на станции. Запишитесь на удобное время.
              </p>
            )}
          </article>
        ))}
      </section>

      <footer className="mt-8 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={reminder}
            onChange={(e) => void saveReminder(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300"
          />
          Напомнить о следующем ТО через 6 месяцев
        </label>
      </footer>
    </div>
  );
}
