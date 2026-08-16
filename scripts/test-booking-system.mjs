#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const source = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
});

process.env.BOOKING_MANAGEMENT_TOKEN_SECRET = "booking-test-secret-with-enough-entropy";
const timezone = await jiti.import("../src/lib/booking/timezone.ts");
const tokens = await jiti.import("../src/lib/booking/management-token.ts");
const { getBookingAvailability } = await jiti.import("../src/lib/booking/availability.ts");

assert.equal(
  timezone.zonedLocalToUtc("2026-08-16", "10:30", "Europe/Kaliningrad").toISOString(),
  "2026-08-16T08:30:00.000Z",
);
assert.equal(
  timezone.formatLocalTime(new Date("2026-08-16T08:30:00.000Z"), "Europe/Kaliningrad"),
  "10:30",
);
assert.throws(
  () => timezone.zonedLocalToUtc("2026-03-29", "02:30", "Europe/Berlin"),
  /недоступно из-за перевода часов/,
);

const handle = tokens.createManagementHandle();
const token = tokens.createManagementToken(handle, 1);
assert.deepEqual(tokens.verifyManagementToken(token), { handle, version: 1 });
assert.throws(() => tokens.verifyManagementToken(`${token}tampered`), /недействительна/);
assert.notEqual(tokens.createManagementHandle(), handle);

function availabilityDb(overrides = {}) {
  const services = overrides.services ?? [
    { id: "oil", branchId: "branch-a", name: "Моторное масло", durationMinutes: 60, onlineBookingEnabled: true, requiresVin: false, requiresConfirmation: false },
    { id: "filter", branchId: "branch-a", name: "Фильтр", durationMinutes: 30, onlineBookingEnabled: true, requiresVin: false, requiresConfirmation: false },
    { id: "atf", branchId: "branch-a", name: "АКПП", durationMinutes: 120, onlineBookingEnabled: true, requiresVin: true, requiresConfirmation: true },
    { id: "hidden", branchId: "branch-a", name: "Скрытая", durationMinutes: 60, onlineBookingEnabled: false, requiresVin: false, requiresConfirmation: false },
  ];
  const masters = {
    "master-1": { id: "master-1", position: "Мастер", status: "active", user: { name: "Александр", status: "active" } },
    "master-2": { id: "master-2", position: "Мастер", status: "active", user: { name: "Кирилл", status: "active" } },
  };
  const assignments = overrides.assignments ?? [
    ["master-1", "oil"], ["master-1", "filter"], ["master-1", "atf"], ["master-2", "oil"],
  ];
  const masterHours = overrides.masterHours ?? [
    { membershipId: "master-1", weekday: 1, isWorking: true, startTime: "09:00", endTime: "18:00" },
    { membershipId: "master-2", weekday: 1, isWorking: true, startTime: "09:00", endTime: "18:00" },
  ];
  const exceptions = overrides.exceptions ?? [];
  const busy = overrides.busy ?? [];
  const settings = {
    publicBookingEnabled: overrides.publicBookingEnabled ?? true,
    bookingHorizonDays: 60,
    bookingStepMinutes: 30,
    minimumLeadMinutes: 0,
  };
  return {
    branch: {
      findFirst: async () => ({ id: "branch-a", name: "Дачная", timezone: "Europe/Kaliningrad", bookingSettings: settings }),
    },
    bookingService: {
      findMany: async ({ where }) => services.filter((service) =>
        where.id.in.includes(service.id) && service.branchId === where.branchId && service.status !== "INACTIVE" &&
        (!where.onlineBookingEnabled || service.onlineBookingEnabled)
      ),
    },
    bookingMasterService: {
      findMany: async ({ where }) => assignments
        .filter(([membershipId, serviceId]) => where.serviceId.in.includes(serviceId) && (!where.membershipId || where.membershipId === membershipId))
        .map(([membershipId, serviceId]) => ({ branchId: "branch-a", membershipId, serviceId, membership: masters[membershipId] })),
    },
    branchBookingWorkingHour: {
      findUnique: async () => ({ weekday: 1, isWorking: true, startTime: "09:00", endTime: "18:00" }),
    },
    bookingMasterWorkingHour: {
      findMany: async ({ where }) => masterHours.filter((row) => where.membershipId.in.includes(row.membershipId) && row.weekday === where.weekday),
    },
    bookingScheduleException: {
      findMany: async ({ where }) => exceptions.filter((row) => where.membershipId.in.includes(row.membershipId) && row.localDate === where.localDate),
    },
    booking: { findMany: async () => busy },
  };
}

const availabilityInput = {
  branchId: "branch-a",
  localDate: "2026-08-17",
  serviceIds: ["oil"],
  onlineOnly: true,
  respectLeadTime: false,
  now: new Date("2026-08-16T08:00:00.000Z"),
};

const twoMasters = await getBookingAvailability(availabilityInput, availabilityDb());
assert.equal(twoMasters.durationMinutes, 60);
assert.deepEqual(new Set(twoMasters.slots.filter((slot) => slot.localTime === "09:00").map((slot) => slot.master.name)), new Set(["Александр", "Кирилл"]));

const combined = await getBookingAvailability({ ...availabilityInput, serviceIds: ["oil", "filter"] }, availabilityDb());
assert.equal(combined.durationMinutes, 90);
assert.deepEqual(new Set(combined.slots.map((slot) => slot.master.membershipId)), new Set(["master-1"]));

const busyAtTen = [{ id: "busy", masterMembershipId: "master-1", startsAt: new Date("2026-08-17T08:00:00.000Z"), endsAt: new Date("2026-08-17T09:00:00.000Z") }];
const longWithConflict = await getBookingAvailability({ ...availabilityInput, serviceIds: ["atf"], masterMembershipId: "master-1" }, availabilityDb({ busy: busyAtTen }));
assert.equal(longWithConflict.requiresVin, true);
assert.equal(longWithConflict.requiresConfirmation, true);
assert.equal(longWithConflict.slots.some((slot) => slot.localTime === "09:00" || slot.localTime === "10:00"), false);
assert.equal(longWithConflict.slots.some((slot) => slot.localTime === "11:00"), true);

const closedByException = await getBookingAvailability(
  { ...availabilityInput, serviceIds: ["oil", "filter"] },
  availabilityDb({ exceptions: [{ membershipId: "master-1", localDate: "2026-08-17", kind: "CLOSED", startTime: null, endTime: null }] }),
);
assert.equal(closedByException.slots.length, 0);

const dayOff = await getBookingAvailability(
  { ...availabilityInput, serviceIds: ["oil"] },
  availabilityDb({ masterHours: [
    { membershipId: "master-1", weekday: 1, isWorking: false, startTime: null, endTime: null },
    { membershipId: "master-2", weekday: 1, isWorking: false, startTime: null, endTime: null },
  ] }),
);
assert.equal(dayOff.slots.length, 0);

const inheritedBranchHours = await getBookingAvailability(
  { ...availabilityInput, serviceIds: ["oil"] },
  availabilityDb({ masterHours: [] }),
);
assert.deepEqual(
  new Set(inheritedBranchHours.slots.filter((slot) => slot.localTime === "09:00").map((slot) => slot.master.name)),
  new Set(["Александр", "Кирилл"]),
);

await assert.rejects(
  () => getBookingAvailability({ ...availabilityInput, serviceIds: ["hidden"] }, availabilityDb()),
  /недоступна для записи/,
);
await assert.rejects(
  () => getBookingAvailability(availabilityInput, availabilityDb({ publicBookingEnabled: false })),
  /временно закрыта/,
);

const schema = source("prisma/schema.prisma");
for (const model of [
  "BranchBookingSettings",
  "BranchBookingWorkingHour",
  "BookingService",
  "BookingMasterService",
  "BookingMasterWorkingHour",
  "BookingScheduleException",
  "ClientVehicle",
  "Booking",
  "BookingServiceItem",
]) {
  assert.match(schema, new RegExp(`model ${model}\\b`));
}
assert.match(schema, /legacyExternalId\s+String\?/);
assert.match(schema, /@@unique\(\[branchId, legacyExternalId\]\)/);

const service = source("src/lib/booking/service.ts");
assert.match(service, /pg_advisory_xact_lock/);
assert.match(service, /TransactionIsolationLevel\.Serializable/);
assert.match(service, /startsAt: \{ lt: input\.endsAt \}/);
assert.match(service, /endsAt: \{ gt: input\.startsAt \}/);
assert.match(service, /booking\.created/);
assert.match(service, /booking\.rescheduled/);
assert.match(service, /booking\.cancelled/);
assert.ok(
  service.indexOf('lockKeys(tx, [`booking:${bookingId}`])') < service.indexOf("const current = await tx.booking.findFirst", service.indexOf("export async function rescheduleBooking")),
  "reschedule must lock the booking before reading mutable state",
);

const availability = source("src/lib/booking/availability.ts");
assert.match(availability, /branchBookingWorkingHour/);
assert.match(availability, /bookingMasterWorkingHour/);
assert.match(availability, /bookingScheduleException/);
assert.match(availability, /status: BOOKING_STATUS\.ACTIVE/);

const publicCreate = source("src/app/api/public/booking/route.ts");
assert.match(publicCreate, /checkPublicRateLimit/);
assert.match(publicCreate, /hasLeadHoneypot/);
assert.match(publicCreate, /notifyBookingCreated/);
assert.match(publicCreate, /clientId: null/);

const customerLookup = source("src/app/api/public/booking/customer-lookup/route.ts");
assert.doesNotMatch(customerLookup, /customer:\s*\{/);

const records = source("src/app/records/RecordsPageClient.tsx");
assert.doesNotMatch(records, /\/api\/yclients/);
assert.match(records, /\/api\/booking-journal/);

const agentTools = source("src/lib/ai-agent/tools.ts");
assert.doesNotMatch(agentTools, /getYclientsAvailableSlots|createYclientsAppointment|parseYclientsSlotId/);
assert.match(agentTools, /getInternalAvailableSlots/);

const dashboard = source("src/app/api/dashboard/operations/route.ts");
assert.doesNotMatch(dashboard, /getYclientsBranchConfig|listYclientsTodayAppointments/);
assert.match(dashboard, /listAppointmentRowsForDate/);

const notificationWorker = source("src/lib/client-notifications/worker.ts");
assert.doesNotMatch(notificationWorker, /syncRecentYclientsRecordNotifications/);

const legacyRoute = source("src/app/api/yclients/route.ts");
const mutationHandlers = legacyRoute.slice(legacyRoute.indexOf("export async function POST"));
assert.doesNotMatch(mutationHandlers, /yclientsRequest\(/);
assert.match(mutationHandlers, /status: 410/);

const legacyAppointments = source("src/app/api/appointments/route.ts");
assert.match(legacyAppointments, /legacy_booking_disabled/);
assert.match(legacyAppointments, /status: 410/);

console.log("booking system regression checks passed");
