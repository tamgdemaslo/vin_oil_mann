"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type LoginUser = {
  login: string;
  name: string;
  role: "owner" | "admin" | "master";
};

function roleLabel(role: LoginUser["role"]) {
  if (role === "owner") return "Владелец";
  if (role === "admin") return "Администратор";
  return "Мастер";
}

function roleAccent(role: LoginUser["role"]) {
  if (role === "owner") {
    return {
      badge: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
      avatar: "from-amber-400 to-orange-500 text-white",
    };
  }
  if (role === "admin") {
    return {
      badge: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
      avatar: "from-sky-400 to-blue-500 text-white",
    };
  }
  return {
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    avatar: "from-emerald-400 to-teal-500 text-white",
  };
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/";
  const [users, setUsers] = useState<LoginUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedLogin, setSelectedLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selectedUser = useMemo(
    () => users.find((user) => user.login === selectedLogin) ?? null,
    [selectedLogin, users]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      setUsersLoading(true);
      try {
        const res = await fetch("/api/auth/users");
        const data = await res.json();
        if (cancelled) return;
        setUsers(Array.isArray(data?.users) ? data.users : []);
      } catch {
        if (!cancelled) setError("Не удалось загрузить список пользователей");
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    }

    void loadUsers();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedLogin || !password) {
      setError("Выберите пользователя и введите пароль");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: selectedLogin, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Ошибка входа");
        return;
      }
      router.push(from);
      router.refresh();
    } catch {
      setError("Ошибка соединения");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_transparent_34%),linear-gradient(to_bottom,_rgba(255,251,235,0.95),_rgba(244,244,245,0.92))] px-4 py-8 dark:bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.14),_transparent_30%),linear-gradient(to_bottom,_rgb(24,24,27),_rgb(9,9,11))]">
      <div className="w-full max-w-5xl">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90 dark:shadow-[0_24px_90px_rgba(0,0,0,0.35)]">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
            <div className="border-b border-zinc-200/70 p-6 dark:border-zinc-800 lg:border-b-0 lg:border-r lg:p-10">
              <div className="max-w-xl">
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-600 dark:text-amber-400">
                  Eco Platform
                </p>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-4xl">
                  Выберите профиль для входа
                </h1>
                <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
                  Быстрый вход для владельцев, администратора и мастера. Выберите сотрудника,
                  затем введите его личный пароль.
                </p>
              </div>

              <div className="mt-8 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Пользователи</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    {usersLoading ? "Загрузка…" : `${users.length} профиля`}
                  </p>
                </div>
              {usersLoading ? (
                <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
                  Загружаем пользователей…
                </div>
              ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                  {users.map((user) => {
                    const selected = user.login === selectedLogin;
                    const accent = roleAccent(user.role);
                    return (
                      <button
                        key={user.login}
                        type="button"
                        onClick={() => {
                          setSelectedLogin(user.login);
                          setError(null);
                        }}
                        className={`group rounded-[1.5rem] border p-5 text-left transition ${
                          selected
                            ? "border-amber-400 bg-amber-50/80 shadow-[0_16px_40px_rgba(245,158,11,0.12)] dark:border-amber-500 dark:bg-amber-950/20"
                            : "border-zinc-200 bg-white/80 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-[0_14px_32px_rgba(15,23,42,0.06)] dark:border-zinc-700 dark:bg-zinc-900/80 dark:hover:border-zinc-600"
                        }`}
                        disabled={loading}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-xl font-semibold shadow-sm ${accent.avatar}`}>
                            {user.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${accent.badge}`}
                          >
                            {roleLabel(user.role)}
                          </div>
                        </div>
                        <div className="mt-4">
                          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                            {user.name}
                          </div>
                          <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                            @{user.login}
                          </div>
                        </div>
                        <div className="mt-5 flex items-center justify-between text-sm">
                          <span className="text-zinc-500 dark:text-zinc-400">
                            {selected ? "Профиль выбран" : "Нажмите, чтобы выбрать"}
                          </span>
                          <span
                            className={`h-3.5 w-3.5 rounded-full border transition ${
                              selected
                                ? "border-amber-500 bg-amber-500"
                                : "border-zinc-300 bg-transparent dark:border-zinc-600"
                            }`}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            </div>

            <div className="bg-zinc-50/75 p-6 dark:bg-zinc-950/60 sm:p-8 lg:p-10">
              <form onSubmit={handleSubmit} className="flex h-full flex-col justify-between gap-6">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                    Авторизация
                  </p>
                  {selectedUser ? (
                    <div className="mt-5 rounded-[1.75rem] border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl font-semibold shadow-sm ${roleAccent(selectedUser.role).avatar}`}
                        >
                          {selectedUser.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                            {selectedUser.name}
                          </div>
                          <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                            {roleLabel(selectedUser.role)} · @{selectedUser.login}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-[1.75rem] border border-dashed border-zinc-300 bg-white/60 p-5 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
                      Сначала выберите профиль слева, затем введите пароль.
                    </div>
                  )}

                  <div className="mt-6">
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Пароль{selectedUser ? ` для ${selectedUser.name}` : ""}
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={selectedUser ? "Введите пароль" : "Выберите пользователя"}
                      className="mt-2 w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-zinc-600 dark:bg-zinc-900"
                      autoComplete="current-password"
                      required
                      disabled={loading || usersLoading}
                    />
                  </div>

                  {error && (
                    <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
                  )}
                </div>

                <div className="space-y-4">
                  <button
                    type="submit"
                    disabled={loading || usersLoading || !selectedLogin}
                    className="w-full rounded-2xl bg-amber-500 px-4 py-3 text-base font-medium text-white transition hover:bg-amber-600 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-700"
                  >
                    {loading ? "Вход…" : selectedUser ? `Войти как ${selectedUser.name}` : "Войти"}
                  </button>
                  <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
                    <Link href="/" className="text-amber-600 hover:underline dark:text-amber-400">
                      ← На главную
                    </Link>
                  </p>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-amber-50/80 to-zinc-100 dark:from-zinc-900 dark:to-zinc-800">
        <div className="text-zinc-500">Загрузка…</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
