import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getCachedRequirements,
  setCachedRequirements,
  getOilRequirementsFromOpenAI,
  fetchOilProductsFromMoySklad,
  scoreAndMatch,
} from "@/lib/oil-recommendations";
import { partsCatalogsRequest } from "@/lib/parts-catalogs";
import type { OilRecommendationResult, OilRequirements, VinDecodeResponse } from "@/types/oil";
import { createOpenAIClient } from "@/lib/openai-client";

async function decodeVin(vin: string): Promise<VinDecodeResponse | null> {
  const cleanVin = vin.replace(/\s/g, "").toUpperCase().replace(/-/g, "");
  if (cleanVin.length < 8) return null;
  try {
    const { status, data } = await partsCatalogsRequest("/car/info", { q: cleanVin });
    if (status !== 200 || !data) return null;
    const items = Array.isArray(data) ? data : data ? [data] : [];
    const first = items[0] as Record<string, unknown> | undefined;
    if (!first) return null;
    const make = String(first.make ?? first.manufacturer ?? "").trim() || undefined;
    const model = String(first.model ?? "").trim() || undefined;
    const year = String(first.modelYear ?? first.year ?? "").trim() || undefined;
    const title = typeof first.title === "string" ? first.title : "";
    return {
      make: make || (title ? title.split(/\s+/)[0] : undefined),
      model: model || (title ? title.split(/\s+/).slice(1).join(" ") : undefined),
      year,
      raw: first as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/** POST /api/oil-recommendations — подбор масел по VIN (требования через OpenAI, товары из локального каталога, скоринг). */
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
          source_hint: "Нет данных декодера или OpenAI",
        };
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
