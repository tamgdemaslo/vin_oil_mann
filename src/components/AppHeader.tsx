"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { safeReadJson } from "@/lib/http-json";

type User = { login: string; name: string; role?: "owner" | "admin" | "master" } | null;
type CurrentShift = { id: string } | null;
type CurrentCashShift = { id: string; status: "open" | "closed" } | null;
type NavItem = { href: string; label: string; description?: string; disabled?: boolean };
type NavSection = { id: string; href: string; label: string; disabled?: boolean; items: NavItem[] };

const SHIFT_EVENT = "eco-shift-changed";

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function roleLabel(role?: "owner" | "admin" | "master") {
  if (role === "owner") return "Владелец";
  if (role === "admin") return "Администратор";
  return "Мастер";
}

export default function AppHeader() {
  const pathname = usePathname();
  const [user, setUser] = useState<User>(null);
  const [currentShift, setCurrentShift] = useState<CurrentShift>(null);
  const [currentCashShift, setCurrentCashShift] = useState<CurrentCashShift>(null);
  const [loading, setLoading] = useState(true);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const desktopNavRef = useRef<HTMLDivElement | null>(null);
  const mobileNavRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHeaderState() {
      setLoading(true);
      try {
        const [sessionRes, shiftRes, cashRes] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/shifts/current", { cache: "no-store" }),
          fetch("/api/cash", { cache: "no-store" }),
        ]);
        const sessionRaw = await safeReadJson<{ user?: User }>(sessionRes);
        const sessionData = sessionRaw ?? { user: undefined };
        const shiftData = shiftRes.ok ? (await safeReadJson<{ id: string }>(shiftRes)) ?? null : null;
        const cashData = cashRes.ok
          ? (await safeReadJson<{ shift?: CurrentCashShift }>(cashRes)) ?? null
          : null;
        if (cancelled) return;
        setUser(sessionData.user ?? null);
        setCurrentShift(shiftData ?? null);
        setCurrentCashShift(cashData?.shift ?? null);
      } catch {
        if (cancelled) return;
        setUser(null);
        setCurrentShift(null);
        setCurrentCashShift(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadHeaderState();
    const handleShiftChanged = () => {
      void loadHeaderState();
    };
    window.addEventListener(SHIFT_EVENT, handleShiftChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(SHIFT_EVENT, handleShiftChanged);
    };
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/";
  }

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openSection(sectionId: string) {
    clearCloseTimer();
    setOpenSectionId(sectionId);
  }

  function scheduleCloseSection(sectionId: string) {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpenSectionId((prev) => (prev === sectionId ? null : prev));
    }, 220);
  }

  const needsShift = !!user && (user.role === "admin" || user.role === "master");
  const hasAnyActiveShift = !!currentShift || currentCashShift?.status === "open";
  const locked = needsShift && !hasAnyActiveShift;
  const canAccessCash = user?.role === "owner" || user?.role === "admin";
  const canAccessCrm = user?.role === "owner" || user?.role === "admin";

  const navSections = useMemo<NavSection[]>(
    () =>
      [
        {
          id: "operations",
          href: "/shipment",
          label: "Операции",
          items: [
            {
              href: "/shipment",
              label: "Все отгрузки",
              description: "Журнал и поиск по документам.",
              disabled: locked,
            },
            {
              href: "/shipment/new",
              label: "Новая отгрузка",
              description: "Создание новой отгрузки.",
              disabled: locked,
            },
          ],
        },
        {
          id: "inventory",
          href: "/inventory",
          label: "Склад",
          items: [
            {
              href: "/inventory/products",
              label: "Товары",
              description: "Локальный справочник товаров и остатки.",
              disabled: locked,
            },
            {
              href: "/inventory/receipts",
              label: "Приёмка",
              description: "Поступление товаров на локальный склад.",
              disabled: locked,
            },
            {
              href: "/inventory/writeoffs",
              label: "Списание",
              description: "Списание товаров и корректировка остатков.",
              disabled: locked,
            },
            {
              href: "/inventory/restock",
              label: "Пополнение остатков",
              description: "Дефицит, расход и заказ поставщикам по локальной БД.",
              disabled: locked,
            },
          ],
        },
        {
          id: "finance",
          href: "/finance",
          label: "Финансы",
          items: [
            {
              href: "/cash#cash-state",
              label: "Касса",
              description: "Операции по кассе, закрытие кассовой смены и история.",
              disabled: locked || !canAccessCash,
            },
            {
              href: "/finance/invoices",
              label: "Счета поставщиков",
              description: "Счета, созданные из локальных приёмок.",
              disabled: locked,
            },
            {
              href: "/finance/profit",
              label: "Прибыль",
              description: "Маржа, себестоимость и прибыль по локальной базе.",
              disabled: locked,
            },
            {
              href: "/salary",
              label: "Зарплата",
              description: "Выплаты, ставки и правила сдельной части.",
              disabled: locked,
            },
            {
              href: "/finance/shifts",
              label: "Смены",
              description: "Рабочие дни и фактические смены сотрудников.",
              disabled: locked,
            },
          ],
        },
        {
          id: "crm",
          href: "/crm",
          label: "CRM",
          items: [
            {
              href: "/crm",
              label: "Дела клиентов",
              description: "Следующие действия, дедлайны и контроль.",
              disabled: !canAccessCrm,
            },
          ],
        },
        {
          id: "clients",
          href: "/clients",
          label: "Клиенты",
          items: [
            {
              href: "/clients/counterparties",
              label: "Контрагенты",
              description: "Клиенты, поставщики и компании в нашей БД.",
              disabled: locked,
            },
            {
              href: "/records",
              label: "Записи",
              description: "Создание, редактирование и удаление записей клиентов.",
              disabled: locked || !canAccessCash,
            },
          ],
        },
      ],
    [canAccessCash, canAccessCrm, locked]
  );

  useEffect(() => {
    setOpenSectionId(null);
    setProfileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const insideDesktop = desktopNavRef.current?.contains(target);
      const insideMobile = mobileNavRef.current?.contains(target);
      const insideProfile = profileRef.current?.contains(target);
      if (!insideDesktop && !insideMobile) {
        setOpenSectionId(null);
      }
      if (!insideProfile) {
        setProfileOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      clearCloseTimer();
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-300 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2.5 sm:px-6 lg:grid lg:grid-cols-[200px_minmax(0,1fr)_220px] lg:items-center lg:gap-6">
        <div className="flex items-center gap-6 lg:col-span-2">
          <Link href="/" className="shrink-0">
            <div className="text-base font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
              Там где масло.
            </div>
          </Link>
          {user && <span className="hidden h-6 w-px bg-zinc-200 dark:bg-zinc-800 lg:block" />}

          {user && (
            <div ref={desktopNavRef} className="hidden lg:flex lg:justify-center">
              <nav className="flex items-center gap-5" aria-label="Основная навигация">
                {navSections.map((section) => {
                  const sectionHasActiveItem = section.items.some((item) => {
                    const itemPath = item.href.split("#")[0];
                    return isActivePath(pathname, itemPath);
                  });
                  const active = sectionHasActiveItem || isActivePath(pathname, section.href);
                  const disabled = section.items.every((item) => !!item.disabled);
                  const open = openSectionId === section.id;
                  const triggerClass = disabled
                    ? "pointer-events-none text-zinc-400 dark:text-zinc-600"
                    : active || open
                      ? "bg-zinc-100/70 text-zinc-950 dark:bg-zinc-800/80 dark:text-zinc-50"
                      : "text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

                  return (
                    <div
                      key={section.id}
                      className="relative"
                      onMouseEnter={() => {
                        if (!disabled) openSection(section.id);
                      }}
                      onMouseLeave={() => {
                        if (!disabled) scheduleCloseSection(section.id);
                      }}
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        aria-expanded={open}
                        aria-haspopup="menu"
                        onClick={() => {
                          if (disabled) return;
                          if (open) {
                            clearCloseTimer();
                            setOpenSectionId(null);
                          } else {
                            openSection(section.id);
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-base font-medium transition ${triggerClass}`}
                      >
                        <span>{section.label}</span>
                        <svg
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                          className={`size-4 transition ${open ? "rotate-180" : ""}`}
                        >
                          <path
                            d="M5.5 7.5 10 12l4.5-4.5"
                            fill="none"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.7"
                          />
                        </svg>
                      </button>

                      {open && !disabled && (
                        <div
                          className="absolute left-1/2 top-[calc(100%+0.5rem)] z-50 w-72 -translate-x-1/2 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-[0_10px_24px_rgba(15,23,42,0.09)] dark:border-zinc-700 dark:bg-zinc-900"
                          onMouseEnter={() => openSection(section.id)}
                          onMouseLeave={() => scheduleCloseSection(section.id)}
                        >
                          <div className="mb-1 px-3 py-2">
                            <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                              {section.label}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            {section.items.map((item) => {
                              const itemPath = item.href.split("#")[0];
                              const itemActive = isActivePath(pathname, itemPath);
                              const itemDisabled = !!item.disabled;

                              if (itemDisabled) {
                                return (
                                  <div
                                    key={item.href}
                                    className="rounded-xl px-3 py-2.5 text-zinc-400 dark:text-zinc-600"
                                  >
                                    <div className="text-base font-medium">{item.label}</div>
                                    {item.description && (
                                      <div className="mt-0.5 text-sm">{item.description}</div>
                                    )}
                                  </div>
                                );
                              }

                              return (
                                <Link
                                  key={item.href}
                                  href={item.href}
                                  onClick={() => {
                                    clearCloseTimer();
                                    setOpenSectionId(null);
                                  }}
                                  className={`rounded-lg px-3 py-2.5 transition ${
                                    itemActive
                                      ? "bg-zinc-100 dark:bg-zinc-800"
                                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                                  }`}
                                >
                                  <div className="text-base font-medium text-zinc-900 dark:text-zinc-100">
                                    {item.label}
                                  </div>
                                  {item.description && (
                                    <div className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                                      {item.description}
                                    </div>
                                  )}
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            </div>
          )}
        </div>

        {loading ? (
          <span className="text-sm text-zinc-400 lg:col-start-3 lg:justify-self-end">Загрузка…</span>
        ) : user ? (
          <div ref={profileRef} className="relative lg:col-start-3 lg:flex lg:h-full lg:w-full lg:items-center lg:justify-end lg:justify-self-end lg:border-l lg:border-zinc-200/70 lg:pl-6 dark:lg:border-zinc-800/70">
            <button
              type="button"
              onClick={() => setProfileOpen((prev) => !prev)}
              className={`inline-flex items-center gap-3 rounded-lg px-3.5 py-2 text-sm transition ${
                profileOpen
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              }`}
              aria-expanded={profileOpen}
              aria-haspopup="menu"
            >
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                {(user.name || user.login || "U").trim().charAt(0).toUpperCase()}
              </span>
              <span className="whitespace-nowrap">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {user.name || user.login}
                </span>
                <span className="mx-1 text-zinc-300 dark:text-zinc-600">•</span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{roleLabel(user.role)}</span>
              </span>
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className={`ml-0.5 size-4 text-zinc-400 transition ${profileOpen ? "rotate-180" : ""}`}
              >
                <path
                  d="M5.5 7.5 10 12l4.5-4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
              </svg>
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-[calc(100%+0.45rem)] z-50 w-56 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.10)] dark:border-zinc-700 dark:bg-zinc-900">
                {(user?.role === "owner" || user?.role === "admin") && (
                  <Link
                    href="/cabinet/customer-analytics"
                    onClick={() => setProfileOpen(false)}
                    className={`mb-1 block rounded-lg px-3 py-2 text-sm transition ${
                      isActivePath(pathname, "/cabinet/customer-analytics")
                        ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                        : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                  >
                    Аналитика клиентов
                  </Link>
                )}
                <Link
                  href="/cabinet"
                  onClick={() => setProfileOpen(false)}
                  className={`block rounded-lg px-3 py-2 text-sm transition ${
                    isActivePath(pathname, "/cabinet")
                      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                      : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  }`}
                >
                  Кабинет
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="mt-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Выйти
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/login"
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700 lg:col-start-3 lg:justify-self-end"
          >
            Войти
          </Link>
        )}

        {user && (
          <div ref={mobileNavRef} className="border-t border-zinc-200 pt-3 dark:border-zinc-800 lg:hidden">
            <nav className="flex flex-wrap items-center gap-2" aria-label="Основная навигация">
              {navSections.map((section) => {
                const sectionHasActiveItem = section.items.some((item) => {
                  const itemPath = item.href.split("#")[0];
                  return isActivePath(pathname, itemPath);
                });
                const active = sectionHasActiveItem || isActivePath(pathname, section.href);
                const disabled = section.items.every((item) => !!item.disabled);
                const open = openSectionId === section.id;
                const triggerClass = disabled
                  ? "pointer-events-none border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600"
                  : active || open
                    ? "border-zinc-950 bg-zinc-950 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-50";

                return (
                  <div key={section.id} className="relative">
                    <button
                      type="button"
                      disabled={disabled}
                      aria-expanded={open}
                      aria-haspopup="menu"
                      onClick={() => {
                        if (disabled) return;
                        if (open) {
                          setOpenSectionId(null);
                        } else {
                          openSection(section.id);
                        }
                      }}
                      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${triggerClass}`}
                    >
                      <span>{section.label}</span>
                      <svg
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                        className={`size-4 transition ${open ? "rotate-180" : ""}`}
                      >
                        <path
                          d="M5.5 7.5 10 12l4.5-4.5"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.7"
                        />
                      </svg>
                    </button>

                    {open && !disabled && (
                      <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                        <div className="flex flex-col gap-1">
                          {section.items.map((item) => {
                            const itemPath = item.href.split("#")[0];
                            const itemActive = isActivePath(pathname, itemPath);
                            const itemDisabled = !!item.disabled;

                            if (itemDisabled) {
                              return (
                                <div
                                  key={item.href}
                                  className="rounded-xl px-3 py-2 text-zinc-400 dark:text-zinc-600"
                                >
                                  <div className="text-base font-medium">{item.label}</div>
                                  {item.description && (
                                    <div className="mt-0.5 text-sm">{item.description}</div>
                                  )}
                                </div>
                              );
                            }

                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setOpenSectionId(null)}
                                className={`rounded-xl px-3 py-2 transition ${
                                  itemActive
                                    ? "bg-zinc-100 dark:bg-zinc-800"
                                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                                }`}
                              >
                                <div className="text-base font-medium text-zinc-900 dark:text-zinc-100">
                                  {item.label}
                                </div>
                                {item.description && (
                                  <div className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                                    {item.description}
                                  </div>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>
        )}

        {user && locked && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            Для администратора и мастера рабочие разделы открываются после начала смены.
          </div>
        )}
      </div>
    </header>
  );
}
