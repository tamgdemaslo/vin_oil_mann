"use client";

import { Building2, CalendarDays, Clock3, Filter, ShieldCheck, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./all-branches.module.css";

type Branch = { id: string; name: string; timezone: string };
type Booking = {
  id: string;
  branchId: string;
  branch: { id: string; name: string; timezone: string; address: string | null };
  customerName: string;
  vehicle: { make: string; model: string; plate: string | null } | null;
  master: { name: string } | null;
  services: Array<{ name: string }>;
  startsAt: string;
  endsAt: string;
  status: string;
  confirmationState: string;
  source: string;
};

function dateInput(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateInput(date);
}

export default function AllBranchRecordsClient({ branches }: { branches: Branch[] }) {
  const [from, setFrom] = useState(dateInput());
  const [to, setTo] = useState(addDays(dateInput(), 7));
  const [branchId, setBranchId] = useState("all");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        localFrom: from,
        localTo: to,
      });
      if (branchId !== "all") params.set("branchId", branchId);
      const response = await fetch(`/api/bookings?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as { bookings?: Booking[]; error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Не удалось загрузить записи");
      setBookings(body?.bookings ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить записи");
    } finally {
      setLoading(false);
    }
  }, [branchId, from, to]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const booking of bookings) {
      const key = booking.branchId;
      const rows = map.get(key) ?? [];
      rows.push(booking);
      map.set(key, rows);
    }
    return branches.map((branch) => ({ branch, rows: map.get(branch.id) ?? [] })).filter((group) => branchId === "all" ? true : group.branch.id === branchId);
  }, [bookings, branchId, branches]);

  return (
    <main className={`eco-page eco-page--wide ${styles.page}`}>
      <header className={styles.header}>
        <div><span>Все филиалы</span><h1>Сводный журнал записей</h1><p>Единый обзор без операций изменения. Для редактирования выберите конкретный филиал в верхней панели.</p></div>
        <ShieldCheck aria-hidden />
      </header>
      <section className={styles.filters}>
        <Filter aria-hidden />
        <label><span>Филиал</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">Все филиалы</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label><span>С</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>По</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="button" onClick={load} disabled={loading}>Обновить</button>
      </section>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.groups}>
        {grouped.map(({ branch, rows }) => <section key={branch.id} className={styles.group}><header><div><Building2 aria-hidden /><span><strong>{branch.name}</strong><small>{rows.length} записей за период</small></span></div><b>{rows.filter((row) => row.status === "ACTIVE").length} активных</b></header><div className={styles.list}>{rows.map((booking) => <article key={booking.id} className={booking.status === "CANCELLED" ? styles.cancelled : ""}><time><strong>{new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", timeZone: booking.branch.timezone }).format(new Date(booking.startsAt))}</strong><span>{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: booking.branch.timezone }).format(new Date(booking.startsAt))}</span></time><div><strong>{booking.customerName}</strong><small>{booking.vehicle ? `${booking.vehicle.make} ${booking.vehicle.model}${booking.vehicle.plate ? ` · ${booking.vehicle.plate}` : ""}` : "Автомобиль не указан"}</small></div><div className={styles.service}><Wrench aria-hidden /><span>{booking.services.map((service) => service.name).join(", ")}</span></div><div className={styles.master}><Clock3 aria-hidden /><span>{booking.master?.name || "Без мастера"}</span></div><em>{booking.status === "CANCELLED" ? "Отменена" : booking.confirmationState === "PENDING" ? "Ждёт подтверждения" : booking.source === "PUBLIC" ? "Онлайн" : "Активна"}</em></article>)}{!rows.length && <p>Записей за выбранный период нет.</p>}</div></section>)}
      </div>
      {loading && <div className={styles.loading}><CalendarDays aria-hidden /> Обновляем журнал…</div>}
    </main>
  );
}
