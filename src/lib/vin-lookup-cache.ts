import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import type { OilInfo, VinDecoded } from "@/types/lookup";

export type VinLookupCachePayload = {
  decoded: VinDecoded | null;
  oilInfo: OilInfo | null;
  openaiError?: string;
};

const CACHE_TTL_DAYS = Math.min(365, Math.max(1, parseInt(process.env.VIN_LOOKUP_CACHE_DAYS ?? "30", 10) || 30));
let tableReady: Promise<void> | null = null;

async function ensureVinLookupCacheTable() {
  // Runtime DDL is forbidden. The reviewed migration creates this table.
  tableReady ??= Promise.resolve();
  return tableReady;
}

function getExpiryDate() {
  return new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function hasUsefulDecoded(decoded: VinDecoded | null | undefined): boolean {
  return Boolean(
    decoded &&
      [
        decoded.make,
        decoded.model,
        decoded.modelYear,
        decoded.modification,
        decoded.engineSeries,
        decoded.generation,
        decoded.displacementL,
        decoded.fuelTypePrimary,
      ].some((value) => typeof value === "string" && value.trim())
  );
}

function hasUsefulOilInfo(oilInfo: OilInfo | null | undefined): boolean {
  return Boolean(
    oilInfo &&
      [
        oilInfo.approval,
        oilInfo.fillVolumeLiters,
        oilInfo.oilFilterOem,
        oilInfo.fuelFilterOem,
        oilInfo.airFilterOem,
        oilInfo.cabinFilterOem,
      ].some((value) => typeof value === "string" && value.trim()) ||
      Boolean(
        oilInfo &&
          ((oilInfo.sae?.length ?? 0) > 0 ||
            (oilInfo.acea?.length ?? 0) > 0 ||
            (oilInfo.api?.length ?? 0) > 0 ||
            (oilInfo.ilsac?.length ?? 0) > 0 ||
            oilInfo.transmission)
      )
  );
}

function hasUsefulPayload(payload: VinLookupCachePayload | null | undefined): boolean {
  return Boolean(payload && (hasUsefulDecoded(payload.decoded) || hasUsefulOilInfo(payload.oilInfo)));
}

export async function getVinLookupCache(vin: string): Promise<VinLookupCachePayload | null> {
  try {
    const branchId = getScopedBranchId();
    await ensureVinLookupCacheTable();
    const rows = await prisma.$queryRaw<Array<{ payload: VinLookupCachePayload }>>`
      SELECT payload
      FROM vin_lookup_cache
      WHERE branch_id = ${branchId}
        AND vin = ${vin}
        AND expires_at > NOW()
      LIMIT 1
    `;
    const payload = rows[0]?.payload ?? null;
    return hasUsefulPayload(payload) ? payload : null;
  } catch (error) {
    console.warn("[lookup-cache] read failed", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function setVinLookupCache(vin: string, payload: VinLookupCachePayload): Promise<void> {
  try {
    if (!hasUsefulPayload(payload)) return;
    const branchId = getScopedBranchId();
    await ensureVinLookupCacheTable();
    await prisma.$executeRaw`
      INSERT INTO vin_lookup_cache (branch_id, vin, payload, expires_at)
      VALUES (${branchId}, ${vin}, ${JSON.stringify(payload)}::jsonb, ${getExpiryDate()})
      ON CONFLICT (branch_id, vin) DO UPDATE SET
        payload = EXCLUDED.payload,
        updated_at = NOW(),
        expires_at = EXCLUDED.expires_at
    `;
  } catch (error) {
    console.warn("[lookup-cache] write failed", error instanceof Error ? error.message : String(error));
  }
}
