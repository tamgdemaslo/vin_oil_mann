type ExistingAssignment = {
  masterMembershipId: string | null;
  serviceItems: Array<{ serviceId: string | null }>;
};

/** A staff edit may retain an existing assignment, but cannot add services to it. */
export function retainsBookingAssignment(
  current: ExistingAssignment | null | undefined,
  masterMembershipId: string | null | undefined,
  serviceIds: string[],
) {
  if (!current?.masterMembershipId || current.masterMembershipId !== masterMembershipId) return false;
  const previous = new Set(current.serviceItems.map((item) => item.serviceId));
  const next = new Set(serviceIds);
  return next.size > 0 && previous.size === next.size && [...next].every((id) => previous.has(id));
}
