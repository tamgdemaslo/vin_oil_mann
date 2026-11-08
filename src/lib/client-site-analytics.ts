const COUNTER_ID = 113656120;
const reportedBookings = new Set<string>();

type ClientGoal = "phone_click" | "messenger_click" | "booking_start";

export function trackClientGoal(goal: ClientGoal, params?: Record<string, string>) {
  if (typeof window === "undefined" || window.location.hostname !== "tamgdemaslo.ru") return false;
  const ym = (window as Window & {
    ym?: (counter: number, method: string, goal: string, params?: Record<string, string>) => void;
  }).ym;
  if (typeof ym !== "function") return false;

  try {
    ym(COUNTER_ID, "reachGoal", goal, params);
    return true;
  } catch {
    return false;
  }
}

export function trackClientContactClick(event: MouseEvent) {
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement)) return;

  const branch = {
    "tel:+79950545859": "dachnaya",
    "tel:+79650545858": "gagarina",
  }[link.href];

  if (link.protocol === "tel:") {
    trackClientGoal("phone_click", { branch: branch ?? "unknown" });
  } else if (link.origin === "https://t.me" && link.pathname.replace(/\/$/, "") === "/tamgdemaslo") {
    trackClientGoal("messenger_click", { channel: "telegram" });
  }
}

/** Report a saved booking once, including recovery after an interrupted request. */
export function trackClientBookingSuccess(bookingId: string) {
  if (typeof window === "undefined" || !bookingId || reportedBookings.has(bookingId)) return;
  const ym = (window as Window & {
    ym?: (counter: number, method: string, goal: string) => void;
  }).ym;
  if (typeof ym !== "function") return;

  const key = `client-booking-conversion:${bookingId}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
  } catch { /* Storage can be unavailable in private browsing. */ }

  try {
    ym(COUNTER_ID, "reachGoal", "booking_success");
    reportedBookings.add(bookingId);
    try { window.sessionStorage.setItem(key, "1"); } catch { /* In-memory deduplication remains available. */ }
  } catch { /* Analytics must never interrupt a successful booking. */ }
}
