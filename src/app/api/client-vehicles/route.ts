import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession, requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { requireBranchApi } from "@/lib/branch-api";
import {
  type ClientVehiclePassportValues,
  normalizeManualVehicleProfile,
  vehicleIdentityToProfileWrite,
} from "@/lib/client-vehicle-profile";
import { listClientVehicleProfiles, upsertClientVehicleProfile } from "@/lib/client-vehicle-profile-server";
import type { NormalizedVehicleIdentity } from "@/lib/vehicle-identity";

const writeSchema = z.object({
  counterpartyId: z.string().trim().min(1).max(160),
  vehicleId: z.string().trim().min(1).max(160).nullable().optional(),
  mode: z.enum(["auto", "confirmed"]),
  vehicle: z.custom<Partial<NormalizedVehicleIdentity>>((value) => Boolean(value) && typeof value === "object").optional(),
  values: z.custom<ClientVehiclePassportValues>((value) => Boolean(value) && typeof value === "object").optional(),
  mannVariantIds: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
}).superRefine((value, context) => {
  if (!value.vehicle && !value.values) context.addIssue({ code: "custom", message: "Передайте данные автомобиля" });
  if (value.mode === "auto" && !value.vehicle) context.addIssue({ code: "custom", message: "Для автозаполнения передайте результат определения" });
});

export async function GET(request: NextRequest) {
  const sessionAccess = await requireApiSession();
  if (!sessionAccess.ok) return sessionAccess.response;
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;
  const counterpartyId = request.nextUrl.searchParams.get("counterpartyId")?.trim() ?? "";
  if (!counterpartyId) return NextResponse.json({ error: "Укажите клиента" }, { status: 400 });
  const profiles = await listClientVehicleProfiles({ branchId: branchAccess.context.branchId!, counterpartyId });
  return NextResponse.json({ profiles }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const sessionAccess = await requireApiSessionWithCashShift();
  if (!sessionAccess.ok) return sessionAccess.response;
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;
  const parsed = writeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте данные автомобиля" }, { status: 400 });

  const write = parsed.data.mode === "auto"
    ? vehicleIdentityToProfileWrite(parsed.data.vehicle ?? {})
    : normalizeManualVehicleProfile(parsed.data.values ?? {});
  const result = await upsertClientVehicleProfile({
    branchId: branchAccess.context.branchId!,
    counterpartyId: parsed.data.counterpartyId,
    vehicleId: parsed.data.vehicleId,
    write,
    mode: parsed.data.mode,
    mannVariantIds: parsed.data.mannVariantIds,
    actor: { login: sessionAccess.session.user.login, name: sessionAccess.session.user.name },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
