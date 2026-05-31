"use client";

import { useEffect, useState } from "react";

export type OwnerUser = {
  login: string;
  name: string;
  role?: "owner" | "admin" | "master";
};

let cachedOwnerUsers: OwnerUser[] | null = null;
let ownerUsersPromise: Promise<OwnerUser[]> | null = null;

export function toLocalDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCurrentMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    dateFrom: toLocalDateInputValue(first),
    dateTo: toLocalDateInputValue(last),
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
