"use client";

import {
  Bell,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Home,
  KeyRound,
  LogOut,
  Menu,
  Search,
  Send,
  Settings,
  UserRound,
  WalletCards,
  Warehouse,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MessengerTopbarButton } from "@/components/messenger/MessengerUi";
import { formatServiceTime } from "@/lib/date-time";
import { loadDashboardClientBundle } from "@/lib/dashboard-client";
import { safeReadJson } from "@/lib/http-json";
import { EcoStatusDot } from "./EcoUI";

type PlatformUser = {
  login: string;
  name: string;
  role?: "owner" | "admin" | "master";
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
  displayName?: string;
  status: string;
};

type ShellBranchContext = {
  mode: "branch" | "all";
  activeBranchId: string;
  activeBranch: ShellBranch | null;
  branches: ShellBranch[];
  groupRole: string | null;
  branchRole: string | null;
  permissions: string[];
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
  disabledReason?: string;
  requiresBranch?: boolean;
  requiresCashShift?: boolean;
};

type PlatformNavSection = {
  id: string;
  href: string;
  label: string;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  items: PlatformNavItem[];
};

type PlatformPersonalItem = {
  id?: string;
  href?: string;
  label: string;
  description?: string;
  action?: "logout";
};

type PlatformNavigation = {
  effectiveRole: string;
  sections: PlatformNavSection[];
  personalItems: PlatformPersonalItem[];
  managementActions: PlatformNavItem[];
  canViewAllBranches: boolean;
  canManageBranches: boolean;
};

type PlatformSearchResult = {
  id: string;
  label: string;
  description: string;
  href: string;
  kind: "section" | "search";
};

const CASH_SHIFT_EVENT = "eco-cash-shift-changed";

const NAV_ICONS: Record<string, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  home: Home,
  work: BriefcaseBusiness,
  clients: CalendarDays,
  warehouse: Warehouse,
  finance: CircleDollarSign,
  "ai-assistant": Bot,
  management: Settings,
};

function isActivePath(pathname: string, href: string) {
  const cleanHref = href.split(/[?#]/)[0] || "/";
  if (cleanHref === "/") return pathname === "/";
  return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

function roleLabel(role?: string) {
  const labels: Record<string, string> = {
    owner: "Владелец",
    admin: "Администратор",
    master: "Мастер-приёмщик",
    group_owner: "Владелец группы",
    group_admin: "Администратор группы",
    group_analyst: "Аналитик группы",
    branch_owner: "Владелец филиала",
    administrator: "Администратор",
    mechanic: "Механик",
    accountant: "Бухгалтер",
    viewer: "Наблюдатель",
  };
  return role ? labels[role] ?? role : "Сотрудник";
}

function personalItemIcon(item: PlatformPersonalItem) {
  if (item.action === "logout") return LogOut;
  if (item.href?.startsWith("/salary")) return WalletCards;
  if (item.href?.startsWith("/notifications")) return Bell;
  if (item.href?.includes("tab=telegram")) return Send;
  if (item.href?.includes("tab=security")) return KeyRound;
  if (item.href?.includes("tab=branches")) return Building2;
  return UserRound;
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
  if (pathname === "/booking" || pathname.startsWith("/booking/")) return true;
  if (pathname.startsWith("/report/")) return true;
  return /^\/shipment\/[^/]+\/(poster|tags)(?:\/)?$/.test(pathname);
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const formatted = formatServiceTime(value);
  return formatted === "—" ? "" : formatted;
}

function branchLabel(branch: ShellBranch) {
  return branch.displayName?.trim() || branch.shortName || branch.name;
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
  if (pathname.startsWith("/management")) return { label: "Текущий раздел:", value: "Управление" };
  if (pathname.startsWith("/crm") || pathname.startsWith("/records") || pathname.startsWith("/clients")) {
    return { label: "Текущий раздел:", value: "Клиенты" };
  }
  if (
    pathname.startsWith("/cabinet/branches") ||
    pathname.startsWith("/cabinet/organizations") ||
    pathname.startsWith("/cabinet/integrations") ||
    pathname.startsWith("/cabinet/notifications") ||
    pathname.startsWith("/cabinet/ai-assistant")
  ) return { label: "Текущий раздел:", value: "Управление" };
  if (pathname.startsWith("/cabinet")) return { label: "Текущий раздел:", value: "Личные настройки" };
  return { label: "Текущий раздел:", value: pathname };
}

export default function PlatformShell() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<PlatformUser>(null);
  const [navigation, setNavigation] = useState<PlatformNavigation | null>(null);
  const [currentCashShift, setCurrentCashShift] = useState<CurrentCashShift>(null);
  const [branches, setBranches] = useState<ShellBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<ShellBranch | null>(null);
  const [canViewAllBranches, setCanViewAllBranches] = useState(false);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [notificationCounts, setNotificationCounts] = useState<NotificationCounts | null>(null);
  const [deadlineCounts, setDeadlineCounts] = useState<DeadlineNotificationCounts | null>(null);
  const [deadlineToast, setDeadlineToast] = useState<DeadlineNotification | null>(null);
  const [deadlineExpanded, setDeadlineExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const browserPushSeenRef = useRef<Set<string>>(new Set());
  const deadlineLoadInFlightRef = useRef(false);

  useEffect(() => {
    if (shouldHideShell(pathname)) return;
    let cancelled = false;

    async function loadShellState(force = false) {
      setLoading(true);
      try {
        const [sessionRes, dashboardBundle] = await Promise.all([
          fetch("/api/auth/session", { cache: "no-store" }),
          loadDashboardClientBundle<{ notificationCounts?: NotificationCounts }, { shift?: CurrentCashShift }>({ force }).catch(() => null),
        ]);
        const sessionData = await safeReadJson<{
          user?: PlatformUser;
          navigation?: PlatformNavigation;
          branchContext?: ShellBranchContext | null;
        }>(sessionRes);
        if (cancelled) return;
        setUser(sessionData?.user ?? null);
        setNavigation(sessionData?.navigation ?? null);
        setCurrentCashShift(dashboardBundle?.cash?.shift ?? null);
        setNotificationCounts(dashboardBundle?.dashboard.notificationCounts ?? null);
        const branchContext = sessionData?.branchContext ?? null;
        setBranches(branchContext?.branches ?? []);
        setSelectedBranchId(branchContext?.activeBranchId ?? "");
        setSelectedBranch(branchContext?.activeBranch ?? null);
        setCanViewAllBranches(Boolean(sessionData?.navigation?.canViewAllBranches ?? branchContext?.groupRole));
      } catch {
        if (cancelled) return;
        setUser(null);
        setNavigation(null);
        setCurrentCashShift(null);
        setNotificationCounts(null);
        setBranches([]);
        setSelectedBranchId("");
        setSelectedBranch(null);
        setCanViewAllBranches(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadShellState();
    const handleShiftChanged = () => void loadShellState(true);
    window.addEventListener(CASH_SHIFT_EVENT, handleShiftChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(CASH_SHIFT_EVENT, handleShiftChanged);
    };
  }, [pathname]);

  const loadDeadlineNotifications = useCallback(async () => {
    if (shouldHideShell(pathname)) return;
    if (document.visibilityState !== "visible" || deadlineLoadInFlightRef.current) return;
    deadlineLoadInFlightRef.current = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
    let notificationForFailure: DeadlineNotification | null = null;
    try {
      const res = await fetch("/api/crm/deadline-notifications", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data = await safeReadJson<{
        notifications?: DeadlineNotification[];
        notificationCounts?: DeadlineNotificationCounts;
      }>(res);
      const notifications = data?.notifications ?? [];
      setDeadlineCounts(data?.notificationCounts ?? null);
      const top = notifications[0] ?? null;
      setDeadlineToast(top);

      if (!top || !("Notification" in window)) return;
      const browserPushEnabled = window.localStorage.getItem("eco-crm-browser-push") !== "off";
      const pushKey = `${top.id}:${top.sentAt}`;
      if (!browserPushEnabled || Notification.permission !== "granted" || browserPushSeenRef.current.has(pushKey)) return;
      browserPushSeenRef.current.add(pushKey);
      notificationForFailure = top;
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
      }).catch(() => undefined);
    } catch (error) {
      if (!notificationForFailure || (error instanceof DOMException && error.name === "AbortError")) return;
      void fetch("/api/crm/deadline-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "browser_push",
          caseId: notificationForFailure.caseId,
          type: notificationForFailure.type,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "browser push failed",
        }),
      }).catch(() => undefined);
    } finally {
      window.clearTimeout(timeoutId);
      deadlineLoadInFlightRef.current = false;
    }
  }, [pathname]);

  useEffect(() => {
    if (shouldHideShell(pathname)) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadDeadlineNotifications();
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadDeadlineNotifications, pathname]);

  useEffect(() => {
    setDeadlineExpanded(false);
  }, [deadlineToast?.id]);

  useEffect(() => {
    setOpenSectionId(null);
    setProfileOpen(false);
    setBranchMenuOpen(false);
    setMobileOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
  }, [pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!shellRef.current?.contains(target)) {
        setOpenSectionId(null);
        setProfileOpen(false);
        setBranchMenuOpen(false);
        setMobileOpen(false);
        setSearchOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const effectiveRole = navigation?.effectiveRole ?? user?.role;
  const needsCashShift = !!user && ["admin", "master", "administrator", "mechanic"].includes(effectiveRole ?? "");
  const hasOpenCashShift = currentCashShift?.status === "open";
  const allBranchesMode = selectedBranchId === "all";
  const locked = needsCashShift && !hasOpenCashShift;
  const operationalLocked = locked || allBranchesMode;

  const navSections = useMemo<PlatformNavSection[]>(
    () => (navigation?.sections ?? []).map((section) => ({
      ...section,
      icon: NAV_ICONS[section.id] ?? Settings,
      items: section.items.map((navItem) => {
        const shiftDisabled = Boolean(navItem.requiresCashShift && locked);
        return {
          ...navItem,
          disabled: Boolean(navItem.disabled || shiftDisabled),
          disabledReason: shiftDisabled ? "Рабочий раздел откроется после открытия кассовой смены" : navItem.disabledReason,
        };
      }),
    })),
    [locked, navigation]
  );

  const searchResults = useMemo<PlatformSearchResult[]>(() => {
    const query = searchQuery.trim();
    const normalized = query.toLocaleLowerCase("ru-RU");
    const navigationResults = navSections
      .flatMap((section) => section.items.map((item) => ({ section, item })))
      .filter(({ item }) => !item.disabled)
      .filter(({ section, item }) => !normalized || `${section.label} ${item.label} ${item.description ?? ""}`.toLocaleLowerCase("ru-RU").includes(normalized))
      .map(({ section, item }) => ({
        id: `nav-${item.href}`,
        label: item.label,
        description: `${section.label} · ${item.description ?? "Открыть раздел"}`,
        href: item.href,
        kind: "section" as const,
      }));

    if (query.length < 2 || operationalLocked) return navigationResults.slice(0, 7);
    const encoded = encodeURIComponent(query);
    const contextualResults: PlatformSearchResult[] = [
      {
        id: "search-products",
        label: `Товары: ${query}`,
        description: "Название, артикул или код товара",
        href: `/inventory/products?search=${encoded}`,
        kind: "search",
      },
      {
        id: "search-shipments",
        label: `Отгрузки: ${query}`,
        description: "Номер документа, клиент, телефон или VIN",
        href: `/shipment?search=${encoded}`,
        kind: "search",
      },
      {
        id: "search-records",
        label: `Записи: ${query}`,
        description: "Клиент, телефон, автомобиль или VIN",
        href: `/records?search=${encoded}`,
        kind: "search",
      },
      {
        id: "search-clients",
        label: `Клиенты: ${query}`,
        description: "Имя, телефон, госномер, VIN или ИНН",
        href: `/clients/counterparties?search=${encoded}`,
        kind: "search",
      },
    ];
    if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(query)) {
      contextualResults.unshift({
        id: "search-vin",
        label: `Создать отгрузку по VIN ${query.toUpperCase()}`,
        description: "VIN будет сразу передан в подбор автомобиля",
        href: `/shipment/new?vin=${encoded}`,
        kind: "search",
      });
    }
    return [...contextualResults, ...navigationResults].slice(0, 8);
  }, [navSections, operationalLocked, searchQuery]);

  const openSearch = useCallback(() => {
    setOpenSectionId(null);
    setProfileOpen(false);
    setSearchOpen(true);
    setActiveSearchIndex(0);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const runSearchResult = useCallback((result: PlatformSearchResult) => {
    setSearchOpen(false);
    setSearchQuery("");
    router.push(result.href);
  }, [router]);

  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (!window.matchMedia("(min-width: 1181px)").matches) return;
        event.preventDefault();
        openSearch();
      }
      if (event.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        searchInputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, [openSearch, searchOpen]);

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchIndex((index) => Math.min(index + 1, Math.max(0, searchResults.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && searchResults[activeSearchIndex]) {
      event.preventDefault();
      runSearchResult(searchResults[activeSearchIndex]);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/login";
  }

  async function handleBranchChange(id: string) {
    if (!id || id === selectedBranchId || branchSwitching) return;
    if (hasOpenCashShift && !window.confirm("В филиале открыта кассовая смена. Всё равно переключить филиал?")) return;
    setBranchSwitching(true);
    try {
      const response = await fetch("/api/session/active-branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: id }),
      });
      const payload = await safeReadJson<{ error?: string; activeBranchId?: string; activeBranch?: ShellBranch | null }>(response);
      if (!response.ok) {
        window.alert(payload?.error ?? "Не удалось переключить филиал");
        return;
      }
      const nextBranchId = payload?.activeBranchId ?? id;
      const nextBranch = payload?.activeBranch;
      if (nextBranch) {
        setBranches((current) => current.map((branch) => branch.id === nextBranch.id ? nextBranch : branch));
      }
      setSelectedBranchId(nextBranchId);
      setSelectedBranch(nextBranch ?? null);
      setBranchMenuOpen(false);
      window.location.href = nextBranchId === "all" ? "/owner" : pathname;
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

  const cashShiftLabel = loading
    ? "Проверяем кассовую смену"
    : hasOpenCashShift
      ? `Кассовая смена активна${formatTime(currentCashShift?.openedAt) ? ` с ${formatTime(currentCashShift?.openedAt)}` : ""}`
      : "Кассовая смена закрыта";
  const context = routeContext(pathname);
  const activeBranch = selectedBranch?.id === selectedBranchId
    ? selectedBranch
    : branches.find((branch) => branch.id === selectedBranchId) ?? null;
  const activeBranchLabel = selectedBranchId === "all"
    ? "Все филиалы"
    : activeBranch ? branchLabel(activeBranch) : "Филиал не выбран";

  return (
    <div ref={shellRef} className="platform-shell">
      <header className="platform-shell__main">
        <div className="platform-shell__brand-row">
          <Link href="/" prefetch={false} className="platform-shell__brand" aria-label="Там где масло. ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ">
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
                    onClick={() => {
                      setBranchMenuOpen(false);
                      setProfileOpen(false);
                      setOpenSectionId(open ? null : section.id);
                    }}
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
                            <small>{item.disabledReason ?? item.description}</small>
                          </div>
                        ) : (
                          <Link
                            key={item.href}
                            href={item.href}
                            prefetch={false}
                            className={`platform-shell__dropdown-link ${isActivePath(pathname, item.href) ? "is-active" : ""}`}
                            role="menuitem"
                            aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
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
                <div className={`platform-shell__org-switch ${selectedBranchId === "all" ? "is-all" : ""}`}>
                  <button
                    type="button"
                    className="platform-shell__org-switch-trigger"
                    onClick={() => {
                      setOpenSectionId(null);
                      setProfileOpen(false);
                      setBranchMenuOpen((open) => !open);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setBranchMenuOpen(false);
                    }}
                    disabled={branchSwitching}
                    aria-expanded={branchMenuOpen}
                    aria-haspopup="menu"
                    aria-controls="platform-shell-branch-menu"
                  >
                    <Building2 aria-hidden className="eco-icon" />
                    <span className="platform-shell__branch-copy">
                      <small>Рабочий филиал</small>
                      <strong>{branchSwitching ? "Переключаем…" : activeBranchLabel}</strong>
                    </span>
                    <ChevronDown aria-hidden className="eco-icon platform-shell__branch-chevron" />
                  </button>
                  {branchMenuOpen && (
                    <div id="platform-shell-branch-menu" className="platform-shell__branch-menu" role="menu" aria-label="Выбор филиала">
                      {branches.map((branch) => {
                        const selected = branch.id === selectedBranchId;
                        const label = branchLabel(branch);
                        return (
                          <button
                            key={branch.id}
                            type="button"
                            className={selected ? "is-selected" : ""}
                            role="menuitemradio"
                            aria-checked={selected}
                            disabled={branch.status !== "active" || branchSwitching}
                            onClick={() => void handleBranchChange(branch.id)}
                          >
                            <span>
                              <strong>{label}</strong>
                              {branch.name !== label && branch.name !== branch.shortName && <small>{branch.name}</small>}
                              {branch.status === "archived" && <small>Архив</small>}
                            </span>
                            {selected && <Check aria-hidden className="eco-icon" />}
                          </button>
                        );
                      })}
                      {canViewAllBranches && (
                        <button
                          type="button"
                          className={selectedBranchId === "all" ? "is-selected" : ""}
                          role="menuitemradio"
                          aria-checked={selectedBranchId === "all"}
                          disabled={branchSwitching}
                          onClick={() => void handleBranchChange("all")}
                        >
                          <span><strong>Все филиалы</strong><small>Сводный режим без операций</small></span>
                          {selectedBranchId === "all" && <Check aria-hidden className="eco-icon" />}
                        </button>
                      )}
                      {navigation?.canManageBranches && (
                        <div className="platform-shell__branch-actions" role="group" aria-label="Управление филиалами">
                          {selectedBranchId !== "all" && (
                            <Link href={`/cabinet/branches?branch=${encodeURIComponent(selectedBranchId)}`} prefetch={false} role="menuitem">
                              <Settings aria-hidden className="eco-icon" />
                              Настройки текущего филиала
                            </Link>
                          )}
                          <Link href="/cabinet/branches" prefetch={false} role="menuitem">
                            <Building2 aria-hidden className="eco-icon" />
                            Управление филиалами
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className={`platform-shell__search ${searchOpen ? "is-open" : ""}`}>
                <Search aria-hidden className="eco-icon" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onFocus={openSearch}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setActiveSearchIndex(0);
                    setSearchOpen(true);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Товар, VIN, № отгрузки, клиент…"
                  role="combobox"
                  aria-label="Глобальный поиск и переход к разделу"
                  aria-expanded={searchOpen}
                  aria-controls="platform-global-search-results"
                  aria-autocomplete="list"
                  aria-activedescendant={searchOpen && searchResults[activeSearchIndex] ? `platform-search-${activeSearchIndex}` : undefined}
                />
                <kbd className="platform-shell__search-kbd">⌘K</kbd>
                {searchOpen && (
                  <div id="platform-global-search-results" className="platform-shell__search-results" role="listbox" aria-label="Результаты поиска">
                    <div className="platform-shell__search-caption">
                      {searchQuery.trim().length >= 2 ? "Искать в разделах" : "Быстрые переходы"}
                    </div>
                    {searchResults.length ? searchResults.map((result, index) => (
                      <button
                        key={result.id}
                        id={`platform-search-${index}`}
                        type="button"
                        role="option"
                        aria-selected={index === activeSearchIndex}
                        className={index === activeSearchIndex ? "is-active" : ""}
                        onMouseEnter={() => setActiveSearchIndex(index)}
                        onClick={() => runSearchResult(result)}
                      >
                        <span>{result.label}</span>
                        <small>{result.description}</small>
                        <em>{result.kind === "search" ? "Найти" : "Открыть"}</em>
                      </button>
                    )) : (
                      <p>Совпадений по разделам нет. Уточните запрос.</p>
                    )}
                  </div>
                )}
              </div>
              <Link href="/notifications" prefetch={false} className="platform-shell__icon-btn platform-shell__notification-btn" aria-label="Уведомления">
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
                  onClick={() => {
                    setOpenSectionId(null);
                    setBranchMenuOpen(false);
                    setProfileOpen((value) => !value);
                  }}
                  aria-expanded={profileOpen}
                  aria-haspopup="menu"
                >
                  <span className="platform-shell__avatar">{userInitials(user)}</span>
                  <span className="platform-shell__profile-copy">
                    <strong>{compactUserName(user)}</strong>
                    <small>{roleLabel(navigation?.effectiveRole ?? user.role)} · {activeBranchLabel}</small>
                  </span>
                  <ChevronDown aria-hidden className="eco-icon platform-shell__chevron" />
                </button>

                <div className={`platform-shell__profile-menu ${profileOpen ? "is-open" : ""}`} role="menu" aria-hidden={!profileOpen}>
                  {(navigation?.personalItems ?? []).map((personalItem) => {
                    const Icon = personalItemIcon(personalItem);
                    if (personalItem.action === "logout") {
                      return (
                        <button key="logout" type="button" className="platform-shell__dropdown-link danger" onClick={handleLogout} role="menuitem">
                          <Icon aria-hidden className="eco-icon" />
                          <span>{personalItem.label}</span>
                        </button>
                      );
                    }
                    return (
                      <Link key={personalItem.href} href={personalItem.href ?? "/cabinet"} prefetch={false} className="platform-shell__dropdown-link" role="menuitem">
                        <Icon aria-hidden className="eco-icon" />
                        <span>{personalItem.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <Link href="/login" prefetch={false} className="eco-btn eco-btn--primary eco-btn--sm">
              Войти
            </Link>
          )}
        </div>
      </header>

      {user && mobileOpen && (
        <nav className="platform-shell__mobile-panel" aria-label="Мобильная навигация">
          <div className="platform-shell__mobile-user">
            <span className="platform-shell__avatar">{userInitials(user)}</span>
            <span><strong>{user.name || user.login}</strong><small>{roleLabel(navigation?.effectiveRole ?? user.role)}</small></span>
          </div>
          {branches.length > 0 && (
            <label className="platform-shell__mobile-branch">
              <span>Активный филиал</span>
              <select
                value={selectedBranchId}
                onChange={(event) => void handleBranchChange(event.target.value)}
                disabled={branchSwitching}
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id} disabled={branch.status !== "active"}>{branchLabel(branch)}</option>
                ))}
                {canViewAllBranches && <option value="all">Все филиалы · обзор</option>}
              </select>
            </label>
          )}
          <div className="platform-shell__mobile-groups">
            {navSections.map((section) => {
              const Icon = section.icon ?? NAV_ICONS[section.id] ?? Settings;
              const sectionActive = section.items.some((navItem) => isActivePath(pathname, navItem.href));
              return (
                <details key={section.id} open={sectionActive}>
                  <summary><Icon aria-hidden className="eco-icon" /><span>{section.label}</span><ChevronDown aria-hidden className="eco-icon platform-shell__chevron" /></summary>
                  <div>
                    {section.items.map((navItem) => navItem.disabled ? (
                      <span key={navItem.href} className="platform-shell__mobile-link is-disabled" aria-disabled="true"><strong>{navItem.label}</strong><small>{navItem.disabledReason ?? navItem.description}</small></span>
                    ) : (
                      <Link key={navItem.href} href={navItem.href} prefetch={false} className={`platform-shell__mobile-link ${isActivePath(pathname, navItem.href) ? "is-active" : ""}`} aria-current={isActivePath(pathname, navItem.href) ? "page" : undefined}>
                        <strong>{navItem.label}</strong><small>{navItem.description}</small>
                      </Link>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
          <div className="platform-shell__mobile-personal">
            <Link href="/cabinet" prefetch={false}><UserRound aria-hidden className="eco-icon" />Мой профиль</Link>
            <Link href="/cabinet?tab=security" prefetch={false}><KeyRound aria-hidden className="eco-icon" />Безопасность</Link>
            <button type="button" onClick={handleLogout}><LogOut aria-hidden className="eco-icon" />Выйти</button>
          </div>
        </nav>
      )}

      {user && (
        <div className="platform-shell__substrip">
          <div className="platform-shell__shift">
            <EcoStatusDot tone={hasOpenCashShift ? "success" : locked ? "warning" : "neutral"} pulse={hasOpenCashShift} />
            <span>{cashShiftLabel}</span>
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
            : locked && <span className="platform-shell__lock-note">Рабочие разделы откроются после открытия кассовой смены.</span>}
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
            <Link href={deadlineToast.href} prefetch={false} onClick={() => void handleDeadlineAction("acknowledge")}>
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
