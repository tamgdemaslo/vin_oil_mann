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

const LOCK_TITLE_ID = "eco-lock-screen-title";
const LOCK_DESCRIPTION_ID = "eco-lock-screen-description";
const LOCK_ERROR_ID = "eco-lock-screen-error";
const PIN_INPUT_ID = "eco-lock-screen-pin";

function roleLabel(role: SessionUser["role"]) {
  if (role === "owner") return "Владелец";
  if (role === "admin") return "Администратор";
  return "Мастер";
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(",")
    )
  ).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

export default function IdleLockGuard() {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [switchingUser, setSwitchingUser] = useState(false);
  const [pinFocused, setPinFocused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

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
    if (!user || loading || locked || pathname === "/login" || pathname === "/client-site") return;

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
        setPin("");
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

  useEffect(() => {
    if (!shouldRenderModal) return;

    previousFocusRef.current = document.activeElement;
    window.requestAnimationFrame(() => {
      pinInputRef.current?.focus({ preventScroll: true });
    });

    return () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) {
        window.requestAnimationFrame(() => {
          previousFocus.focus({ preventScroll: true });
        });
      }
      previousFocusRef.current = null;
    };
  }, [shouldRenderModal]);

  useEffect(() => {
    if (!shouldRenderModal) return;

    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const blockedSiblings: Array<{
      element: HTMLElement;
      ariaHidden: string | null;
      inert: string | null;
    }> = [];

    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    Array.from(body.children).forEach((child) => {
      if (!(child instanceof HTMLElement) || child.dataset.ecoLockRoot === "true") return;
      blockedSiblings.push({
        element: child,
        ariaHidden: child.getAttribute("aria-hidden"),
        inert: child.getAttribute("inert"),
      });
      child.setAttribute("aria-hidden", "true");
      child.setAttribute("inert", "");
    });

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      blockedSiblings.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", ariaHidden);
        }

        if (inert === null) {
          element.removeAttribute("inert");
        } else {
          element.setAttribute("inert", inert);
        }
      });
    };
  }, [shouldRenderModal]);

  useEffect(() => {
    if (!shouldRenderModal) return;

    const dialogNode = dialogRef.current;
    function stopDialogKeyDown(event: KeyboardEvent) {
      event.stopPropagation();
    }

    function handleKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      const target = event.target;
      const targetNode = target instanceof Node ? target : null;
      const targetInsideDialog = !!dialog && !!targetNode && dialog.contains(targetNode);

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        pinInputRef.current?.focus({ preventScroll: true });
        return;
      }

      if (!targetInsideDialog) {
        event.preventDefault();
        event.stopPropagation();
        pinInputRef.current?.focus({ preventScroll: true });
        return;
      }

      if (event.key === "Tab") {
        const focusable = getFocusableElements(dialog);
        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (!firstElement || !lastElement) {
          event.preventDefault();
          return;
        }

        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
          return;
        }

        if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
          return;
        }
      }

      const isPasteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v";
      if ((event.metaKey || event.ctrlKey || event.altKey) && !isPasteShortcut) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    dialogNode?.addEventListener("keydown", stopDialogKeyDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      dialogNode?.removeEventListener("keydown", stopDialogKeyDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [shouldRenderModal]);

  function focusPinInput() {
    window.requestAnimationFrame(() => {
      pinInputRef.current?.focus({ preventScroll: true });
    });
  }

  function updatePin(rawValue: string) {
    setPin(rawValue.replace(/\D/g, "").slice(0, 4));
    if (error) setError(null);
  }

  async function unlock() {
    if (!PIN_REGEX.test(pin)) {
      setError("Введите 4-значный пароль доступа.");
      focusPinInput();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pin }),
      });
      const data = await safeReadJson<{ error?: string }>(res);
      if (!res.ok) {
        setPin("");
        setError(
          res.status === 401
            ? "Неверный пароль. Попробуйте ещё раз."
            : data?.error ?? "Не удалось проверить пароль. Попробуйте ещё раз."
        );
        focusPinInput();
        return;
      }
      setLocked(false);
      setPin("");
    } catch {
      setError("Не удалось проверить пароль. Попробуйте ещё раз.");
      focusPinInput();
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

  if (!shouldRenderModal || !user) return null;

  const pinComplete = pin.length === 4;
  const pinDescribedBy = error ? `${LOCK_DESCRIPTION_ID} ${LOCK_ERROR_ID}` : LOCK_DESCRIPTION_ID;
  const currentUserLabel = `${user.name} · ${roleLabel(user.role)}`;

  return (
    <div
      className="eco-lock-overlay"
      data-eco-lock-root="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) focusPinInput();
      }}
    >
      <div
        ref={dialogRef}
        className="eco-lock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={LOCK_TITLE_ID}
        aria-describedby={LOCK_DESCRIPTION_ID}
      >
        <div className="eco-lock-head">
          <div className="eco-lock-mark" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2 id={LOCK_TITLE_ID}>Сессия заблокирована</h2>
            <p className="eco-lock-user">{currentUserLabel}</p>
          </div>
        </div>
        <p id={LOCK_DESCRIPTION_ID} className="eco-lock-description">
          Нет активности больше 3 минут. Введите 4-значный пароль доступа, чтобы продолжить работу.
        </p>
        <form
          className="eco-lock-form"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <label className="eco-lock-label" htmlFor={PIN_INPUT_ID}>
            Пароль доступа
          </label>
          <div
            className={[
              "eco-lock-pin",
              pinFocused ? "is-focused" : "",
              error ? "is-error" : "",
              submitting || switchingUser ? "is-disabled" : "",
            ].filter(Boolean).join(" ")}
            onMouseDown={(event) => {
              event.preventDefault();
              focusPinInput();
            }}
          >
            <input
              ref={pinInputRef}
              id={PIN_INPUT_ID}
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              autoFocus
              value={pin}
              onChange={(event) => updatePin(event.target.value)}
              onPaste={(event) => {
                event.preventDefault();
                updatePin(event.clipboardData.getData("text"));
              }}
              onFocus={() => setPinFocused(true)}
              onBlur={() => setPinFocused(false)}
              className="eco-lock-pin__input"
              autoComplete="off"
              aria-label="4-значный пароль доступа"
              aria-describedby={pinDescribedBy}
              aria-invalid={!!error}
              disabled={submitting || switchingUser}
            />
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={`eco-lock-pin__cell ${index < pin.length ? "is-filled" : ""}`}
                aria-hidden="true"
              >
                {index < pin.length ? "•" : ""}
              </span>
            ))}
          </div>
          {error && (
            <p id={LOCK_ERROR_ID} className="eco-lock-error" aria-live="polite">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || switchingUser || !pinComplete}
            className="eco-lock-submit"
          >
            {submitting && <span className="eco-lock-spinner" aria-hidden="true" />}
            {submitting ? "Проверяем…" : "Разблокировать"}
          </button>
          <button
            type="button"
            onClick={() => {
              void chooseAnotherUser();
            }}
            disabled={submitting || switchingUser}
            className="eco-lock-secondary"
          >
            {switchingUser ? "Переходим…" : "Выбрать другого пользователя"}
          </button>
        </form>
      </div>
    </div>
  );
}
