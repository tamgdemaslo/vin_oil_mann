import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { prisma } from "@/lib/db";
import { vehicleFieldValues, type NormalizedVehicleIdentity } from "@/lib/vehicle-identity";

const schema = z.object({
  shipmentId: z.string().trim().min(1).max(128),
  organizationId: z.string().trim().min(1).max(128).optional(),
  strategy: z.enum(["empty", "replace"]).default("empty"),
  vehicle: z.custom<NormalizedVehicleIdentity>((value) => Boolean(value) && typeof value === "object"),
});

type Attribute = { id?: string; definitionId?: string; name?: string; type?: string; value?: unknown; source?: string; [key: string]: unknown };

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, "е");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function isAttribute(value: unknown): value is Attribute {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  const access = await requireApiSessionWithCashShift();
  if (!access.ok) return access.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Передайте отгрузку и найденный автомобиль" }, { status: 400 });
  const shipment = await prisma.localDemand.findUnique({ select: { id: true, branchId: true, applicable: true, organizationId: true, attributes: true }, where: { id: parsed.data.shipmentId } });
  if (!shipment) return NextResponse.json({ error: "Отгрузка не найдена" }, { status: 404 });
  if (shipment.applicable) return NextResponse.json({ error: "Проведённую отгрузку нельзя изменить напрямую" }, { status: 400 });
  if (parsed.data.organizationId && shipment.organizationId && parsed.data.organizationId !== shipment.organizationId) {
    return NextResponse.json({ error: "Отгрузка относится к другой организации" }, { status: 403 });
  }

  const rawAttributes: unknown[] = Array.isArray(shipment.attributes) ? shipment.attributes as unknown[] : [];
  const attributes = rawAttributes.filter(isAttribute);
  const values = vehicleFieldValues(parsed.data.vehicle);
  const changed: string[] = [];
  for (const [name, field] of Object.entries(values)) {
    if (!field?.value) continue;
    const index = attributes.findIndex((attribute) => normalizeName(text(attribute.name)) === normalizeName(name));
    if (index >= 0) {
      const current = attributes[index];
      if (parsed.data.strategy === "empty" && text(current?.value)) continue;
      attributes[index] = { ...current, value: field.value, source: field.source };
      changed.push(name);
      continue;
    }
    attributes.push({
      id: `vehicle-lookup-${normalizeName(name).replace(/\s+/g, "-")}`,
      name,
      type: "string",
      value: field.value,
      source: field.source,
    });
    changed.push(name);
  }
  await prisma.localDemand.update({ where: { id: shipment.id }, data: { attributes: attributes as Prisma.InputJsonValue } });
  const organizationId = shipment.organizationId ?? parsed.data.organizationId ?? "default";
  await prisma.$executeRaw`
    INSERT INTO integration_audit_logs
      (id, branch_id, organization_id, channel, messenger_account_id, actor_id, action, status, message, metadata_json, created_at)
    VALUES
      (${crypto.randomUUID()}, ${shipment.branchId}, ${organizationId}, ${"tronk"}, ${null}, ${access.session.user.login}, ${"vehicle_lookup.apply_to_shipment"}, ${"ok"}, ${null},
       ${JSON.stringify({ shipmentId: shipment.id, changed, strategy: parsed.data.strategy, sourceMethods: parsed.data.vehicle.sourceMethods })}::jsonb, now())
  `.catch(() => undefined);
  return NextResponse.json({ ok: true, changed });
}
