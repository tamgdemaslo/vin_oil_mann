"use client";

import { useEffect, useState } from "react";
import { toServiceDateInput } from "@/lib/date-time";

export type OwnerUser = {
  login: string;
  name: string;
  role?: "owner" | "admin" | "master";
};

let cachedOwnerUsers: OwnerUser[] | null = null;
let ownerUsersPromise: Promise<OwnerUser[]> | null = null;

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
  const [users, setUsers] = useState<OwnerUser[]>(() => cachedOwnerUsers ?? []);
  const [loading, setLoading] = useState(enabled && !cachedOwnerUsers);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    if (cachedOwnerUsers) {
      return;
    }

    const request =
      ownerUsersPromise ??
      (ownerUsersPromise = fetch("/api/users")
        .then((r) => r.json())
        .then((data) => {
          const nextUsers = Array.isArray(data?.users) ? data.users : [];
          cachedOwnerUsers = nextUsers;
          return nextUsers;
        })
        .finally(() => {
          ownerUsersPromise = null;
        }));

    request
      .then((nextUsers) => {
        if (!cancelled) {
          setUsers(nextUsers);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { users, loading };
}
