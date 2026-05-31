"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";

type LoginUser = {
  login: string;
  name: string;
  role: "owner" | "admin" | "master";
  locked?: boolean;
  lockedReason?: string;
};

function roleLabel(role: LoginUser["role"]) {
  if (role === "owner") return "Владелец";
  if (role === "admin") return "Администратор";
  return "Мастер";
}

function roleAccent(role: LoginUser["role"]) {
  if (role === "owner") {
    return {
      badge: "border-amber-300/30 bg-amber-300/10 text-amber-100",
      avatar: "from-amber-300 to-orange-500 text-zinc-950",
    };
  }
  if (role === "admin") {
    return {
      badge: "border-sky-300/30 bg-sky-300/10 text-sky-100",
      avatar: "from-sky-300 to-blue-500 text-zinc-950",
    };
  }
  return {
    badge: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
    avatar: "from-emerald-300 to-teal-500 text-zinc-950",
  };
}

function profileInitial(user: LoginUser) {
  return (user.name || user.login || "П").trim().slice(0, 1).toUpperCase();
}

function profileCountLabel(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} профилей`;
  if (last === 1) return `${count} профиль`;
  if (last >= 2 && last <= 4) return `${count} профиля`;
  return `${count} профилей`;
}

function sanitizeInternalPath(raw: string): string {
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("://")) return "/";
  return s;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = sanitizeInternalPath(searchParams.get("from") ?? "/");
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const profileButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [users, setUsers] = useState<LoginUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedLogin, setSelectedLogin] = useState("");
  const [profileQuery, setProfileQuery] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [lastLogin, setLastLogin] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedUser = useMemo(
    () => users.find((user) => user.login === selectedLogin) ?? null,
    [selectedLogin, users]
  );
  const selectedUserLocked = Boolean(selectedUser?.locked);
  const filteredUsers = useMemo(() => {
    const query = profileQuery.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => {
      return (
        user.name.toLowerCase().includes(query) ||
        user.login.toLowerCase().includes(query) ||
        roleLabel(user.role).toLowerCase().includes(query)
      );
    });
  }, [profileQuery, users]);
  const isSubmitReady = Boolean(
    selectedUser && !selectedUserLocked && password.trim() && !usersLoading && !usersError
  );
  const canSubmit = isSubmitReady && !loading;
  const shouldShowProfileSearch = users.length > 4;

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await fetch("/api/auth/users", { cache: "no-store" });
      if (!res.ok) throw new Error("load-users");
      const data = await res.json();
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch {
      setUsers([]);
      setUsersError("Не удалось загрузить профили");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    try {
      setLastLogin(window.localStorage.getItem("eco-last-login"));
    } catch {
      setLastLogin(null);
    }
  }, []);

  useEffect(() => {
    if (!selectedLogin || usersLoading || users.length === 0) return;
    if (!users.some((user) => user.login === selectedLogin)) {
      setSelectedLogin("");
      setPassword("");
    }
  }, [selectedLogin, users, usersLoading]);

  function focusPassword() {
    requestAnimationFrame(() => {
      passwordRef.current?.focus();
    });
  }

  function selectProfile(user: LoginUser, options?: { focusPassword?: boolean }) {
    if (loading) return;
    if (selectedLogin !== user.login) setPassword("");
    setSelectedLogin(user.login);
    setAuthError(null);
    if (!user.locked && (options?.focusPassword ?? true)) focusPassword();
  }

  function handleProfileKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const isNext = e.key === "ArrowDown" || e.key === "ArrowRight";
    const isPrev = e.key === "ArrowUp" || e.key === "ArrowLeft";
    if (!isNext && !isPrev) return;
    e.preventDefault();
    if (filteredUsers.length === 0) return;
    const nextIndex = isNext
      ? (index + 1) % filteredUsers.length
      : (index - 1 + filteredUsers.length) % filteredUsers.length;
    const nextUser = filteredUsers[nextIndex];
    selectProfile(nextUser, { focusPassword: false });
    profileButtonRefs.current[nextUser.login]?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    if (!selectedUser) {
      setAuthError("Сначала выберите профиль слева.");
      return;
    }
    if (selectedUserLocked) {
      setAuthError("Профиль временно заблокирован. Выберите другого пользователя или обратитесь к администратору.");
      return;
    }
    if (!password.trim()) {
      setAuthError("Введите пароль.");
      focusPassword();
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
        setAuthError(
          res.status === 401
            ? "Неверный пароль. Попробуйте ещё раз."
            : data.error ?? "Не удалось войти. Попробуйте ещё раз."
        );
        if (res.status === 401) setPassword("");
        focusPassword();
        return;
      }
      try {
        window.localStorage.setItem("eco-last-login", selectedLogin);
      } catch {
        // The login itself is non-sensitive; failure to remember it should not block auth.
      }
      router.push(from);
      router.refresh();
    } catch {
      setAuthError("Ошибка соединения. Проверьте сеть и попробуйте ещё раз.");
      focusPassword();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#08090b] bg-[radial-gradient(circle_at_50%_-10%,_rgba(245,158,11,0.22),_transparent_34%),linear-gradient(145deg,_#111318_0%,_#08090b_54%,_#14100b_100%)] px-[16px] py-[24px] text-zinc-100 sm:px-[24px] lg:py-[40px]">
      <div className="w-full max-w-[1120px]">
        <div className="overflow-hidden rounded-[8px] border border-white/10 bg-[#121316]/95 shadow-[0_24px_90px_rgba(0,0,0,0.48)] backdrop-blur">
          <div className="grid lg:grid-cols-[minmax(0,1.12fr)_minmax(380px,0.88fr)]">
            <div className="border-b border-white/10 p-[24px] sm:p-[32px] lg:border-b-0 lg:border-r lg:p-[34px]">
              <div className="max-w-[560px]">
                <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                  Эко-платформа
                </p>
                <h1 className="mt-[18px] !text-[38px] font-semibold !leading-[44px] tracking-tight text-white sm:!text-[40px] sm:!leading-[46px] 2xl:!text-[44px] 2xl:!leading-[50px]">
                  Выберите профиль для входа
                </h1>
                <p className="mt-[14px] text-[16px] leading-[26px] text-zinc-300">
                  Выберите сотрудника, затем введите личный пароль или PIN-код.
                </p>
              </div>

              <div className="mt-[30px] space-y-[14px]">
                <div className="flex flex-wrap items-center justify-between gap-[12px]">
                  <p className="text-[16px] font-semibold text-white">Профили сотрудников</p>
                  <p className="rounded-full border border-white/10 bg-white/[0.06] px-[12px] py-[5px] text-[14px] text-zinc-300">
                    {usersLoading ? "Загрузка..." : profileCountLabel(users.length)}
                  </p>
                </div>

                {shouldShowProfileSearch && (
                  <label className="relative block">
                    <span className="sr-only">Найти сотрудника</span>
                    <Search
                      className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                      aria-hidden="true"
                    />
                    <input
                      value={profileQuery}
                      onChange={(e) => setProfileQuery(e.target.value)}
                      placeholder="Найти сотрудника..."
                      className="h-[48px] w-full rounded-[8px] border border-white/10 bg-white/[0.06] pl-[44px] pr-[16px] !text-[16px] text-white outline-none transition placeholder:text-zinc-500 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
                    />
                  </label>
                )}

                {usersLoading ? (
                  <div className="grid gap-[10px] md:grid-cols-2" aria-label="Загружаем список профилей">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div
                        key={index}
                        className="min-h-[156px] animate-pulse rounded-[8px] border border-white/10 bg-white/[0.055] p-[16px]"
                      >
                        <div className="flex items-start justify-between gap-[12px]">
                          <div className="h-[56px] w-[56px] rounded-[8px] bg-white/10" />
                          <div className="h-7 w-24 rounded-full bg-white/10" />
                        </div>
                        <div className="mt-5 h-5 w-2/3 rounded bg-white/10" />
                        <div className="mt-3 h-4 w-1/2 rounded bg-white/10" />
                        <div className="mt-6 h-4 w-full rounded bg-white/10" />
                      </div>
                    ))}
                  </div>
                ) : usersError ? (
                  <div className="rounded-[8px] border border-red-400/25 bg-red-950/20 p-[20px]">
                    <div className="flex gap-[12px]">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden="true" />
                      <div>
                        <p className="text-[16px] font-semibold text-red-100">Не удалось загрузить профили</p>
                        <p className="mt-[6px] text-[14px] leading-[22px] text-red-100/75">
                          Проверьте подключение и попробуйте ещё раз.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadUsers()}
                      className="mt-[16px] inline-flex h-[40px] items-center gap-[8px] rounded-[8px] border border-red-300/30 px-[16px] !text-[14px] font-semibold text-red-100 transition hover:bg-red-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      Повторить
                    </button>
                  </div>
                ) : users.length === 0 ? (
                  <div className="rounded-[8px] border border-dashed border-white/20 bg-white/[0.04] p-[24px]">
                    <p className="text-[16px] font-semibold text-white">Профили не найдены</p>
                    <p className="mt-[8px] text-[14px] leading-[22px] text-zinc-400">
                      Добавьте сотрудников в настройках или обратитесь к администратору.
                    </p>
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="rounded-[8px] border border-dashed border-white/20 bg-white/[0.04] p-[24px]">
                    <p className="text-[16px] font-semibold text-white">Сотрудники не найдены</p>
                    <p className="mt-[8px] text-[14px] leading-[22px] text-zinc-400">
                      Измените запрос или очистите поиск.
                    </p>
                  </div>
                ) : (
                  <div
                    role="listbox"
                    aria-label="Профили для входа"
                    className={shouldShowProfileSearch ? "max-h-[520px] overflow-y-auto pr-1" : ""}
                  >
                    <div className="grid gap-[10px] md:grid-cols-2">
                      {filteredUsers.map((user, index) => {
                        const selected = user.login === selectedLogin;
                        const accent = roleAccent(user.role);
                        const isLastLogin = lastLogin === user.login;
                        return (
                          <button
                            key={user.login}
                            ref={(node) => {
                              profileButtonRefs.current[user.login] = node;
                            }}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            aria-label={`${user.name}, ${roleLabel(user.role)}, @${user.login}`}
                            onClick={() => selectProfile(user)}
                            onKeyDown={(e) => handleProfileKeyDown(e, index)}
                            className={`group relative min-h-[156px] rounded-[8px] border p-[16px] text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
                              selected
                                ? "border-amber-300 bg-amber-400/10 shadow-[0_0_0_1px_rgba(251,191,36,0.35),0_18px_52px_rgba(245,158,11,0.16)]"
                                : "border-white/10 bg-white/[0.055] hover:border-white/25 hover:bg-white/[0.08]"
                            } ${loading ? "cursor-wait opacity-70" : ""}`}
                            disabled={loading}
                          >
                            <span
                              className={`absolute right-[16px] top-[16px] flex h-[28px] w-[28px] items-center justify-center rounded-full border transition ${
                                selected
                                  ? "border-amber-300 bg-amber-400 text-zinc-950"
                                  : "border-white/20 bg-black/20 text-transparent group-hover:border-white/30"
                              }`}
                              aria-hidden="true"
                            >
                              <Check className="h-4 w-4" />
                            </span>
                            <div className="flex items-start gap-[14px] pr-[40px]">
                              <div
                                className={`flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-br text-[20px] font-bold shadow-sm ${accent.avatar}`}
                              >
                                {profileInitial(user)}
                              </div>
                              <div className="min-w-0">
                                <div className="break-words text-[18px] font-semibold leading-[22px] text-white">
                                  {user.name}
                                </div>
                                <div className="mt-[5px] break-all text-[14px] leading-[18px] text-zinc-400">@{user.login}</div>
                              </div>
                            </div>
                            <div className="mt-[16px] flex flex-wrap items-center gap-[8px]">
                              <span
                                className={`inline-flex items-center rounded-full border px-[10px] py-[4px] text-[12px] font-semibold ${accent.badge}`}
                              >
                                {roleLabel(user.role)}
                              </span>
                              {isLastLogin && (
                                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-[10px] py-[4px] text-[12px] font-semibold text-zinc-300">
                                  Последний вход
                                </span>
                              )}
                              {user.locked && (
                                <span className="inline-flex items-center rounded-full border border-red-300/30 bg-red-300/10 px-[10px] py-[4px] text-[12px] font-semibold text-red-100">
                                  Заблокирован
                                </span>
                              )}
                            </div>
                            <div className={`mt-[16px] text-[14px] ${selected ? "text-amber-100" : "text-zinc-500"}`}>
                              {selected ? "Сейчас выбран" : "Нажмите, чтобы выбрать"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-black/20 p-[24px] sm:p-[32px] lg:p-[34px]">
              <form onSubmit={handleSubmit} className="flex h-full min-h-[520px] flex-col justify-between gap-[32px] lg:min-h-0">
                <div>
                  <div className="flex items-center gap-[12px]">
                    <div className="flex h-[44px] w-[44px] items-center justify-center rounded-[8px] border border-amber-300/20 bg-amber-300/10 text-amber-200">
                      <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-amber-200/90">
                        Авторизация
                      </p>
                      <p className="mt-[4px] text-[14px] text-zinc-400">
                        {selectedUser ? "Профиль выбран" : "Сначала выберите профиль слева"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-[32px] min-h-[112px] border-y border-white/10 py-[20px]">
                    {selectedUser ? (
                      <div className="flex items-center gap-[16px]">
                        <div
                          className={`flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-br text-[24px] font-bold shadow-sm ${roleAccent(selectedUser.role).avatar}`}
                        >
                          {profileInitial(selectedUser)}
                        </div>
                        <div className="min-w-0">
                          <div className="break-words text-[24px] font-semibold leading-[30px] tracking-tight text-white">
                            {selectedUser.name}
                          </div>
                          <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
                            <span
                              className={`inline-flex items-center rounded-full border px-[10px] py-[4px] text-[12px] font-semibold ${roleAccent(selectedUser.role).badge}`}
                            >
                              {roleLabel(selectedUser.role)}
                            </span>
                            <span className="break-all text-[14px] text-zinc-400">@{selectedUser.login}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-[72px] items-center rounded-[8px] border border-dashed border-white/20 bg-white/[0.035] px-[16px] text-[16px] text-zinc-300">
                        Сначала выберите профиль слева
                      </div>
                    )}
                  </div>

                  {selectedUserLocked && (
                    <div className="mt-[20px] rounded-[8px] border border-red-300/25 bg-red-950/20 p-[16px] text-[14px] leading-[22px] text-red-100">
                      <p className="font-semibold">Профиль временно заблокирован</p>
                      <p className="mt-1 text-red-100/75">
                        {selectedUser?.lockedReason ||
                          "Выберите другого пользователя или обратитесь к администратору."}
                      </p>
                    </div>
                  )}

                  <div className="mt-[28px]">
                    <label htmlFor="password" className="block text-[16px] font-semibold text-white">
                      Пароль
                    </label>
                    <p id="login-hint" className="mt-[8px] text-[14px] leading-[22px] text-zinc-400">
                      {selectedUser ? "Введите пароль доступа." : "Поле станет доступно после выбора профиля."}
                    </p>
                    <div className="relative mt-[12px]">
                      <input
                        ref={passwordRef}
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (authError) setAuthError(null);
                        }}
                        placeholder={selectedUser ? "Введите пароль" : "Сначала выберите профиль"}
                        className={`h-[52px] w-full rounded-[8px] border bg-white/[0.07] px-[16px] pr-[48px] !text-[16px] text-white outline-none transition placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.035] disabled:text-zinc-500 ${
                          authError
                            ? "border-red-300/70 focus:border-red-300 focus:ring-2 focus:ring-red-300/20"
                            : "border-white/20 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
                        }`}
                        autoComplete="current-password"
                        aria-invalid={Boolean(authError)}
                        aria-describedby={authError ? "login-error login-hint" : "login-hint"}
                        required={Boolean(selectedUser)}
                        disabled={
                          !selectedUser || selectedUserLocked || loading || usersLoading || Boolean(usersError)
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        disabled={
                          !selectedUser || selectedUserLocked || loading || usersLoading || Boolean(usersError)
                        }
                        aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                        className="absolute right-[12px] top-1/2 flex h-[32px] w-[32px] -translate-y-1/2 items-center justify-center rounded-[8px] text-zinc-400 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:pointer-events-none disabled:opacity-35"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    {authError && (
                      <p id="login-error" className="mt-[12px] flex gap-[8px] text-[14px] leading-[22px] text-red-200" role="alert">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{authError}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-[16px]">
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className={`flex h-[52px] w-full items-center justify-center gap-[8px] rounded-[8px] px-[16px] !text-[16px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
                      isSubmitReady
                        ? "bg-amber-400 text-zinc-950 shadow-[0_16px_36px_rgba(245,158,11,0.22)] hover:bg-amber-300"
                        : "cursor-not-allowed border border-white/10 bg-white/[0.055] text-zinc-500"
                    }`}
                  >
                    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {loading ? "Входим..." : "Войти в платформу"}
                  </button>
                  <p className="text-center text-[14px] leading-[22px] text-zinc-400">
                    {selectedUser
                      ? "После входа откроется рабочая область."
                      : "Выберите профиль и введите пароль, чтобы продолжить."}
                  </p>
                  <p className="text-center">
                    <Link
                      href="/"
                      className="inline-flex items-center gap-[6px] rounded-[8px] px-[12px] py-[8px] text-[14px] font-semibold text-zinc-300 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      Вернуться на главную
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
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#08090b] text-zinc-300">
          <div>Загрузка...</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
