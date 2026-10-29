import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'journal-visibility-'));
const mock = join(dir, 'mock.ts');
writeFileSync(mock, `
export const test:any = { queries: [], memberships: [], bookings: [], selfOnly: false };
export const requireBranchApi = async () => ({ ok: true, context: { branchId: 'dachnaya', userId: 'viewer', branch: { timezone: 'Europe/Kaliningrad' } } });
export const runWithBranchApiContext = (_context:any, operation:any) => operation();
export const bookingViewIsSelfOnly = () => test.selfOnly;
export const canViewBookings = () => true;
export const canConfirmBookings = () => true;
export const canManageBookings = () => true;
export const canOverrideBookingConflict = () => true;
export const requireBookingCapability = (allowed:boolean) => { if (!allowed) throw Error('Forbidden'); };
export const prisma = {
  branchMembership: {
    findFirst: async () => ({ id: 'own' }),
    findMany: async (query:any) => { test.queries.push(query); return test.memberships; },
  },
  booking: {
    count: async () => 0,
    findMany: async (query:any) => { test.queries.push(query); return test.bookings; },
  },
};
export const BOOKING_INCLUDE = {};
export const bookingManagementToken = () => '';
export const cancelBooking = () => { throw Error('Unexpected write'); };
export const createBooking = cancelBooking;
export const updateBooking = cancelBooking;
export const syncCatalogBookingServices = cancelBooking;
export const buildBookingManagementUrl = () => '';
export const notifyBookingCancelled = cancelBooking;
export const notifyBookingConfirmed = cancelBooking;
export const notifyBookingCreated = cancelBooking;
export const notifyBookingRescheduled = cancelBooking;
`);
const aliases = Object.fromEntries(['branch-api', 'db', 'booking/access', 'booking/service', 'booking/catalog-services', 'booking/management-url', 'booking/notifications'].map(name => ['@/lib/' + name, mock]));
const jiti = createJiti(import.meta.url, { alias: { '@': resolve('src'), ...aliases } });
const { GET } = await jiti.import('../src/app/api/booking-journal/route.ts');
const { test } = await jiti.import(mock);
const { visibleJournalStaff } = await jiti.import('../src/lib/booking/journal-staff.ts');
const { NextRequest } = await import('next/server.js');
const get = (query) => GET(new NextRequest('http://localhost/api/booking-journal?' + query));

test.memberships = [{ id: 'disabled-master', roleId: 'master', status: 'disabled', user: { name: 'Мастер', status: 'active' }, bookingServices: [{ serviceId: 'oil' }] }];
let response = await get('action=staff');
assert.equal(response.status, 200);
const [disabled] = (await response.json()).data;
assert.equal(disabled.bookable, false, 'Disabled master remains unavailable for new bookings');
assert.deepEqual(test.queries[0].where, { branchId: 'dachnaya', OR: [
  { roleId: 'master', status: 'active', user: { status: 'active' } },
  { assignedBookings: { some: { branchId: 'dachnaya' } } },
] }, 'Journal includes assigned disabled masters within the selected branch');
const staff = [...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, bookable: true })), disabled];
assert.equal(visibleJournalStaff(staff, [], '').length, 5);
assert.equal(visibleJournalStaff(staff, [{ staff_id: disabled.id }], '').length, 6, 'All columns, including disabled master with appointments, stay visible');
assert.deepEqual(visibleJournalStaff(staff, [{ staff_id: disabled.id }], String(disabled.id)), [disabled]);

test.queries = [];
response = await get('action=records&start_date=2026-10-29&end_date=2026-10-29');
assert.equal(response.status, 200);
assert.equal(test.queries[0].where.branchId, 'dachnaya');
assert.equal(test.queries[0].where.masterMembershipId, undefined, 'All-master query does not exclude disabled or unconfigured masters');
assert.equal(test.queries[0].where.startsAt.lt.toISOString(), '2026-10-29T22:00:00.000Z');
assert.equal(test.queries[0].where.endsAt.gt.toISOString(), '2026-10-28T22:00:00.000Z');
test.queries = [];
response = await get('action=records&start_date=2026-10-29&staff_id=' + disabled.id);
assert.equal(response.status, 200);
assert.deepEqual(test.queries[0].where, { branchId: 'dachnaya' });
assert.equal(test.queries[1].where.masterMembershipId, 'disabled-master');
test.selfOnly = true;
test.queries = [];
await get('action=staff');
assert.equal(test.queries[0].where.id, 'own', 'Mechanics keep their own-membership scope');
test.queries = [];
await get('action=records&start_date=2026-10-29&staff_id=' + disabled.id);
assert.equal(test.queries[0].where.masterMembershipId, 'own', 'Selecting another master cannot expand mechanic access');
console.log('PASS: disabled-master visibility, all masters, branch-local dates, branch and mechanic isolation.');
