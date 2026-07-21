import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { normalizeEngineCode, normalizeVehicleMake, normalizeVehicleModel } from "@/lib/vehicle-identity";
import { normalizeMannSearchText } from "@/lib/mann-catalog";

const schema = z.object({
  organizationId: z.string().trim().min(1).max(128).optional(),
  make: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(160),
  variantId: z.string().trim().min(1).max(128),
  yearFrom: z.number().int().min(1900).max(2100).optional(),
  yearTo: z.number().int().min(1900).max(2100).optional(),
  engineCode: z.string().trim().max(80).optional(),
  engineVolumeCc: z.number().int().min(1).max(20_000).optional(),
  powerKw: z.number().int().min(1).max(3_000).optional(),
  driveType: z.string().trim().max(80).optional(),
  transmissionType: z.string().trim().max(80).optional(),
});

export async function POST(request: NextRequest) {
  const access = await requireApiSessionWithShift();
  if (!access.ok) return access.response;
  if (access.session.user.role === "master") return NextResponse.json({ error: "Подтвердить сопоставление MANN может администратор или владелец" }, { status: 403 });
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
      yearFrom: parsed.data.yearFrom,
      yearTo: parsed.data.yearTo,
      engineCode: normalizeEngineCode(parsed.data.engineCode),
      engineVolumeCc: parsed.data.engineVolumeCc,
      powerKw: parsed.data.powerKw,
      driveType: parsed.data.driveType,
      transmissionType: parsed.data.transmissionType,
      mannApplicationId: parsed.data.variantId,
      source: "manual",
      confidence: "high",
      confirmedById: access.session.user.login,
    },
  });
  return NextResponse.json({ mapping });
}
