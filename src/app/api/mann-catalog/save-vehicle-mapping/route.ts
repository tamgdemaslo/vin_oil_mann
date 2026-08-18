import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { normalizeEngineCode, normalizeVehicleMake, normalizeVehicleModel } from "@/lib/vehicle-identity";
import { normalizeMannSearchText } from "@/lib/mann-catalog";

const schema = z.object({
  organizationId: z.string().trim().min(1).max(128).optional(),
  make: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(160),
  sourceModel: z.string().trim().min(1).max(160).optional(),
  generation: z.string().trim().max(24).optional(),
  bodyCodes: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  variantId: z.string().trim().min(1).max(128),
  yearFrom: z.number().int().min(1900).max(2100).optional(),
  yearTo: z.number().int().min(1900).max(2100).optional(),
  engineCode: z.string().trim().max(80).optional(),
  engineVolumeCc: z.number().int().min(1).max(20_000).optional(),
  powerKw: z.number().int().min(1).max(3_000).optional(),
  powerHp: z.number().int().min(1).max(4_000).optional(),
  fuelType: z.string().trim().max(40).optional(),
  driveType: z.string().trim().max(80).optional(),
  transmissionType: z.string().trim().max(80).optional(),
});

export async function POST(request: NextRequest) {
  const access = await requireApiSessionWithCashShift();
  if (!access.ok) return access.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте параметры сопоставления" }, { status: 400 });
  const make = normalizeVehicleMake(parsed.data.make);
  const model = normalizeVehicleModel(parsed.data.model, make).canonical;
  if (!make || !model) return NextResponse.json({ error: "Не удалось нормализовать марку и модель" }, { status: 400 });
  const mapping = await prisma.vehicleMannMapping.create({
    data: {
      organizationId: parsed.data.organizationId ?? "default",
      normalizedMake: make,
      normalizedModel: normalizeMannSearchText(model),
      normalizedGeneration: parsed.data.generation?.toUpperCase() || undefined,
      bodyCodesJson: parsed.data.bodyCodes?.map((code) => code.toUpperCase()) ?? [],
      yearFrom: parsed.data.yearFrom,
      yearTo: parsed.data.yearTo,
      engineCode: normalizeEngineCode(parsed.data.engineCode),
      engineFamily: normalizeEngineCode(parsed.data.engineCode)?.replace(/(?:[A-Z]?\d{0,2})$/i, "") || undefined,
      engineVolumeCc: parsed.data.engineVolumeCc,
      powerKw: parsed.data.powerKw,
      powerHp: parsed.data.powerHp,
      fuelType: parsed.data.fuelType?.toLowerCase(),
      driveType: parsed.data.driveType,
      transmissionType: parsed.data.transmissionType,
      mannApplicationId: parsed.data.variantId,
      source: "manual",
      confidence: "high",
      confirmedById: access.session.user.login,
    },
  });
  if (parsed.data.sourceModel) {
    await prisma.vehicleModelAlias.upsert({
      where: { normalizedMake_sourceName: { normalizedMake: make, sourceName: parsed.data.sourceModel } },
      create: {
        normalizedMake: make,
        sourceName: parsed.data.sourceModel,
        canonicalBaseModel: normalizeMannSearchText(model),
        canonicalGeneration: parsed.data.generation?.toUpperCase() || undefined,
        bodyCodesJson: parsed.data.bodyCodes?.map((code) => code.toUpperCase()) ?? [],
        source: "manual",
        confirmedById: access.session.user.login,
      },
      update: {
        canonicalBaseModel: normalizeMannSearchText(model),
        canonicalGeneration: parsed.data.generation?.toUpperCase() || undefined,
        bodyCodesJson: parsed.data.bodyCodes?.map((code) => code.toUpperCase()) ?? [],
        confirmedById: access.session.user.login,
      },
    });
  }
  return NextResponse.json({ mapping });
}
