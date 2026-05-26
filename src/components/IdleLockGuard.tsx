"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { safeReadJson } from "@/lib/http-json";

const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const PIN_REGEX = /^\d{4}$/;

type SessionUser = {
  login: string;
  name: string;
  role: "owner" | "admin" | "master";
};

export default function IdleLockGuard() {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [switchingUser, setSwitchingUser] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      setLoading(true);
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await safeReadJson<{ user?: SessionUser | null }>(res);
        if (cancelled) return;
        setUser(data?.user ?? null);
      } catch {
        if (cancelled) return;
        setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (!user || loading || pathname === "/login" || pathname === "/client-site") return;

    function clearIdleTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function restartIdleTimer() {
      clearIdleTimer();
      timerRef.current = setTimeout(() => {
        setLocked(true);
        setPassword("");
        setError(null);
      }, IDLE_TIMEOUT_MS);
    }

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    const onActivity = () => {
      if (locked) return;
      restartIdleTimer();
    };

    restartIdleTimer();
    events.forEach((eventName) =>
      window.addEventListener(eventName, onActivity, { passive: true })
    );

    return () => {
      clearIdleTimer();
      events.forEach((eventName) => window.removeEventListener(eventName, onActivity));
    };
  }, [locked, loading, pathname, user]);

  const shouldRenderModal = useMemo(
    () => !!user && !loading && locked && pathname !== "/login" && pathname !== "/client-site",
    [loading, locked, pathname, user]
  );

  async function unlock() {
    if (!PIN_REGEX.test(password)) {
      setError("Введите пароль из 4 цифр");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await safeReadJson<{ error?: string }>(res);
      if (!res.ok) {
        setError(data?.error ?? "Не удалось разблокировать");
        return;
      }
      setLocked(false);
      setPassword("");
    } catch {
      setError("Ошибка соединения");
    } finally {
      setSubmitting(false);
    }
  }

  async function chooseAnotherUser() {
    setSwitchingUser(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = `/login?from=${encodeURIComponent(pathname || "/")}`;
    }
  }

  if (!shouldRenderModal) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Сессия заблокирована</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          Нет активности больше 3 минут. Введите 4-значный пароль аккаунта, чтобы продолжить.
        </p>

        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoFocus
            value={password}
            onChange={(e) => {
              const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 4);
              setPassword(digitsOnly);
              if (error) setError(null);
            }}
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-lg tracking-[0.35em] outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            placeholder="••••"
            autoComplete="current-password"
            disabled={submitting || switchingUser}
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting || switchingUser || password.length !== 4}
            className="w-full rounded-xl bg-amber-500 px-4 py-3 font-medium text-white transition hover:bg-amber-600 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            {submitting ? "Проверка..." : "Разблокировать"}
          </button>
          <button
            type="button"
            onClick={() => {
              void chooseAnotherUser();
            }}
            disabled={submitting || switchingUser}
            className="w-full rounded-xl border border-zinc-300 px-4 py-3 font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {switchingUser ? "Переход..." : "Выбрать другого пользователя"}
          </button>
        </form>
      </div>
    </div>
  );
}
