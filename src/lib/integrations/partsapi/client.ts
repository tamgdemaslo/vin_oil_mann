import { assistantRemainingMs, assistantSignal } from "@/lib/ai-assistant/execution";

type PartsApiDecode =
  | { status: "decoded"; vehicles: Record<string, unknown>[] }
  | { status: "not_found" | "unavailable" | "unconfigured" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === "number" || typeof value === "string"
    ? Number(String(value).replace(",", ".")) : NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function singleValue(from: unknown, to: unknown): number | undefined {
  const low = positiveNumber(from);
  const high = positiveNumber(to);
  return low && high && low !== high ? undefined : low ?? high;
}

function driveType(value: unknown): string | undefined {
  const drive = text(value);
  if (!drive) return undefined;
  if (/\b(?:AWD|4WD|4X4|XDRIVE|4MOTION|QUATTRO)\b|полн|все кол[её]са/i.test(drive)) return "AWD";
  if (/\b(?:FWD|4X2F)\b|передн/i.test(drive)) return "FWD";
  if (/\bRWD\b|задн/i.test(drive)) return "RWD";
  return drive;
}

function mapCard(card: Record<string, unknown>, vin: string): Record<string, unknown> | null {
  const make = text(card.manuName);
  const model = text(card.modelName);
  const returnedVin = text(card.vin ?? card.VIN);
  if (!make || !model || (returnedVin && returnedVin.toUpperCase() !== vin)) return null;

  const motorCodes = Array.isArray(card.motorCodes) ? card.motorCodes : [card.motorCodes];
  const codes = [...new Set(motorCodes.map(text).filter(Boolean))];
  const cc = positiveNumber(card.cylinderCapacityCcm) ?? positiveNumber(card.ccmTech);
  return {
    make,
    model,
    ModelYearFrom: String(card.yearOfConstrFrom ?? "").match(/^(?:19|20)\d{2}/)?.[0],
    ModelYearTo: String(card.yearOfConstrTo ?? "").match(/^(?:19|20)\d{2}/)?.[0],
    EngineCode: codes.length === 1 ? codes[0] : undefined,
    EngineVolumeCc: cc,
    EngineVolumeLiters: cc ? undefined : positiveNumber(card.cylinderCapacityLiter),
    PowerKw: singleValue(card.powerKwFrom, card.powerKwTo),
    PowerHp: singleValue(card.powerHpFrom, card.powerHpTo),
    FuelType: text(card.fuelType),
    DriveType: driveType(card.impulsionType),
  };
}

export async function decodePartsApiVin(vin: string): Promise<PartsApiDecode> {
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
    const result = isRecord(payload) ? payload.result : undefined;
    const cards = Array.isArray(result) ? result : isRecord(result) ? Object.values(result) : [];
    const vehicles = cards.filter(isRecord).map((card) => mapCard(card, vin))
      .filter((vehicle): vehicle is Record<string, unknown> => vehicle !== null);
    return vehicles.length ? { status: "decoded", vehicles } : { status: "not_found" };
  } catch {
    assistant?.throwIfAborted();
    return { status: "unavailable" };
  }
}
