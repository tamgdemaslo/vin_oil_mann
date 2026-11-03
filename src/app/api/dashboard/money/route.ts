import { NextResponse } from 'next/server';
import { requireBranchApi } from '@/lib/branch-api';
import { getDashboardMoney } from '@/lib/dashboard-money';
export const dynamic = 'force-dynamic';
export async function GET() {
  const access = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!access.ok) return access.response;
  // Preserve the existing owner-only financial overview boundary.
  if (access.context.user.role !== 'owner' && access.context.groupRole !== 'group_owner') return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
  try {
    return NextResponse.json(await getDashboardMoney(access.context), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Не удалось загрузить остатки денег' }, { status: 502 });
  }
}
