import { z } from "zod";

const TRONK_BASE_URL = (process.env.TRONK_BASE_URL ?? "https://data.tronk.info").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = Math.max(2_000, Math.min(25_000, Number(process.env.TRONK_TIMEOUT_MS ?? 12_000) || 12_000));
const CIRCUIT_COOLDOWN_MS = 30_000;

export type TronkMethod = "vindecode" | "vindecode2" | "number2vin" | "convertb2b" | "convertgate" | "frameapi";

export type TronkCallSuccess = {
  ok: true;
  method: TronkMethod;
  data: Record<string, unknown>;
  durationMs: number;
  providerRequestId: string | null;
};

export type TronkCallFailure = {
  ok: false;
  method: TronkMethod;
  code: "not_configured" | "circuit_open" | "network" | "provider" | "invalid_response" | "limit";
  message: string;
  durationMs: number;
};

export type TronkCallResult = TronkCallSuccess | TronkCallFailure;

const unknownRecordSchema = z.object({}).passthrough();
const primarySchema = unknownRecordSchema.extend({
  decode: unknownRecordSchema.optional(),
  Decode: unknownRecordSchema.optional(),
}).passthrough();
const extendedSchema = unknownRecordSchema.extend({ result: unknownRecordSchema.optional() }).passthrough();
const frameSchema = unknownRecordSchema.extend({ result: unknownRecordSchema.optional() }).passthrough();

const circuit = ((globalThis as typeof globalThis & {
  __ecoTronkCircuit?: { consecutiveFailures: number; openedUntil: number };
}).__ecoTronkCircuit ??= { consecutiveFailures: 0, openedUntil: 0 });

function apiKey(): string {
  return process.env.TRONK_API_KEY?.trim() ?? "";
}

function endpointFor(method: TronkMethod): string {
  return `${TRONK_BASE_URL}/${method}.ashx`;
}

function isTemporaryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerError(data: Record<string, unknown>): string | null {
  if (data.error === true) return String(data.error_msg ?? data.message ?? "TRONK вернул ошибку");
  return null;
}

async function request(method: TronkMethod, params: Record<string, string>): Promise<TronkCallResult> {
  const key = apiKey();
  if (!key || process.env.TRONK_ENABLED === "false") {
    return { ok: false, method, code: "not_configured", message: "Интеграция TRONK не настроена", durationMs: 0 };
  }
  if (circuit.openedUntil > Date.now()) {
    return { ok: false, method, code: "circuit_open", message: "TRONK временно недоступен. Повторите попытку позже.", durationMs: 0 };
  }

  const startedAt = Date.now();
  const url = new URL(endpointFor(method));
  url.searchParams.set("key", key);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

  let lastFailure: TronkCallFailure | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        const message = isRecord(parsed) ? String(parsed.error_msg ?? parsed.message ?? `TRONK вернул HTTP ${response.status}`) : `TRONK вернул HTTP ${response.status}`;
        lastFailure = { ok: false, method, code: "provider", message, durationMs: Date.now() - startedAt };
        if (attempt === 0 && isTemporaryStatus(response.status)) continue;
        break;
      }
      if (!isRecord(parsed)) {
        lastFailure = { ok: false, method, code: "invalid_response", message: "TRONK вернул некорректный ответ", durationMs: Date.now() - startedAt };
        break;
      }
      const error = providerError(parsed);
      if (error) {
        circuit.consecutiveFailures = 0;
        return { ok: false, method, code: "provider", message: error, durationMs: Date.now() - startedAt };
      }
      // Parsing is deliberately permissive: provider fields evolve over time.
      if (method === "vindecode") primarySchema.safeParse(parsed);
      if (method === "vindecode2") extendedSchema.safeParse(parsed);
      if (method === "frameapi") frameSchema.safeParse(parsed);
      circuit.consecutiveFailures = 0;
      return {
        ok: true,
        method,
        data: parsed,
        durationMs: Date.now() - startedAt,
        providerRequestId: typeof parsed.request_id === "string" ? parsed.request_id : typeof parsed.id === "string" ? parsed.id : null,
      };
    } catch (error) {
      lastFailure = {
        ok: false,
        method,
        code: "network",
        message: error instanceof Error && error.name === "AbortError" ? "Истекло время ожидания ответа TRONK" : "Не удалось связаться с TRONK",
        durationMs: Date.now() - startedAt,
      };
      if (attempt === 0) continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  circuit.consecutiveFailures += 1;
  if (circuit.consecutiveFailures >= 3) circuit.openedUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  return lastFailure ?? { ok: false, method, code: "network", message: "TRONK временно недоступен", durationMs: Date.now() - startedAt };
}

export const tronkClient = {
  decodeVinPrimary(vin: string) {
    return request("vindecode", { vin });
  },
  decodeVinExtended(vin: string) {
    return request("vindecode2", { vin });
  },
  lookupVinByPlate(plate: string) {
    return request("number2vin", { gosnumber: plate });
  },
  lookupVehicleByPlate(plate: string) {
    return request("convertb2b", { gosnumber: plate });
  },
  lookupVehicleByPlateGate(plate: string) {
    return request("convertgate", { gosnumber: plate });
  },
  lookupVehicleByFrame(frame: string) {
    return request("frameapi", { frame });
  },
};
