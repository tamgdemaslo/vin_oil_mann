"use client";

import { useEffect, useState } from "react";
import { toServiceDateInput } from "@/lib/date-time";

export type OwnerUser = {
  login: string;
  name: string;
  role?: "owner" | "admin" | "master";
  employmentEnd?: string | null;
  employmentStart?: string | null;
};

export function toLocalDateInputValue(value: Date) {
  return toServiceDateInput(value);
}

export function getCurrentMonthRange() {
  // Date inputs contain calendar dates, not instants.  Building a Date at
  // browser-local midnight and then formatting it in the service timezone
  // could move either edge of the month by a day.  Derive both keys directly
  // from today's service date instead.
  const today = toServiceDateInput(new Date());
  const [yearText, monthText] = today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    dateFrom: `${yearText}-${monthText}-01`,
    dateTo: `${yearText}-${monthText}-${String(daysInMonth).padStart(2, "0")}`,
  };
}

export function useOwnerUsers(enabled: boolean) {
  const [users, setUsers] = useState<OwnerUser[]>([]);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/users", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Не удалось загрузить сотрудников"); return response.json(); })
      .then((data) => setUsers(Array.isArray(data.users) ? data.users : []))
      .catch(() => { if (!controller.signal.aborted) setUsers([]); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled]);
  return { users, loading };
}
