import { NextRequest, NextResponse } from "next/server";
import { canManageBookingSettings, requireBookingCapability } from "@/lib/booking/access";
import { isCatalogBookingServiceId } from "@/lib/booking/catalog-services";
import { BookingError, bookingErrorPayload } from "@/lib/booking/errors";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права изменять услуги");
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new BookingError("Неверное тело запроса", "booking_service_invalid");
    const current = await runWithBranchApiContext(access.context, () => prisma.bookingService.findFirst({ where: { id, branchId: access.context.branchId! } }));
    if (!current) throw new BookingError("Услуга не найдена", "booking_service_not_found", 404);
    const catalogManaged = isCatalogBookingServiceId(id);
    const durationMinutes = body.durationMinutes === undefined ? current.durationMinutes : Math.trunc(Number(body.durationMinutes));
    if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 1_440) {
      throw new BookingError("Некорректная длительность услуги", "booking_service_duration_invalid");
    }
    const service = await runWithBranchApiContext(access.context, () => prisma.bookingService.update({
      where: { branchId_id: { branchId: access.context.branchId!, id } },
      data: {
        name: !catalogManaged && typeof body.name === "string" ? body.name.trim().slice(0, 180) || current.name : undefined,
        description: !catalogManaged && typeof body.description === "string" ? body.description.trim().slice(0, 2_000) || null : undefined,
        durationMinutes,
        onlineBookingEnabled: typeof body.onlineBookingEnabled === "boolean" ? body.onlineBookingEnabled : undefined,
        requiresVin: typeof body.requiresVin === "boolean" ? body.requiresVin : undefined,
        requiresConfirmation: typeof body.requiresConfirmation === "boolean" ? body.requiresConfirmation : undefined,
        requiredFieldsJson: Array.isArray(body.requiredFields) || Array.isArray(body.requiredFieldsJson)
          ? [...new Set((Array.isArray(body.requiredFields) ? body.requiredFields : body.requiredFieldsJson as unknown[]).map(String))]
              .filter((field) => ["email", "plate", "year", "vin"].includes(field))
              .slice(0, 20)
          : undefined,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : undefined,
        status: catalogManaged ? undefined : body.status === "INACTIVE" ? "INACTIVE" : body.status === "ACTIVE" ? "ACTIVE" : undefined,
      },
    }));
    return NextResponse.json({ service });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  try {
    requireBookingCapability(canManageBookingSettings(access.context), "Нет права отключать услуги");
    const { id } = await context.params;
    if (isCatalogBookingServiceId(id)) {
      throw new BookingError("Каталожную услугу можно скрыть из онлайн-записи или архивировать в каталоге", "booking_catalog_service_managed", 409);
    }
    const result = await runWithBranchApiContext(access.context, () => prisma.bookingService.updateMany({
      where: { id, branchId: access.context.branchId! },
      data: { status: "INACTIVE", onlineBookingEnabled: false },
    }));
    if (!result.count) throw new BookingError("Услуга не найдена", "booking_service_not_found", 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
