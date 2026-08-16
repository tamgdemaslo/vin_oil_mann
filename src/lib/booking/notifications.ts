import {
  enqueueClientNotificationEvent,
  handleAppointmentCancelled,
  handleAppointmentCreated,
  handleAppointmentUpdated,
  processDueClientNotificationJobs,
  type NotificationEventContext,
} from "@/lib/client-notifications/client-notifications";
import { runWithRequestTenant } from "@/lib/request-tenant-store";
import type { BookingWithDetails } from "./service";

function tenantFor(booking: BookingWithDetails) {
  return {
    mode: "branch" as const,
    branchId: booking.branchId,
    organizationId: booking.branch.legacyOrganizationId ?? booking.branchId,
    allowedBranchIds: [booking.branchId],
    businessGroupId: booking.branch.businessGroupId,
    userId: booking.createdByUserId,
    permissions: [],
  };
}

function contextFor(booking: BookingWithDetails, managementUrl?: string | null): NotificationEventContext {
  const vehicle = booking.vehicle;
  return {
    clientId: booking.clientId,
    clientName: booking.customerName,
    clientPhone: booking.phone,
    appointmentId: booking.id,
    appointmentAt: booking.startsAt,
    car: vehicle ? [vehicle.make, vehicle.model, vehicle.plate].filter(Boolean).join(" · ") : null,
    carMake: vehicle?.make,
    carModel: vehicle?.model,
    licensePlate: vehicle?.plate,
    vin: booking.vin,
    serviceList: booking.serviceItems.map((item) => item.serviceNameSnapshot).join(", "),
    masterName: booking.masterMembership?.user.name,
    organizationName: booking.branch.name,
    locationName: booking.branch.name,
    locationAddress: booking.branch.address,
    publicPhone: booking.branch.phone,
    bookingUrl: managementUrl,
    branchId: booking.branchId,
    branchName: booking.branch.name,
    address: booking.branch.address,
    companyPhone: booking.branch.phone,
    status: booking.status,
    isCancelled: booking.status === "CANCELLED",
    initiatedById: booking.createdByUserId,
    source: booking.source,
    payload: {
      bookingSource: booking.source,
      confirmationState: booking.confirmationState,
      requiresConfirmation: booking.requiresConfirmation,
    },
  };
}

export async function notifyBookingCreated(booking: BookingWithDetails, managementUrl?: string | null) {
  return runWithRequestTenant(tenantFor(booking), async () => {
    await handleAppointmentCreated({
      ...contextFor(booking, managementUrl),
      source: booking.source === "PUBLIC" ? "client" : "admin",
    });
  });
}

export async function notifyBookingRescheduled(booking: BookingWithDetails, managementUrl?: string | null) {
  return runWithRequestTenant(tenantFor(booking), async () => {
    const context = contextFor(booking, managementUrl);
    await handleAppointmentUpdated(context);
    await enqueueClientNotificationEvent("appointment_rescheduled", context);
    await processDueClientNotificationJobs(10);
  });
}

export async function notifyBookingCancelled(booking: BookingWithDetails, managementUrl?: string | null) {
  return runWithRequestTenant(tenantFor(booking), async () => {
    const context = contextFor(booking, managementUrl);
    await handleAppointmentCancelled(booking.id);
    await enqueueClientNotificationEvent("appointment_cancelled", context);
    await processDueClientNotificationJobs(10);
  });
}

export async function notifyBookingConfirmed(booking: BookingWithDetails, managementUrl?: string | null) {
  return runWithRequestTenant(tenantFor(booking), async () => {
    await enqueueClientNotificationEvent("appointment_confirmed", contextFor(booking, managementUrl));
    await processDueClientNotificationJobs(10);
  });
}
