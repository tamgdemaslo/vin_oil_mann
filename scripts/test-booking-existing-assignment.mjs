import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'booking-existing-assignment-'));
const mock = join(dir, 'db.ts');
writeFileSync(mock, `export const state:any = {}; export const prisma = { $transaction: async (operation:any) => operation(state.tx) }; export const createLocalAdminCounterparty = () => { throw Error('Unexpected client creation'); };`);
const jiti = createJiti(import.meta.url, { alias: { '@': resolve('src'), '@/lib/db': mock, '@/lib/local-inventory-admin': mock } });
const { state } = await jiti.import(mock);
const { getBookingAvailability } = await jiti.import('../src/lib/booking/availability.ts');
const { updateBooking } = await jiti.import('../src/lib/booking/service.ts');
const { retainsBookingAssignment } = await jiti.import('../src/lib/booking/existing-assignment.ts');
const { formatLocalDate, addLocalDays, zonedLocalToUtc } = await jiti.import('../src/lib/booking/timezone.ts');
const timezone = 'Europe/Kaliningrad';
const day = addLocalDays(formatLocalDate(new Date(), timezone), 1);
const target = zonedLocalToUtc(day, '12:00', timezone);
const oldStart = zonedLocalToUtc(day, '10:00', timezone);
const membership = { id: 'old-master', roleId: 'master', status: 'disabled', position: null, user: { name: 'Текущий мастер', status: 'active' } };
const branch = { id: 'dachnaya', name: 'Дачная', timezone, businessGroupId: 'group', bookingSettings: { publicBookingEnabled: true, bookingHorizonDays: 60, bookingStepMinutes: 30, minimumLeadMinutes: 0 } };
const services = [{ id: 'oil', branchId: branch.id, name: 'Замена масла', durationMinutes: 60, requiresVin: false, requiresConfirmation: false, requiredFieldsJson: [], onlineBookingEnabled: true }, { id: 'filter', branchId: branch.id, name: 'Фильтр', durationMinutes: 30 }];
const current = { id: 'existing', branchId: branch.id, branch, status: 'ACTIVE', masterMembershipId: membership.id, masterMembership: membership, serviceItems: [{ serviceId: 'oil' }], startsAt: oldStart, endsAt: new Date(oldStart.getTime() + 3600000), durationMinutes: 60, customerName: 'Клиент', phone: '+79990000000', clientId: 'client', vehicleId: null, vehicle: { id: 'car', counterpartyId: 'client', make: 'Toyota', model: 'Corolla' }, confirmationState: 'NOT_REQUIRED' };
let collision = false, closed = false, writeCount = 0;
const calls = [];
const tx = {
  $executeRaw: async () => 0,
  branch: { findFirst: async () => branch, findUnique: async () => branch },
  bookingService: { findMany: async ({ where }) => services.filter(s => where.id.in.includes(s.id)) },
  branchMembership: { findFirst: async ({ where }) => where.id === membership.id && (!where.status || where.status === membership.status) && where.branchId === branch.id && where.roleId === membership.roleId && membership.user.status === 'active' ? membership : null },
  bookingMasterService: { findMany: async () => [], count: async () => 0 },
  branchBookingWorkingHour: { findUnique: async () => ({ isWorking: true, startTime: '09:00', endTime: '18:00' }) },
  bookingMasterWorkingHour: { findMany: async () => [] },
  bookingScheduleException: { findMany: async () => closed ? [{ membershipId: membership.id, kind: "CLOSED" }] : [] },
  booking: {
    findFirst: async ({ where }) => { calls.push(where); return where.id === current.id && (!where.branchId || where.branchId === current.branchId) ? current : null; },
    findMany: async () => collision ? [{ id: 'other', masterMembershipId: membership.id, startsAt: target, endsAt: new Date(target.getTime() + 3600000) }] : [],
    count: async () => collision ? 1 : 0,
    update: async ({ data }) => { writeCount++; return { ...current, ...data }; },
  },
  localCounterparty: { findFirst: async () => ({ id: 'client' }), update: async () => ({ id: 'client' }) },
  branchAuditLog: { create: async () => ({}) },
};
state.tx = tx;
const input = { branchId: branch.id, localDate: day, serviceIds: ['oil'], masterMembershipId: membership.id, onlineOnly: false, respectLeadTime: false, excludeBookingId: current.id, preserveExistingAssignment: true };
let result = await getBookingAvailability(input, tx);
assert.ok(result.slots.some(s => s.startsAt === target.toISOString()), 'Staff can move an existing booking with its disabled master');
assert.deepEqual(calls.at(-1), { id: 'existing', branchId: 'dachnaya', status: 'ACTIVE' });
assert.equal((await getBookingAvailability({ ...input, preserveExistingAssignment: false }, tx)).slots.length, 0, 'Normal/new bookings retain assignment rules');
assert.equal((await getBookingAvailability({ ...input, onlineOnly: true }, tx)).slots.length, 0, 'Public booking cannot retain disabled assignment');
assert.equal((await getBookingAvailability({ ...input, branchId: 'other', excludeBookingId: 'foreign' }, tx)).slots.length, 0, 'Unknown or foreign booking cannot grant a master');
assert.equal((await getBookingAvailability({ ...input, masterMembershipId: 'another' }, tx)).slots.length, 0, 'Changing master requires valid assignment');
assert.equal((await getBookingAvailability({ ...input, serviceIds: ['oil', 'filter'] }, tx)).slots.length, 0, 'Adding services requires valid assignment');
assert.equal(retainsBookingAssignment(current, membership.id, ['oil', 'oil']), true);
assert.equal(retainsBookingAssignment(current, membership.id, ['filter']), false);
assert.equal(retainsBookingAssignment(null, membership.id, ['oil']), false);
collision = true;
assert.equal((await getBookingAvailability(input, tx)).slots.some(s => s.startsAt === target.toISOString()), false, 'Existing assignment still checks conflicts');
await assert.rejects(() => updateBooking(current.id, { startsAt: target, serviceIds: ['oil'] }, { kind: 'USER', userId: 'admin' }), e => e.code === 'booking_slot_taken');
assert.equal(writeCount, 0, 'Conflicting transfer is not saved');
collision = false;
closed = true;
assert.equal((await getBookingAvailability(input, tx)).slots.length, 0, 'A closed master schedule still blocks transfer');
await assert.rejects(() => updateBooking(current.id, { startsAt: target }, { kind: 'USER' }), e => e.code === 'booking_outside_schedule');
closed = false;
result = await updateBooking(current.id, { startsAt: target, serviceIds: ['oil'] }, { kind: 'USER', userId: 'admin' });
assert.equal(result.scheduleChanged, true);
assert.equal(result.booking.masterMembershipId, membership.id);
assert.equal(result.booking.startsAt.toISOString(), target.toISOString());
assert.equal(writeCount, 1, 'Transfer actually reaches the booking update');
membership.user.status = 'disabled';
assert.equal((await getBookingAvailability(input, tx)).slots.length, 0, 'Disabled user account is still unavailable');
await assert.rejects(() => updateBooking(current.id, { startsAt: target }, { kind: 'USER' }), e => e.code === 'booking_master_unavailable');
membership.user.status = 'active';
await assert.rejects(() => updateBooking(current.id, { startsAt: target, serviceIds: ['oil', 'filter'] }, { kind: 'USER' }), e => e.code === 'booking_master_unavailable');
await assert.rejects(() => updateBooking(current.id, { startsAt: target }, { kind: 'MANAGE_LINK' }), e => e.code === 'booking_master_unavailable');
const routeMock = join(dir, 'route.ts');
writeFileSync(routeMock, `
export const routeState:any = { manage: false, captured: null };
export const requireBranchApi = async () => ({ ok: true, context: { branchId: 'dachnaya' } });
export const runWithBranchApiContext = (_context:any, operation:any) => operation();
export const readableBranchIds = () => ['dachnaya'];
export const bookingViewIsSelfOnly = () => false;
export const canViewBookings = () => true;
export const canManageBookings = () => routeState.manage;
export const requireBookingCapability = () => {};
export const getBookingAvailability = async (input:any) => { routeState.captured = input; return { slots: [] }; };
`);
const routeJiti = createJiti(import.meta.url, { alias: { '@': resolve('src'), '@/lib/db': mock, ...Object.fromEntries(['branch-api', 'booking/access', 'booking/availability'].map(name => ['@/lib/' + name, routeMock])) } });
const { POST } = await routeJiti.import('../src/app/api/bookings/availability/route.ts');
const { routeState } = await routeJiti.import(routeMock);
const { NextRequest } = await import('next/server.js');
const preview = () => POST(new NextRequest('http://localhost/api/bookings/availability', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ localDate: day, serviceIds: ['oil'], excludeBookingId: current.id, preserveExistingAssignment: true }) }));
assert.equal((await preview()).status, 200);
assert.equal(routeState.captured.preserveExistingAssignment, false, 'Read-only callers cannot enable retention through request data');
routeState.manage = true;
assert.equal((await preview()).status, 200);
assert.equal(routeState.captured.preserveExistingAssignment, true, 'Authorized staff receive consistent transfer preview');
console.log('PASS: staff transfer saves with existing master; new/public/changed assignments stay restricted; conflicts remain blocked; preview capability is server-controlled.');
