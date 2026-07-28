"use client";

import {
  Bell,
  Bot,
  BriefcaseBusiness,
  Building2,
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
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { MessengerTopbarButton } from "@/components/messenger/MessengerUi";
import { formatServiceTime } from "@/lib/date-time";
import { safeReadJson } from "@/lib/http-json";
import { EcoStatusDot } from "./EcoUI";

type PlatformUser = {
  login: string;
  name: string;
  role?: "owner" | "admin" | "master";
} | null;

type PlatformPermissions = {
  canManageOrganizations?: boolean;
  canViewWarehouseAnalytics?: boolean;
};

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

type NotificationCounts = {
  total: number;
  urgent: number;
  today: number;
  soon: number;
  info: number;
};

type ShellBranch = {
  id: string;
  name: string;
  shortName: string;
  status: string;
};

type ShellBranchContext = {
  mode: "branch" | "all";
  activeBranchId: string;
  activeBranch: ShellBranch | null;
  branches: ShellBranch[];
  groupRole: string | null;
  branchRole: string | null;
  canManageBranches: boolean;
};

type DeadlineNotification = {
  id: string;
  caseId: string;
  type: "deadline_soon" | "due_now" | "overdue_repeat";
  urgency: "overdue" | "next_hour" | "today" | "info";
  title: string;
  body: string;
  href: string;
  phone: string | null;
  sentAt: string;
};

type DeadlineNotificationCounts = {
  total: number;
  overdue: number;
  next_hour: number;
  today: number;
  info: number;
};

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
  const formatted = formatServiceTime(value);
  return formatted === "—" ? "" : formatted;
}

function routeContext(pathname: string) {
  if (pathname === "/") return { label: "Текущий раздел:", value: "Главная" };
  if (pathname.startsWith("/shipment/new")) return { label: "Текущий раздел:", value: "Новая отгрузка" };
  if (pathname.startsWith("/shipment")) return { label: "Текущий раздел:", value: "Отгрузки" };
  if (pathname.startsWith("/inventory") || pathname.startsWith("/warehouse")) return { label: "Текущий раздел:", value: "Склад" };
  if (pathname.startsWith("/messages")) return { label: "Текущий раздел:", value: "Сообщения" };
  if (pathname.startsWith("/notifications")) return { label: "Текущий раздел:", value: "Уведомления" };
  if (pathname.startsWith("/cash") || pathname.startsWith("/finance") || pathname.startsWith("/salary")) {
    return { label: "Текущий раздел:", value: "Финансы" };
  }
  if (pathname.startsWith("/ai-assistant")) return { label: "Текущий раздел:", value: "ИИ-помощник" };
  if (pathname.startsWith("/crm") || pathname.startsWith("/records") || pathname.startsWith("/clients")) {
    return { label: "Текущий раздел:", value: "CRM" };
  }
  if (pathname.startsWith("/cabinet")) return { label: "Текущий раздел:", value: "Кабинет" };
  return { label: "Текущий раздел:", value: pathname };
}

export default function PlatformShell() {
  const pathname = usePathname();
  const [user, setUser] = useState<PlatformUser>(null);
  const [permissions, setPermissions] = useState<PlatformPermissions>({});
  const [currentShift, setCurrentShift] = useState<CurrentShift>(null);
  const [currentCashShift, setCurrentCashShift] = useState<CurrentCashShift>(null);
  const [branches, setBranches] = useState<ShellBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [canViewAllBranches, setCanViewAllBranches] = useState(false);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const [notificationCounts, setNotificationCounts] = useState<NotificationCounts | null>(null);
  const [deadlineCounts, setDeadlineCounts] = useState<DeadlineNotificationCounts | null>(null);
  const [deadlineToast, setDeadlineToast] = useState<DeadlineNotification | null>(null);
  const [deadlineExpanded, setDeadlineExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const browserPushSeenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (shouldHideShell(pathname)) return;
    let cancelled = false;

    async function loadShellState() {
      setLoading(true);
      try {
        const [sessionRes, shiftRes, cashRes, dashboardRes] = await Promise.all([
          fetch("/api/auth/session", { cache: "no-store" }),
          fetch("/api/shifts/current", { cache: "no-store" }),
          fetch("/api/cash", { cache: "no-store" }),
          fetch("/api/dashboard/operations", { cache: "no-store" }),
        ]);
        const sessionData = await safeReadJson<{
          user?: PlatformUser;
          permissions?: PlatformPermissions;
          branchContext?: ShellBranchContext | null;
        }>(sessionRes);
        const shiftData = shiftRes.ok ? (await safeReadJson<NonNullable<CurrentShift>>(shiftRes)) ?? null : null;
        const cashData = cashRes.ok ? (await safeReadJson<{ shift?: CurrentCashShift }>(cashRes)) ?? null : null;
        const dashboardData = dashboardRes.ok
          ? (await safeReadJson<{ notificationCounts?: NotificationCounts }>(dashboardRes)) ?? null
          : null;
        if (cancelled) return;
        setUser(sessionData?.user ?? null);
        setPermissions(sessionData?.permissions ?? {});
        setCurrentShift(shiftData);
        setCurrentCashShift(cashData?.shift ?? null);
        setNotificationCounts(dashboardData?.notificationCounts ?? null);
        const branchContext = sessionData?.branchContext ?? null;
        setBranches(branchContext?.branches ?? []);
        setSelectedBranchId(branchContext?.activeBranchId ?? "");
        setCanViewAllBranches(Boolean(branchContext?.groupRole));
      } catch {
        if (cancelled) return;
        setUser(null);
        setPermissions({});
        setCurrentShift(null);
        setCurrentCashShift(null);
        setNotificationCounts(null);
        setBranches([]);
        setSelectedBranchId("");
        setCanViewAllBranches(false);
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

  const loadDeadlineNotifications = useCallback(async () => {
    if (shouldHideShell(pathname)) return;
    const res = await fetch("/api/crm/deadline-notifications", { cache: "no-store" });
    if (!res.ok) return;
    const data = await safeReadJson<{
      notifications?: DeadlineNotification[];
      notificationCounts?: DeadlineNotificationCounts;
    }>(res);
    const notifications = data?.notifications ?? [];
    setDeadlineCounts(data?.notificationCounts ?? null);
    const top = notifications[0] ?? null;
    setDeadlineToast(top);

    if (!top || typeof window === "undefined" || !("Notification" in window)) return;
    const browserPushEnabled = window.localStorage.getItem("eco-crm-browser-push") !== "off";
    const pushKey = `${top.id}:${top.sentAt}`;
    if (!browserPushEnabled || Notification.permission !== "granted" || browserPushSeenRef.current.has(pushKey)) return;
    browserPushSeenRef.current.add(pushKey);
    try {
      const notification = new Notification(top.title, {
        body: top.body,
        tag: `crm-case-${top.caseId}`,
        requireInteraction: top.urgency === "overdue",
      });
      notification.onclick = () => {
        window.focus();
        window.location.href = top.href;
      };
      void fetch("/api/crm/deadline-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "browser_push", caseId: top.caseId, type: top.type, status: "sent" }),
      });
    } catch (error) {
      void fetch("/api/crm/deadline-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "browser_push",
          caseId: top.caseId,
          type: top.type,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "browser push failed",
        }),
      });
    }
  }, [pathname]);

  useEffect(() => {
    if (shouldHideShell(pathname)) return;
    void loadDeadlineNotifications();
    const timer = window.setInterval(() => void loadDeadlineNotifications(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadDeadlineNotifications, pathname]);

  useEffect(() => {
    setDeadlineExpanded(false);
  }, [deadlineToast?.id]);

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
  const allBranchesMode = selectedBranchId === "all";
  const locked = needsShift && !hasAnyActiveShift;
  const operationalLocked = locked || allBranchesMode;
  const canAccessCash = user?.role === "owner" || user?.role === "admin";
  const canAccessCrm = user?.role === "owner" || user?.role === "admin";
  const canManageIntegrations = user?.role === "owner" || user?.role === "admin";
  const canManageOrganizations = Boolean(permissions.canManageOrganizations);
  const canViewWarehouseAnalytics = Boolean(permissions.canViewWarehouseAnalytics);

  const navSections = useMemo<PlatformNavSection[]>(
    () => [
      {
        id: "home",
        href: allBranchesMode ? "/owner" : "/",
        label: "Главная",
        icon: Home,
        items: allBranchesMode
          ? [{ href: "/owner", label: "Все филиалы", description: "Агрегированная сводка без операционных действий." }]
          : [{ href: "/", label: "Сводка", description: "Статус смены и быстрый старт." }],
      },
      {
        id: "operations",
        href: "/shipment",
        label: "Операции",
        icon: BriefcaseBusiness,
        items: [
          { href: "/shipment", label: "Все отгрузки", description: "Журнал и поиск документов.", disabled: operationalLocked },
          { href: "/shipment/new", label: "Новая отгрузка", description: "Создание документа.", disabled: operationalLocked },
        ],
      },
      {
        id: "inventory",
        href: "/inventory/products",
        label: "Склад",
        icon: Warehouse,
        items: [
          { href: "/inventory/products", label: "Товары", description: "Карточки, остатки и фото.", disabled: operationalLocked },
          { href: "/warehouse/product-analytics", label: "Аналитика товаров", description: "Продажи, маржа и неликвид.", disabled: operationalLocked || !canViewWarehouseAnalytics },
          { href: "/warehouse/inventory", label: "Инвентаризация", description: "Сверка фактических остатков.", disabled: operationalLocked },
          { href: "/inventory/receipts", label: "Приёмка", description: "Поступления на локальный склад.", disabled: operationalLocked },
          { href: "/inventory/writeoffs", label: "Корректировки", description: "Списания и технические корректировки.", disabled: operationalLocked },
          { href: "/inventory/restock", label: "Пополнение", description: "Дефицит и заказ поставщикам.", disabled: operationalLocked },
        ],
      },
      {
        id: "finance",
        href: "/finance",
        label: "Финансы",
        icon: CircleDollarSign,
        items: [
          { href: "/finance", label: "Финансовый центр", description: "P&L, cashflow, расходы, план/факт.", disabled: operationalLocked },
          { href: "/cash", label: "Касса", description: "Кассовая смена, расходы и закрытие.", disabled: operationalLocked || !canAccessCash },
          { href: "/finance/invoices", label: "Счета поставщиков", description: "Документы из приёмок.", disabled: operationalLocked },
          { href: "/finance/profit", label: "Цены и прибыль", description: "Детализация по товарам и документам.", disabled: operationalLocked },
          { href: "/salary", label: "Зарплата", description: "Выплаты и правила.", disabled: operationalLocked },
        ],
      },
      {
        id: "crm",
        href: "/crm",
        label: "CRM",
        icon: CalendarDays,
        items: [
          { href: "/crm", label: "Дела клиентов", description: "Следующие действия и контроль.", disabled: operationalLocked || !canAccessCrm },
          { href: "/messages", label: "Сообщения", description: "Единый центр переписок.", disabled: operationalLocked || !canAccessCrm },
          { href: "/records", label: "Записи", description: "Журнал YCLIENTS.", disabled: operationalLocked || !canAccessCash },
          { href: "/clients/counterparties", label: "Клиенты", description: "Контрагенты и телефоны.", disabled: operationalLocked },
        ],
      },
      ...(canAccessCrm
        ? [{
            id: "ai-assistant",
            href: "/ai-assistant",
            label: "ИИ-помощник",
            icon: Bot,
            items: [
              { href: "/ai-assistant", label: "Рабочий чат", description: "Внутренний поиск и расчёты без действий от имени клиента.", disabled: allBranchesMode },
              { href: "/cabinet/ai-assistant", label: "Настройки", description: "Доступ и границы внутреннего режима." },
            ],
          }]
        : []),
      {
        id: "cabinet",
        href: "/cabinet",
        label: "Кабинет",
        icon: Settings,
        items: [
          { href: "/cabinet", label: "Профиль", description: "Смена пароля и личный блок." },
          {
            href: "/cabinet/branches",
            label: "Филиалы",
            description: "Точки, реквизиты и доступ сотрудников.",
            disabled: !canManageOrganizations,
          },
          { href: "/cabinet/customer-analytics", label: "Аналитика клиентов", description: "Повторы и прибыль.", disabled: !canAccessCrm },
          { href: "/cabinet/ai-assistant", label: "ИИ-помощник", description: "Внутренний режим и доступы.", disabled: !canManageIntegrations },
          {
            href: "/cabinet/integrations",
            label: "Интеграции",
            description: "Статусы и ручные запуски.",
            disabled: !canManageIntegrations,
          },
          {
            href: "/cabinet/integrations/messenger",
            label: "Мессенджеры",
            description: "Telegram webhook и каналы.",
            disabled: !canManageIntegrations,
          },
        ],
      },
    ],
    [allBranchesMode, canAccessCash, canAccessCrm, canManageIntegrations, canManageOrganizations, canViewWarehouseAnalytics, operationalLocked]
  );

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/login";
  }

  async function handleBranchChange(id: string) {
    if (!id || id === selectedBranchId || branchSwitching) return;
    if (hasAnyActiveShift && !window.confirm("У вас есть незакрытая смена. Всё равно переключить филиал?")) return;
    setBranchSwitching(true);
    try {
      const response = await fetch("/api/session/active-branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: id }),
      });
      if (!response.ok) {
        const payload = await safeReadJson<{ error?: string }>(response);
        window.alert(payload?.error ?? "Не удалось переключить филиал");
        return;
      }
      setSelectedBranchId(id);
      window.location.href = id === "all" ? "/owner" : pathname;
    } finally {
      setBranchSwitching(false);
    }
  }

  async function handleDeadlineAction(action: "acknowledge" | "snooze" | "close", minutes?: number) {
    const toast = deadlineToast;
    if (!toast) return;
    await fetch("/api/crm/deadline-notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        notificationId: toast.id,
        caseId: toast.caseId,
        minutes,
      }),
    });
    setDeadlineToast(null);
    void loadDeadlineNotifications();
  }

  async function enableBrowserPush() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    window.localStorage.setItem("eco-crm-browser-push", permission === "granted" ? "on" : "off");
    void loadDeadlineNotifications();
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
  const activeBranchLabel = selectedBranchId === "all"
    ? "Все филиалы"
    : branches.find((branch) => branch.id === selectedBranchId)?.shortName ?? "Филиал не выбран";

  return (
    <div ref={shellRef} className="platform-shell">
      <header className="platform-shell__main">
        <div className="platform-shell__brand-row">
          <Link href="/" className="platform-shell__brand" aria-label="Там где масло. ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ">
            <Image src="/brand/logo-wordmark-black.svg" alt="Там где масло." width={150} height={24} priority />
            <span>ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ</span>
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

                  {!disabled && (
                    <div className={`platform-shell__dropdown ${open ? "is-open" : ""}`} role="menu" aria-hidden={!open}>
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
              {branches.length > 0 && (
                <label className={`platform-shell__org-switch ${selectedBranchId === "all" ? "is-all" : ""}`} title="Активный филиал">
                  <Building2 aria-hidden className="eco-icon" />
                  <span className="platform-shell__branch-copy">
                    <small>Филиал</small>
                    <select
                      value={selectedBranchId}
                      onChange={(event) => void handleBranchChange(event.target.value)}
                      disabled={branchSwitching}
                      aria-label="Активный филиал"
                    >
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id} disabled={branch.status !== "active"}>
                          {branch.shortName}{branch.status === "archived" ? " · архив" : ""}
                        </option>
                      ))}
                      {canViewAllBranches && <option value="all">Все филиалы · обзор</option>}
                    </select>
                  </span>
                </label>
              )}
              <div className="platform-shell__search" aria-hidden>
                <Search className="eco-icon" />
                <input readOnly tabIndex={-1} placeholder="Товар, VIN, № отгрузки, клиент…" />
                <span className="platform-shell__search-kbd">⌘K</span>
              </div>
              <Link href="/notifications" className="platform-shell__icon-btn platform-shell__notification-btn" aria-label="Уведомления">
                <Bell aria-hidden className="eco-icon" />
                {!!((deadlineCounts?.total ?? 0) + (notificationCounts?.total ?? 0)) && (
                  <span>{(deadlineCounts?.total ?? 0) + (notificationCounts?.total ?? 0) > 99 ? "99+" : (deadlineCounts?.total ?? 0) + (notificationCounts?.total ?? 0)}</span>
                )}
              </Link>
              <MessengerTopbarButton />
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
                    <small>{roleLabel(user.role)} · {activeBranchLabel}</small>
                  </span>
                  <ChevronDown aria-hidden className="eco-icon platform-shell__chevron" />
                </button>

                <div className={`platform-shell__profile-menu ${profileOpen ? "is-open" : ""}`} role="menu" aria-hidden={!profileOpen}>
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
          {branches.length > 0 && (
            <label className="platform-shell__mobile-branch">
              <span>Активный филиал</span>
              <select
                value={selectedBranchId}
                onChange={(event) => void handleBranchChange(event.target.value)}
                disabled={branchSwitching}
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id} disabled={branch.status !== "active"}>{branch.shortName}</option>
                ))}
                {canViewAllBranches && <option value="all">Все филиалы · обзор</option>}
              </select>
            </label>
          )}
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
          <span className="platform-shell__sub-sep" />
          <div className={`platform-shell__sub-context ${allBranchesMode ? "is-all-branches" : ""}`}>
            <span className="l-meta">Филиал:</span>
            <strong>{activeBranchLabel}</strong>
          </div>
          <div className="grow" />
          {allBranchesMode
            ? <span className="platform-shell__lock-note">Обзор без создания операционных документов.</span>
            : locked && <span className="platform-shell__lock-note">Рабочие разделы откроются после начала смены.</span>}
          <span className="platform-shell__version">internal · live data</span>
        </div>
      )}

      {deadlineToast && (
        <div className={`eco-crm-deadline-toast is-${deadlineToast.urgency} ${deadlineExpanded ? "is-expanded" : ""}`} role="alert" aria-live="assertive">
          <button
            type="button"
            className="eco-crm-deadline-toast__summary"
            onClick={() => setDeadlineExpanded(true)}
            aria-expanded={deadlineExpanded}
          >
            <strong>{deadlineToast.title}</strong>
            <span>{deadlineToast.body}</span>
          </button>
          <div className="eco-crm-deadline-toast__actions">
            <Link href={deadlineToast.href} onClick={() => void handleDeadlineAction("acknowledge")}>
              <span className="eco-crm-deadline-toast__open-full">Открыть дело</span>
              <span className="eco-crm-deadline-toast__open-short">Открыть</span>
            </Link>
            <button type="button" className="eco-crm-deadline-toast__mobile-later" onClick={() => void handleDeadlineAction("snooze", 60)}>
              Позже
            </button>
            <button type="button" className="eco-crm-deadline-toast__detail-action" onClick={() => void handleDeadlineAction("snooze", 15)}>
              15 мин
            </button>
            <button type="button" className="eco-crm-deadline-toast__detail-action" onClick={() => void handleDeadlineAction("snooze", 60)}>
              1 час
            </button>
            <button type="button" className="eco-crm-deadline-toast__detail-action" onClick={() => void handleDeadlineAction("close")}>
              Закрыть
            </button>
            {deadlineToast.phone && (
              <a href={`tel:${deadlineToast.phone}`} className="eco-crm-deadline-toast__detail-action">
                Позвонить
              </a>
            )}
            {typeof window !== "undefined" && "Notification" in window && Notification.permission !== "granted" && (
              <button type="button" className="eco-crm-deadline-toast__detail-action" onClick={() => void enableBrowserPush()}>
                Browser push
              </button>
            )}
          </div>
          <button type="button" className="eco-crm-deadline-toast__close" onClick={() => setDeadlineToast(null)} aria-label="Скрыть уведомление">
            <X aria-hidden className="eco-icon" />
          </button>
        </div>
      )}
    </div>
  );
}
