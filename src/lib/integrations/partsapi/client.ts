import { normalizePartsApiMannCard } from "@/lib/partsapi-mann-normalization";
import { assistantRemainingMs, assistantSignal } from "@/lib/ai-assistant/execution";
import { prisma } from "@/lib/db";
import { getRequestTenant } from "@/lib/request-tenant-store";

type PartsApiDecode =
  | { status: "decoded"; vehicles: Record<string, unknown>[]; fromCache?: boolean }
  | { status: "not_found" | "unavailable" | "unconfigured"; rejectedVins?: string[]; fromCache?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodePayload(payload: unknown, vin: string, fromCache = false): PartsApiDecode {
  const result = isRecord(payload) ? payload.result : undefined;
  const cards = Array.isArray(result) ? result : isRecord(result) ? Object.values(result) : [];
  const normalized = cards.filter(isRecord).map(card => normalizePartsApiMannCard(card, vin));
  // Catalogue-card VIN differences do not reject the requested modification.
  const vehicles = normalized.filter(card => card.valid).map(card => card.vehicle);
  const rejectedVins = normalized.filter(card => !card.vinMatches).flatMap(card => card.returnedVin ? [card.returnedVin] : []);
  return vehicles.length ? { status: "decoded", vehicles, fromCache } : { status: "not_found", rejectedVins, fromCache };
}

export async function decodePartsApiVin(vin: string): Promise<PartsApiDecode> {
  const tenant = getRequestTenant();
  if (tenant?.mode === "branch" && tenant.branchId) {
    try {
      const cached = await prisma.vinLookupCache.findFirst({
        where: { branchId: tenant.branchId, vin, expiresAt: { gt: new Date() } },
        select: { payload: true },
      });
      if (cached && isRecord(cached.payload)) {
        const record = isRecord(cached.payload.partsApiBatch) ? cached.payload.partsApiBatch : cached.payload;
        if (record.source === "PARTSAPI_600_RAW_V1") {
          if (record.status === "decoded" || record.status === "not_found") return decodePayload(record.response, vin, true);
          // A reserved or uncertain request must not be purchased again.
          return { status: "unavailable", fromCache: true };
        }
      }
    } catch {
      return { status: "unavailable", fromCache: true };
    }
  }
  const key = process.env.PARTSAPI_VINDECODE_KEY?.trim();
  if (!key) return { status: "unconfigured" };

  const assistant = assistantSignal();
  assistant?.throwIfAborted();
  try {
    const url = new URL("https://api.partsapi.ru/");
    url.search = new URLSearchParams({ key, method: "VINdecode", lang: "ru", vin }).toString();
    const timeout = AbortSignal.timeout(Math.min(15_000, assistantRemainingMs()));
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: assistant ? AbortSignal.any([assistant, timeout]) : timeout,
    });
    if (!response.ok) return { status: "unavailable" };

    const payload: unknown = await response.json();
    return decodePayload(payload, vin);
  } catch {
    assistant?.throwIfAborted();
    return { status: "unavailable" };
  }
}
