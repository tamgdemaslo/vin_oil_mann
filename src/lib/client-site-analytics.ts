const COUNTER_ID = 113656120;
const reportedBookings = new Set<string>();

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
