"use client";

import { useEffect, useState } from "react";
import { Clock3, Loader2, RefreshCw } from "lucide-react";

export type RecordBookingSlot = {
  startsAt: string;
  localTime: string;
  durationMinutes: number;
  master: { membershipId: string; name: string };
};

type Props = {
  localDate: string;
  serviceIds: string[];
  masterMembershipId?: string;
  durationMinutes?: number;
  excludeBookingId?: string | null;
  selectedLocalTime?: string;
  onNextWorkingDay?: () => void;
  onSelect: (slot: RecordBookingSlot) => void;
};

export default function RecordsSlotPicker({ localDate, serviceIds, masterMembershipId, durationMinutes, excludeBookingId, selectedLocalTime, onNextWorkingDay, onSelect }: Props) {
  const serviceKey = JSON.stringify(serviceIds);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; slots: RecordBookingSlot[]; message: string; error: boolean } | null>(null);
  const requestKey = JSON.stringify([localDate, serviceKey, masterMembershipId, durationMinutes, excludeBookingId, retry]);
  const ready = serviceIds.length > 0;
  const current = result?.key === requestKey ? result : null;
  const showMaster = !masterMembershipId && new Set(current?.slots.map(slot => slot.master.membershipId)).size > 1;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/bookings/availability", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ localDate, serviceIds: JSON.parse(serviceKey), masterMembershipId: masterMembershipId || null, durationOverrideMinutes: durationMinutes ?? null, excludeBookingId: excludeBookingId ?? null }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить свободное время");
        if (!controller.signal.aborted) setResult({ key: requestKey, slots: Array.isArray(data.slots) ? data.slots : [], message: data.message || "На эту дату подходящих окон нет. Выберите другой день или мастера.", error: false });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key: requestKey, slots: [], message: error instanceof Error && error.message !== "Failed to fetch" && !(error instanceof SyntaxError) ? error.message : "Не удалось загрузить свободное время. Повторите проверку.", error: true });
      }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [ready, requestKey, localDate, serviceKey, masterMembershipId, durationMinutes, excludeBookingId]);

  return <div className="eco-records-slot-picker" aria-busy={ready && !current}>
    <div className="eco-records-slot-picker__head"><Clock3 size={16} aria-hidden="true" /><strong>Свободное время</strong></div>
    {!ready ? <p>Выберите услуги — покажем время, которого хватит на все работы.</p> : !current ? <p role="status"><Loader2 size={16} className="eco-spin" /> Проверяем расписание мастеров…</p> : current.error ? <div role="status"><p>{current.message}</p><button type="button" className="eco-records-inline-action" onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} /> Повторить</button></div> : current.slots.length ? <>
      <p>Нажмите время начала. Длительность работ уже учтена.</p>
      <div className="eco-records-slot-picker__choices">
      {[
        { label: "Утро", from: "00:00", to: "12:00" },
        { label: "День", from: "12:00", to: "17:00" },
        { label: "Вечер", from: "17:00", to: "24:00" },
      ].map(({ label, from, to }) => {
        const slots = current.slots.filter(slot => slot.localTime >= from && slot.localTime < to);
        if (!slots.length) return null;
        return <details open key={label} className="eco-records-slot-picker__master">
          <summary>{label}</summary>
          <div className="eco-records-slot-picker__times" role="group" aria-label={`Свободное время: ${label.toLowerCase()}`}>
            {slots.map(slot => <button key={`${slot.startsAt}-${slot.master.membershipId}`} type="button" aria-pressed={slot.localTime === selectedLocalTime && slot.master.membershipId === masterMembershipId} onClick={() => onSelect(slot)} aria-label={`${slot.localTime}, ${slot.master.name}, ${slot.durationMinutes} мин`}>
              {slot.localTime}{showMaster ? <small>{slot.master.name}</small> : null}
            </button>)}
          </div>
        </details>;
      })}
      </div>
    </> : <div role="status"><p>{current.message}</p>{onNextWorkingDay ? <button type="button" className="eco-records-inline-action" onClick={onNextWorkingDay}>Следующий рабочий день</button> : null}</div>}
  </div>;
}
