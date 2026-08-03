import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getCachedRequirements,
  setCachedRequirements,
  fetchOilProductsFromMoySklad,
  getOilRequirementsFromOpenAI,
  scoreAndMatch,
} from "@/lib/oil-recommendations";
import { getOilRequirementsFromFluidCatalog } from "@/lib/fluid-oil-requirements";
import { partsCatalogsRequest } from "@/lib/parts-catalogs";
import type { OilRecommendationResult, OilRequirements, VinDecodeResponse } from "@/types/oil";
import { createOpenAIClient } from "@/lib/openai-client";

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function parameterValue(row: Record<string, unknown>, name: RegExp): string | undefined {
  const parameters = Array.isArray(row.parameters) ? row.parameters : [];
  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== "object") continue;
    const item = parameter as Record<string, unknown>;
    const label = `${textValue(item.key) ?? ""} ${textValue(item.name) ?? ""}`;
    if (name.test(label)) return textValue(item.value);
  }
  return undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function decodeVin(vin: string): Promise<VinDecodeResponse | null> {
  const cleanVin = vin.replace(/\s/g, "").toUpperCase().replace(/-/g, "");
  if (cleanVin.length < 8) return null;
  try {
    const { status, data } = await partsCatalogsRequest("/car/info", { q: cleanVin });
    if (status !== 200 || !data) return null;
    const items = Array.isArray(data) ? data : data ? [data] : [];
    const first = items[0] as Record<string, unknown> | undefined;
    if (!first) return null;
    const make = textValue(first.make ?? first.brand ?? first.manufacturer);
    const model = textValue(first.model ?? first.modelName);
    const year = String(first.modelYear ?? first.year ?? "").trim() || undefined;
    const title = typeof first.title === "string" ? first.title : "";
    const engine = textValue(first.engine ?? first.engineName ?? first.modification) ?? parameterValue(first, /двигател|engine|мотор/i);
    const engineCode = textValue(first.engineCode ?? first.engine_code) ?? parameterValue(first, /код.*двигател|engine.*code/i);
    const engineVolumeCc = positiveNumber(first.engineVolumeCc ?? first.engine_volume_cc ?? parameterValue(first, /объ[её]м.*двигател|engine.*(?:volume|capacity)/i));
    const powerHp = positiveNumber(first.powerHp ?? first.power_hp ?? parameterValue(first, /мощност|power|л\.?с/i));
    return {
      make: make || (title ? title.split(/\s+/)[0] : undefined),
      model: model || (title ? title.split(/\s+/).slice(1).join(" ") : undefined),
      year,
      engine,
      engineCode,
      engineVolumeCc,
      powerHp,
      raw: first as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/** POST /api/oil-recommendations — подбор масла по VIN: сначала локальный каталог, затем резервный ИИ. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const vin = typeof body.vin === "string" ? body.vin.trim() : "";
    if (!vin) {
      return NextResponse.json({ error: "Укажите vin" }, { status: 400 });
    }

    const cleanVin = vin.replace(/\s/g, "").toUpperCase().replace(/-/g, "");
    if (cleanVin.length < 8) {
      return NextResponse.json({ error: "VIN должен быть не короче 8 символов" }, { status: 400 });
    }

    const decoded = await decodeVin(cleanVin);
    const market = decoded?.market ?? decoded?.region;

    let requirements: OilRequirements | null = getCachedRequirements(cleanVin, market);
    if (!requirements) {
      requirements = decoded ? await getOilRequirementsFromFluidCatalog(decoded) : null;
      if (requirements) {
        setCachedRequirements(cleanVin, market, requirements);
      } else {
        const openaiKey = process.env.OPENAI_API_KEY?.trim();
        if (openaiKey && decoded && (decoded.make || decoded.model || decoded.year)) {
          const openai = createOpenAIClient(openaiKey);
          requirements = await getOilRequirementsFromOpenAI(openai, decoded);
          setCachedRequirements(cleanVin, market, requirements);
        } else {
          requirements = {
            sae_viscosities: [],
            oem_approvals: [],
            acea: [],
            api: [],
            confidence: 0,
            source_hint: "Нет данных локального каталога, декодера или OpenAI",
          };
        }
      }
    }

    const oils = await fetchOilProductsFromMoySklad(200);
    const { recommended, alternatives } = scoreAndMatch(requirements, oils, 10);

    const warning =
      requirements.sae_viscosities?.length === 0
        ? "Не определена вязкость SAE — уточните требования к маслу"
        : undefined;

    const result: OilRecommendationResult = {
      vin: cleanVin,
      decoded: decoded ?? undefined,
      requirements,
      recommended,
      alternatives,
      warning,
    };

    return NextResponse.json(result);
  } catch (e) {
    console.error("[oil-recommendations]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка подбора масел" },
      { status: 500 }
    );
  }
}
