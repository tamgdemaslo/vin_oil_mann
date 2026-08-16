import type { BranchContext } from "@/lib/branch-context";
import { BookingError } from "./errors";
import { BOOKING_MANAGER_ROLES, BOOKING_PERMISSION, BOOKING_VIEW_ROLES } from "./constants";

function roles(context: BranchContext) {
  return [context.groupRole, context.branchRole].filter((value): value is string => Boolean(value));
}

function hasPermission(context: BranchContext, permission: string) {
  return context.permissions.includes(permission);
}

export function canViewBookings(context: BranchContext) {
  return roles(context).some((role) => BOOKING_VIEW_ROLES.has(role)) || hasPermission(context, BOOKING_PERMISSION.VIEW);
}

export function canManageBookings(context: BranchContext) {
  return roles(context).some((role) => BOOKING_MANAGER_ROLES.has(role)) || hasPermission(context, BOOKING_PERMISSION.MANAGE);
}

export function canManageBookingSettings(context: BranchContext) {
  return roles(context).some((role) => BOOKING_MANAGER_ROLES.has(role)) || hasPermission(context, BOOKING_PERMISSION.SETTINGS);
}

export function canConfirmBookings(context: BranchContext) {
  return canManageBookings(context) || hasPermission(context, BOOKING_PERMISSION.CONFIRM);
}

export function canOverrideBookingConflict(context: BranchContext) {
  return roles(context).some((role) => BOOKING_MANAGER_ROLES.has(role)) || hasPermission(context, BOOKING_PERMISSION.OVERRIDE_CONFLICT);
}

export function bookingViewIsSelfOnly(context: BranchContext) {
  return roles(context).some((role) => role === "master" || role === "mechanic") && !canManageBookings(context);
}

export function requireBookingCapability(allowed: boolean, message = "Нет доступа к записям") {
  if (!allowed) throw new BookingError(message, "booking_access_denied", 403);
}
