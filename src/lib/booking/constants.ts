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

export const BOOKING_VIEW_ROLES = new Set([
  ...BOOKING_MANAGER_ROLES,
  "master",
  "mechanic",
]);
