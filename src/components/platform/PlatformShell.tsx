"use client";

import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Home,
  LogOut,
  Menu,
  PackageSearch,
  Search,
  Settings,
  UserRound,
  Warehouse,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { safeReadJson } from "@/lib/http-json";
import { EcoStatusDot } from "./EcoUI";

type PlatformUser = {
  login: string;
  name: string;
  role?: "owner" | "admin" | "master";
} | null;

type CurrentShift = {
  id: string;
  startedAt?: string;
  shiftDate?: string;
} | null;

type CurrentCashShift = {
  id: string;
  status: "open" | "closed";
  openedAt?: string;
} | null;

type PlatformNavItem = {
  href: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type PlatformNavSection = {
  id: string;
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  items: PlatformNavItem[];
};

const SHIFT_EVENT = "eco-shift-changed";

function isActivePath(pathname: string, href: string) {
  const cleanHref = href.split("#")[0] || "/";
  if (cleanHref === "/") return pathname === "/";
  return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

function roleLabel(role?: "owner" | "admin" | "master") {
  if (role === "owner") return "Владелец";
  if (role === "admin") return "Администратор";
  return "Мастер";
}

function userInitials(user: NonNullable<PlatformUser>) {
  const source = user.name || user.login;
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function compactUserName(user: NonNullable<PlatformUser>) {
  const source = user.name || user.login;
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}. ${parts[1]}`;
  return source;
}

function shouldHideShell(pathname: string) {
  if (pathname === "/login") return true;
  if (pathname === "/client-site") return true;
  if (pathname.startsWith("/report/")) return true;
  return /^\/shipment\/[^/]+\/(poster|tags)(?:\/)?$/.test(pathname);
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function routeContext(pathname: string) {
  if (pathname === "/") return { label: "Текущий раздел:", value: "Главная" };
  if (pathname.startsWith("/shipment/new")) return { label: "Текущий раздел:", value: "Новая отгрузка" };
  if (pathname.startsWith("/shipment")) return { label: "Текущий раздел:", value: "Отгрузки" };
  if (pathname.startsWith("/inventory")) return { label: "Текущий раздел:", value: "Склад" };
  if (pathname.startsWith("/cash") || pathname.startsWith("/finance") || pathname.startsWith("/salary")) {
    return { label: "Текущий раздел:", value: "Финансы" };
  }
  if (pathname.startsWith("/crm") || pathname.startsWith("/records") || pathname.startsWith("/clients")) {
    return { label: "Текущий раздел:", value: "CRM" };
  }
  if (pathname.startsWith("/cabinet")) return { label: "Текущий раздел:", value: "Кабинет" };
  return { label: "Текущий раздел:", value: pathname };
}

export default function PlatformShell() {
  const pathname = usePathname();
  const [user, setUser] = useState<PlatformUser>(null);
  const [currentShift, setCurrentShift] = useState<CurrentShift>(null);
  const [currentCashShift, setCurrentCashShift] = useState<CurrentCashShift>(null);
  const [loading, setLoading] = useState(true);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (shouldHideShell(pathname)) return;
    let cancelled = false;

    async function loadShellState() {
      setLoading(true);
      try {
        const [sessionRes, shiftRes, cashRes] = await Promise.all([
          fetch("/api/auth/session", { cache: "no-store" }),
          fetch("/api/shifts/current", { cache: "no-store" }),
          fetch("/api/cash", { cache: "no-store" }),
        ]);
        const sessionData = await safeReadJson<{ user?: PlatformUser }>(sessionRes);
        const shiftData = shiftRes.ok ? (await safeReadJson<NonNullable<CurrentShift>>(shiftRes)) ?? null : null;
        const cashData = cashRes.ok ? (await safeReadJson<{ shift?: CurrentCashShift }>(cashRes)) ?? null : null;
        if (cancelled) return;
        setUser(sessionData?.user ?? null);
        setCurrentShift(shiftData);
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

    void loadShellState();
    const handleShiftChanged = () => void loadShellState();
    window.addEventListener(SHIFT_EVENT, handleShiftChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(SHIFT_EVENT, handleShiftChanged);
    };
  }, [pathname]);

  useEffect(() => {
    setOpenSectionId(null);
    setProfileOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!shellRef.current?.contains(target)) {
        setOpenSectionId(null);
        setProfileOpen(false);
        setMobileOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const needsShift = !!user && (user.role === "admin" || user.role === "master");
  const hasAnyActiveShift = !!currentShift || currentCashShift?.status === "open";
  const locked = needsShift && !hasAnyActiveShift;
  const canAccessCash = user?.role === "owner" || user?.role === "admin";
  const canAccessCrm = user?.role === "owner" || user?.role === "admin";

  const navSections = useMemo<PlatformNavSection[]>(
    () => [
      {
        id: "home",
        href: "/",
        label: "Главная",
        icon: Home,
        items: [{ href: "/", label: "Сводка", description: "Статус смены и быстрый старт." }],
      },
      {
        id: "operations",
        href: "/shipment",
        label: "Операции",
        icon: BriefcaseBusiness,
        items: [
          { href: "/shipment", label: "Все отгрузки", description: "Журнал и поиск документов.", disabled: locked },
          { href: "/shipment/new", label: "Новая отгрузка", description: "Создание документа.", disabled: locked },
        ],
      },
      {
        id: "inventory",
        href: "/inventory/products",
        label: "Склад",
        icon: Warehouse,
        items: [
          { href: "/inventory/products", label: "Товары", description: "Карточки, остатки и фото.", disabled: locked },
          { href: "/inventory/receipts", label: "Приёмка", description: "Поступления на локальный склад.", disabled: locked },
          { href: "/inventory/writeoffs", label: "Списание", description: "Списания и корректировки.", disabled: locked },
          { href: "/inventory/restock", label: "Пополнение", description: "Дефицит и заказ поставщикам.", disabled: locked },
        ],
      },
      {
        id: "finance",
        href: "/cash",
        label: "Финансы",
        icon: CircleDollarSign,
        items: [
          { href: "/cash", label: "Касса", description: "Открытие, расходы и закрытие.", disabled: locked || !canAccessCash },
          { href: "/finance/invoices", label: "Счета поставщиков", description: "Документы из приёмок.", disabled: locked },
          { href: "/finance/profit", label: "Прибыль", description: "Маржа и себестоимость.", disabled: locked },
          { href: "/salary", label: "Зарплата", description: "Выплаты и правила.", disabled: locked },
        ],
      },
      {
        id: "crm",
        href: "/crm",
        label: "CRM",
        icon: CalendarDays,
        items: [
          { href: "/crm", label: "Воронка", description: "Сделки и лиды.", disabled: !canAccessCrm },
          { href: "/records", label: "Записи", description: "Журнал YCLIENTS.", disabled: locked || !canAccessCash },
          { href: "/clients/counterparties", label: "Клиенты", description: "Контрагенты и телефоны.", disabled: locked },
        ],
      },
      {
        id: "cabinet",
        href: "/cabinet",
        label: "Кабинет",
        icon: Settings,
        items: [
          { href: "/cabinet", label: "Профиль", description: "Смена пароля и личный блок." },
          { href: "/cabinet/shifts", label: "Смены", description: "История рабочих дней.", disabled: locked },
          { href: "/cabinet/customer-analytics", label: "Аналитика клиентов", description: "Повторы и прибыль.", disabled: !canAccessCrm },
          { href: "/cabinet/salary", label: "Зарплата", description: "Расчёты в кабинете.", disabled: locked },
        ],
      },
    ],
    [canAccessCash, canAccessCrm, locked]
  );

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/login";
  }

  if (shouldHideShell(pathname)) return null;

  const shiftLabel = loading
    ? "Проверяем смену"
    : hasAnyActiveShift
      ? currentShift
        ? `Рабочая смена активна${formatTime(currentShift.startedAt) ? ` с ${formatTime(currentShift.startedAt)}` : ""}`
        : `Кассовая смена активна${formatTime(currentCashShift?.openedAt) ? ` с ${formatTime(currentCashShift?.openedAt)}` : ""}`
      : "Смена не начата";
  const context = routeContext(pathname);

  return (
    <div ref={shellRef} className="platform-shell">
      <header className="platform-shell__main">
        <div className="platform-shell__brand-row">
          <Link href="/" className="platform-shell__brand" aria-label="Там где масло. Эко-платформа">
            <Image src="/brand/logo-wordmark-black.svg" alt="Там где масло." width={150} height={24} priority />
            <span>Эко-платформа</span>
          </Link>

          {user && (
            <button
              type="button"
              className="platform-shell__mobile-toggle"
              onClick={() => setMobileOpen((value) => !value)}
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? "Закрыть навигацию" : "Открыть навигацию"}
            >
              {mobileOpen ? <X aria-hidden className="eco-icon" /> : <Menu aria-hidden className="eco-icon" />}
            </button>
          )}
        </div>

        {user && (
          <nav className="platform-shell__nav" aria-label="Основная навигация">
            {navSections.map((section) => {
              const active = section.items.some((item) => isActivePath(pathname, item.href));
              const disabled = section.items.every((item) => !!item.disabled);
              const open = openSectionId === section.id;
              return (
                <div key={section.id} className="platform-shell__nav-item">
                  <button
                    type="button"
                    className={`platform-shell__nav-trigger ${active ? "is-active" : ""} ${open ? "is-open" : ""}`}
                    disabled={disabled}
                    onClick={() => setOpenSectionId(open ? null : section.id)}
                    aria-expanded={open}
                    aria-haspopup="menu"
                  >
                    <span>{section.label}</span>
                    <ChevronDown aria-hidden className="eco-icon platform-shell__chevron" />
                  </button>

                  {open && !disabled && (
                    <div className="platform-shell__dropdown" role="menu">
                      {section.items.map((item) =>
                        item.disabled ? (
                          <div key={item.href} className="platform-shell__dropdown-link is-disabled">
                            <span>{item.label}</span>
                            {item.description && <small>{item.description}</small>}
                          </div>
                        ) : (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={`platform-shell__dropdown-link ${isActivePath(pathname, item.href) ? "is-active" : ""}`}
                            role="menuitem"
                          >
                            <span>{item.label}</span>
                            {item.description && <small>{item.description}</small>}
                          </Link>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        )}

        <div className="platform-shell__actions">
          {loading ? (
            <span className="platform-shell__loading">Загрузка...</span>
          ) : user ? (
            <>
              <div className="platform-shell__search" aria-hidden>
                <Search className="eco-icon" />
                <input readOnly tabIndex={-1} placeholder="Товар, VIN, № отгрузки, клиент…" />
                <span className="platform-shell__search-kbd">⌘K</span>
              </div>
              <button type="button" className="platform-shell__icon-btn" aria-label="Уведомления">
                <Bell aria-hidden className="eco-icon" />
              </button>
              <div className="platform-shell__profile">
                <button
                  type="button"
                  className="platform-shell__profile-btn"
                  onClick={() => setProfileOpen((value) => !value)}
                  aria-expanded={profileOpen}
                  aria-haspopup="menu"
                >
                  <span className="platform-shell__avatar">{userInitials(user)}</span>
                  <span className="platform-shell__profile-copy">
                    <strong>{compactUserName(user)}</strong>
                    <small>{roleLabel(user.role)}</small>
                  </span>
                  <ChevronDown aria-hidden className="eco-icon platform-shell__chevron" />
                </button>

                {profileOpen && (
                  <div className="platform-shell__profile-menu" role="menu">
                    <Link href="/cabinet" className="platform-shell__dropdown-link" role="menuitem">
                      <UserRound aria-hidden className="eco-icon" />
                      <span>Кабинет</span>
                    </Link>
                    {canAccessCrm && (
                      <Link href="/cabinet/customer-analytics" className="platform-shell__dropdown-link" role="menuitem">
                        <PackageSearch aria-hidden className="eco-icon" />
                        <span>Аналитика клиентов</span>
                      </Link>
                    )}
                    <button type="button" className="platform-shell__dropdown-link danger" onClick={handleLogout} role="menuitem">
                      <LogOut aria-hidden className="eco-icon" />
                      <span>Выйти</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link href="/login" className="eco-btn eco-btn--primary eco-btn--sm">
              Войти
            </Link>
          )}
        </div>
      </header>

      {user && mobileOpen && (
        <nav className="platform-shell__mobile-panel" aria-label="Мобильная навигация">
          {navSections.flatMap((section) =>
            section.items.map((item) => (
              <Link
                key={`${section.id}-${item.href}`}
                href={item.href}
                className={`platform-shell__mobile-link ${item.disabled ? "is-disabled" : ""} ${
                  isActivePath(pathname, item.href) ? "is-active" : ""
                }`}
                aria-disabled={item.disabled}
              >
                <span>{item.label}</span>
                <small>{section.label}</small>
              </Link>
            ))
          )}
        </nav>
      )}

      {user && (
        <div className="platform-shell__substrip">
          <div className="platform-shell__shift">
            <EcoStatusDot tone={hasAnyActiveShift ? "success" : locked ? "warning" : "neutral"} pulse={hasAnyActiveShift} />
            <span>{shiftLabel}</span>
          </div>
          <span className="platform-shell__sub-sep" />
          <div className="platform-shell__sub-context">
            <span className="l-meta">{context.label}</span>
            <strong>{context.value}</strong>
          </div>
          <div className="grow" />
          {locked && <span className="platform-shell__lock-note">Рабочие разделы откроются после начала смены.</span>}
          <span className="platform-shell__version">internal · live data</span>
        </div>
      )}
    </div>
  );
}
