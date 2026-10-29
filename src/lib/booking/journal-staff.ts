/** Existing appointments stay visible even after their master is disabled. */
export function visibleJournalStaff<T extends { id: number; bookable?: boolean }>(
  staff: T[],
  records: Array<{ staff_id?: number }>,
  selectedId: string,
): T[] {
  if (selectedId) return staff.filter((item) => String(item.id) === selectedId);
  const assignedIds = new Set(records.map((record) => Number(record.staff_id)));
  const visible = staff.filter((item) => item.bookable !== false || assignedIds.has(item.id));
  return visible;
}

/** Archived employees and synthetic archive columns cannot accept new visits. */
export function canCreateJournalBooking(staff: { bookable?: boolean; membership_id?: string } | undefined): boolean {
  return Boolean(staff?.membership_id) && staff?.bookable !== false;
}
