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

/** Existing selected services stay removable; new choices follow active staff assignments. */
export function availableJournalServices<T extends { id: number; master_membership_ids?: string[] }>(
  services: T[],
  staff: Array<{ membership_id?: string; bookable?: boolean }>,
  selectedMasterId: string | undefined,
  retainedServiceIds: string[],
): T[] {
  const activeIds = staff.filter(canCreateJournalBooking).map(item => item.membership_id!);
  return services.filter(service => retainedServiceIds.includes(String(service.id)) || (service.master_membership_ids ?? []).some(id => activeIds.includes(id) && (!selectedMasterId || id === selectedMasterId)));
}
