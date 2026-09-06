import type { BookingWithDetails } from "./service";

function vehicleDto(vehicle: BookingWithDetails["vehicle"]) {
  if (!vehicle) return null;
  return {
    id: vehicle.id,
    make: vehicle.make,
    model: vehicle.model,
    generation: vehicle.generation,
    year: vehicle.year,
    plate: vehicle.plate,
    vin: vehicle.vin,
  };
}

function snapshotVehicleDto(value: BookingWithDetails["vehicleSnapshot"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const vehicle = value as Record<string, unknown>;
  const make = typeof vehicle.make === "string" ? vehicle.make : "";
  const model = typeof vehicle.model === "string" ? vehicle.model : "";
  if (!make || !model) return null;
  const year = typeof vehicle.year === "number" && Number.isInteger(vehicle.year) ? vehicle.year : null;
  return {
    id: null,
    make,
    model,
    generation: typeof vehicle.generation === "string" ? vehicle.generation : null,
    year,
    plate: typeof vehicle.plate === "string" ? vehicle.plate : null,
    vin: typeof vehicle.vin === "string" ? vehicle.vin : null,
  };
}

export function bookingDto(booking: BookingWithDetails) {
  return {
    id: booking.id,
    branchId: booking.branchId,
    branch: {
      id: booking.branch.id,
      name: booking.branch.name,
      timezone: booking.branch.timezone,
      address: booking.branch.address,
      phone: booking.branch.phone,
    },
    client: booking.client ? {
      id: booking.client.id,
      name: booking.client.name,
      phone: booking.client.phone,
      email: booking.client.email,
    } : null,
    customerName: booking.customerName,
    phone: booking.phone,
    email: booking.email,
    vehicle: vehicleDto(booking.vehicle) ?? snapshotVehicleDto(booking.vehicleSnapshot),
    master: booking.masterMembership ? {
      membershipId: booking.masterMembership.id,
      name: booking.masterMembership.user.name,
      position: booking.masterMembership.position,
    } : null,
    services: booking.serviceItems.map((item) => ({
      id: item.serviceId,
      name: item.serviceNameSnapshot,
      durationMinutes: item.durationMinutesSnapshot,
    })),
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    durationMinutes: booking.durationMinutes,
    source: booking.source,
    status: booking.status,
    requiresConfirmation: booking.requiresConfirmation,
    confirmationState: booking.confirmationState,
    comment: booking.comment,
    internalComment: booking.internalComment,
    conflictOverride: booking.conflictOverride,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    cancellationReason: booking.cancellationReason,
    confirmedAt: booking.confirmedAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}

export function publicManagedBookingDto(booking: BookingWithDetails) {
  const full = bookingDto(booking);
  return {
    id: full.id,
    branch: full.branch,
    customerName: full.customerName,
    vehicle: full.vehicle,
    master: full.master,
    services: full.services,
    startsAt: full.startsAt,
    endsAt: full.endsAt,
    durationMinutes: full.durationMinutes,
    status: full.status,
    requiresConfirmation: full.requiresConfirmation,
    confirmationState: full.confirmationState,
    comment: full.comment,
    cancellationReason: full.cancellationReason,
  };
}
