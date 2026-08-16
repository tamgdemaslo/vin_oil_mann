import { NextRequest, NextResponse } from "next/server";
import { canManageBookingSettings, requireBookingCapability } from "@/lib/booking/access";
import { BookingError, bookingErrorPayload } from "@/lib/booking/errors";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

function serviceData(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 180) : "";
  const durationMinutes = Math.trunc(Number(body.durationMinutes));
  if (!name) throw new BookingError("Укажите название услуги", "booking_service_name_required");
  if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 1_440) {
    throw new BookingError("Длительность услуги должна быть от 5 минут до 24 часов", "booking_service_duration_invalid");
  }
  const requiredFieldsSource = Array.isArray(body.requiredFields)
    ? body.requiredFields
    : Array.isArray(body.requiredFieldsJson) ? body.requiredFieldsJson : [];
  const requiredFieldsJson = [...new Set(requiredFieldsSource.map(String))]
    .filter((field) => ["email", "plate", "year", "vin"].includes(field))
    .slice(0, 20);
  return {
    name,
    description: typeof body.description === "string" ? body.description.trim().slice(0, 2_000) || null : null,
    durationMinutes,
    onlineBookingEnabled: body.onlineBookingEnabled === true,
    requiresVin: body.requiresVin === true,
    requiresConfirmation: body.requiresConfirmation === true,
    requiredFieldsJson,
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0,
  };
}

export async function GET() {
  const access = await requireBranchApi({ allowAll: false, requireActive: false });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права просматривать настройки услуг");
    const services = await runWithBranchApiContext(access.context, () => prisma.bookingService.findMany({
      where: { branchId: access.context.branchId! },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }));
    return NextResponse.json({ services });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права изменять услуги");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new BookingError("Неверное тело запроса", "booking_service_invalid");
    const service = await runWithBranchApiContext(access.context, () => prisma.bookingService.create({
      data: { branchId: access.context.branchId!, ...serviceData(body) },
    }));
    await runWithBranchApiContext(access.context, () => prisma.branchAuditLog.create({ data: {
      businessGroupId: access.context.businessGroupId,
      branchId: access.context.branchId,
      userId: access.context.userId,
      action: "booking.service.created",
      entityType: "booking_service",
      entityId: service.id,
      metadata: { name: service.name },
    } }));
    return NextResponse.json({ service }, { status: 201 });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
