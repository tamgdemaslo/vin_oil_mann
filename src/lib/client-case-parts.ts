/** Keep the supplier reference in the existing supplies note without losing other notes. */
const ORDER_LINE = /^Заказ (?:РОССКО|ROSSKO) №\s*(\d{1,20})\s*$/imu;
export function caseRosskoOrder(note: string | null | undefined): string {
  return note?.match(ORDER_LINE)?.[1] ?? "";
}
export function validCaseRosskoOrder(value: unknown): value is string {
  return typeof value === "string" && (value.trim() === "" || /^\d{1,20}$/.test(value.trim()));
}
export function withCaseRosskoOrder(note: string | null | undefined, order: string): string | null {
  const rest = (note ?? "").split("\n").filter(line => !ORDER_LINE.test(line)).join("\n").trim();
  return [order.trim() ? `Заказ РОССКО № ${order.trim()}` : "", rest].filter(Boolean).join("\n") || null;
}
export function caseTimeRemaining(deadline: Date, now: Date): { expired: boolean; label: string } {
  const delta = deadline.getTime() - now.getTime();
  if (Math.abs(delta) < 60000) return { expired: delta <= 0, label: delta <= 0 ? "Срок истёк" : "Осталось менее минуты" };
  const minutes = Math.max(1, Math.ceil(Math.abs(delta) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const duration = days ? `${days} дн${hours ? ` ${hours} ч` : ""}` : hours ? `${hours} ч${mins ? ` ${mins} мин` : ""}` : `${mins} мин`;
  return { expired: delta <= 0, label: delta <= 0 ? `Просрочено на ${duration}` : `Осталось ${duration}` };
}
