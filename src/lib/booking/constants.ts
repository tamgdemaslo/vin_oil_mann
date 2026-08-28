export const BOOKING_STATUS = {
  ACTIVE: "ACTIVE",
  CANCELLED: "CANCELLED",
} as const;

export const BOOKING_CONFIRMATION = {
  NOT_REQUIRED: "NOT_REQUIRED",
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
} as const;

export const BOOKING_SOURCE = {
  ADMIN: "ADMIN",
  PUBLIC: "PUBLIC",
  MANAGE_LINK: "MANAGE_LINK",
  LEGACY_YCLIENTS: "LEGACY_YCLIENTS",
  AI_AGENT: "AI_AGENT",
} as const;

export const BOOKING_PERMISSION = {
  VIEW: "booking.view",
  MANAGE: "booking.manage",
  SETTINGS: "booking.settings.manage",
  CONFIRM: "booking.confirm",
  OVERRIDE_CONFLICT: "booking.conflict.override",
} as const;

export const BOOKING_MASTER_ROLE_ID = "master";

export const BOOKING_MANAGER_ROLES = new Set([
  "group_owner",
  "group_admin",
  "branch_owner",
  "administrator",
]);

/**
 * A branch-level `master` is a master-receptionist: they work with the full
 * booking journal, while mechanics remain limited to their own appointments.
 * Settings and conflict overrides stay reserved for administrators.
 */
export const BOOKING_JOURNAL_MANAGER_ROLES = new Set([
  ...BOOKING_MANAGER_ROLES,
  "master",
]);

export const BOOKING_VIEW_ROLES = new Set([
  ...BOOKING_JOURNAL_MANAGER_ROLES,
  "mechanic",
]);
