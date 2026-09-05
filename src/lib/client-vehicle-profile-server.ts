import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CLIENT_VEHICLE_PASSPORT_FIELDS,
  type ClientVehicleFieldSource,
  type ClientVehiclePassportField,
  type ClientVehiclePassportValues,
  type ClientVehicleProfile,
  type ClientVehicleProfileWrite,
  type ClientVehicleVerificationStatus,
  type ClientVehicleWriteMode,
  mergeClientVehiclePassport,
} from "@/lib/client-vehicle-profile";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function fieldSources(value: unknown): Partial<Record<ClientVehiclePassportField, ClientVehicleFieldSource>> {
  const row = object(value);
  const result: Partial<Record<ClientVehiclePassportField, ClientVehicleFieldSource>> = {};
  for (const field of CLIENT_VEHICLE_PASSPORT_FIELDS) {
    const source = object(row[field]);
    if (!source.source || !source.updatedAt) continue;
    result[field] = source as ClientVehicleFieldSource;
  }
  return result;
}

function confidenceRank(value: string): number {
  if (value === "HIGH") return 3;
  if (value === "MEDIUM") return 2;
  return 1;
}

function passportValues(row: Record<string, unknown>): ClientVehiclePassportValues {
  return Object.fromEntries(CLIENT_VEHICLE_PASSPORT_FIELDS.map((field) => [field, row[field] ?? null])) as ClientVehiclePassportValues;
}

function profileSnapshot(row: Record<string, unknown>) {
  return {
    ...passportValues(row),
    mannVariantIds: stringArray(row.mannVariantIdsJson),
    fieldSources: fieldSources(row.fieldSourcesJson),
    confidence: row.confidence,
    verificationStatus: row.verificationStatus,
    lastVerifiedAt: row.lastVerifiedAt instanceof Date ? row.lastVerifiedAt.toISOString() : row.lastVerifiedAt ?? null,
    lastVerifiedBy: row.lastVerifiedBy ?? null,
  };
}

export function serializeClientVehicleProfile(row: Record<string, unknown>): ClientVehicleProfile {
  return {
    id: String(row.id),
    branchId: String(row.branchId),
    counterpartyId: String(row.counterpartyId),
    ...passportValues(row),
    mannVariantIds: stringArray(row.mannVariantIdsJson),
    fieldSources: fieldSources(row.fieldSourcesJson),
    sourceSnapshot: Object.keys(object(row.sourceSnapshotJson)).length ? object(row.sourceSnapshotJson) : null,
    confidence: row.confidence === "HIGH" ? "HIGH" : row.confidence === "MEDIUM" ? "MEDIUM" : "LOW",
    verificationStatus: (["LEGACY", "AUTO_FILLED", "CONFIRMED", "NEEDS_REVIEW"].includes(String(row.verificationStatus))
      ? row.verificationStatus
      : "LEGACY") as ClientVehicleVerificationStatus,
    lastVerifiedAt: row.lastVerifiedAt instanceof Date ? row.lastVerifiedAt.toISOString() : null,
    lastVerifiedBy: typeof row.lastVerifiedBy === "string" ? row.lastVerifiedBy : null,
    status: typeof row.status === "string" ? row.status : "ACTIVE",
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ""),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt ?? ""),
  };
}

function writeData(values: ClientVehiclePassportValues): Prisma.ClientVehicleUncheckedUpdateInput {
  const result: Record<string, string | number | null> = {};
  for (const field of CLIENT_VEHICLE_PASSPORT_FIELDS) {
    if (field in values) result[field] = values[field] ?? null;
  }
  return result;
}

function compactSearchText(parts: unknown[]) {
  const tokens = parts
    .flatMap((part) => typeof part === "string" ? part.toLowerCase().split(/\s+/) : [])
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(tokens)].join(" ").slice(0, 20_000);
}

function displayVehicleModel(values: ClientVehiclePassportValues) {
  return [values.make, values.model, values.generation].filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join(" ");
}

export async function listClientVehicleProfiles(input: { branchId: string; counterpartyId: string }) {
  const rows = await prisma.clientVehicle.findMany({
    where: { branchId: input.branchId, counterpartyId: input.counterpartyId, status: "ACTIVE" },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((row) => serializeClientVehicleProfile(row as unknown as Record<string, unknown>));
}

export async function upsertClientVehicleProfile(input: {
  branchId: string;
  counterpartyId: string;
  vehicleId?: string | null;
  write: ClientVehicleProfileWrite;
  mode: ClientVehicleWriteMode;
  mannVariantIds?: string[];
  actor: { login: string; name: string };
}) {
  const incoming = input.write.values;
  const incomingMake = typeof incoming.make === "string" ? incoming.make.trim() : "";
  const incomingModel = typeof incoming.model === "string" ? incoming.model.trim() : "";

  const counterparty = await prisma.localCounterparty.findFirst({
    where: { branchId: input.branchId, id: input.counterpartyId, archived: false },
    select: { id: true, raw: true, searchText: true },
  });
  if (!counterparty) return { ok: false as const, error: "Клиент не найден" };

  const identifiers = [
    incoming.vin ? { vin: incoming.vin as string } : null,
    incoming.frameNumber ? { frameNumber: incoming.frameNumber as string } : null,
    incoming.plate ? { plate: incoming.plate as string } : null,
  ].filter((value): value is { vin: string } | { frameNumber: string } | { plate: string } => Boolean(value));

  const existing = input.vehicleId
    ? await prisma.clientVehicle.findFirst({ where: { branchId: input.branchId, counterpartyId: input.counterpartyId, id: input.vehicleId, status: "ACTIVE" } })
    : identifiers.length
      ? await prisma.clientVehicle.findFirst({
          where: { branchId: input.branchId, counterpartyId: input.counterpartyId, status: "ACTIVE", OR: identifiers },
          orderBy: { updatedAt: "desc" },
        })
      : await prisma.clientVehicle.findFirst({
          where: {
            branchId: input.branchId,
            counterpartyId: input.counterpartyId,
            status: "ACTIVE",
            ...(incomingMake && incomingModel ? { make: incomingMake, model: incomingModel } : { id: "__missing_vehicle_identity__" }),
            year: typeof incoming.year === "number" ? incoming.year : null,
          },
          orderBy: { updatedAt: "desc" },
        });
  const make = incomingMake || existing?.make || "";
  const model = incomingModel || existing?.model || "";
  if (!make || !model) return { ok: false as const, error: "Для паспорта укажите марку и модель автомобиля" };

  const now = new Date();
  const nowIso = now.toISOString();
  const currentRow = existing as unknown as Record<string, unknown> | null;
  const merge = mergeClientVehiclePassport({
    existing: currentRow ? passportValues(currentRow) : {},
    fieldSources: currentRow ? fieldSources(currentRow.fieldSourcesJson) : {},
    incoming: input.write,
    mode: input.mode,
    now: nowIso,
    actorLogin: input.actor.login,
  });
  const previousVariants = currentRow ? stringArray(currentRow.mannVariantIdsJson) : [];
  const nextVariants = [...new Set([...previousVariants, ...stringArray(input.mannVariantIds)])];
  const variantsChanged = JSON.stringify(previousVariants) !== JSON.stringify(nextVariants);
  const overallStatus: ClientVehicleVerificationStatus = input.mode === "confirmed"
    ? "CONFIRMED"
    : existing?.verificationStatus === "CONFIRMED"
      ? "CONFIRMED"
      : "AUTO_FILLED";
  const nextConfidence = existing && confidenceRank(existing.confidence) > confidenceRank(input.write.confidence)
    ? existing.confidence
    : input.write.confidence;
  const data: Prisma.ClientVehicleUncheckedUpdateInput = {
    ...writeData(merge.values),
    mannVariantIdsJson: nextVariants as Prisma.InputJsonValue,
    fieldSourcesJson: merge.fieldSources as Prisma.InputJsonValue,
    ...(input.write.sourceSnapshot ? { sourceSnapshotJson: input.write.sourceSnapshot as Prisma.InputJsonValue } : {}),
    confidence: nextConfidence,
    verificationStatus: overallStatus,
    ...(merge.changedFields.includes("mileage") && merge.values.mileage != null ? { mileageRecordedAt: now } : {}),
    ...(input.mode === "confirmed" ? { lastVerifiedAt: now, lastVerifiedBy: input.actor.login } : {}),
  };

  const saved = await prisma.$transaction(async (tx) => {
    const vehicle = existing
      ? await tx.clientVehicle.update({ where: { branchId_id: { branchId: input.branchId, id: existing.id } }, data })
      : await tx.clientVehicle.create({
          data: {
            ...(data as Prisma.ClientVehicleUncheckedCreateInput),
            id: crypto.randomUUID(),
            branchId: input.branchId,
            counterpartyId: input.counterpartyId,
            make,
            model,
          },
        });

    if (!existing || merge.changedFields.length || variantsChanged) {
      await tx.clientVehicleRevision.create({
        data: {
          id: crypto.randomUUID(),
          branchId: input.branchId,
          vehicleId: vehicle.id,
          source: input.write.source,
          verificationStatus: overallStatus,
          changedFieldsJson: [...merge.changedFields, ...(variantsChanged ? ["mannVariantIds"] : [])] as Prisma.InputJsonValue,
          snapshotJson: profileSnapshot(vehicle as unknown as Record<string, unknown>) as Prisma.InputJsonValue,
          actorLogin: input.actor.login,
          actorName: input.actor.name,
        },
      });
    }

    const currentRaw = object(counterparty.raw);
    const vehicleRaw = object(currentRaw.vehicle);
    const displayModel = displayVehicleModel(merge.values);
    await tx.localCounterparty.update({
      where: { branchId_id: { branchId: input.branchId, id: input.counterpartyId } },
      data: {
        raw: {
          ...currentRaw,
          vehicle: {
            ...vehicleRaw,
            profileId: vehicle.id,
            model: displayModel,
            plate: merge.values.plate ?? null,
            vin: merge.values.vin ?? null,
            year: merge.values.year == null ? null : String(merge.values.year),
          },
          lastVehiclePassportUpdate: nowIso,
        } as Prisma.InputJsonValue,
        searchText: compactSearchText([
          counterparty.searchText,
          displayModel,
          merge.values.plate,
          merge.values.vin,
          merge.values.frameNumber,
          merge.values.engineCode,
        ]),
        syncedAt: now,
      },
    });
    return vehicle;
  });

  return { ok: true as const, profile: serializeClientVehicleProfile(saved as unknown as Record<string, unknown>), changedFields: merge.changedFields };
}
