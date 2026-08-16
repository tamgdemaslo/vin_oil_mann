import { NextRequest, NextResponse } from "next/server";
import { canManageBookingSettings, requireBookingCapability } from "@/lib/booking/access";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { getLegacyBookingImportStatus, importLegacyYclientsBookings } from "@/lib/booking/legacy-import";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";

export async function GET() {
  const access = await requireBranchApi({ allowAll: false, requireActive: false });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права просматривать импорт записей");
    const migration = await runWithBranchApiContext(access.context, () => getLegacyBookingImportStatus(access.context.branchId!));
    return NextResponse.json({ migration });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права импортировать архив записей");
    const body = await request.json().catch(() => null) as { fromDate?: unknown; toDate?: unknown } | null;
    const today = new Date().toISOString().slice(0, 10);
    const result = await runWithBranchApiContext(access.context, () => importLegacyYclientsBookings({
      branchId: access.context.branchId!,
      businessGroupId: access.context.businessGroupId,
      userId: access.context.userId,
      fromDate: typeof body?.fromDate === "string" ? body.fromDate : "2020-01-01",
      toDate: typeof body?.toDate === "string" ? body.toDate : today,
    }));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
