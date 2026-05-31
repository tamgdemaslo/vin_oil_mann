import { NextRequest, NextResponse } from "next/server";
import type { OilRequirements } from "@/types/oil";
import { fetchOilCandidatesByRequirements, scoreAndMatch } from "@/lib/oil-recommendations";

/**
 * GET /api/oil-search?approval=BMW+Longlife-04&sae=5W-30
 * Поиск масел в локальном каталоге только по допускам (без VIN, без OpenAI).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const approval = searchParams.get("approval")?.trim();
    const saeParam = searchParams.get("sae")?.trim();
    const aceaParam = searchParams.get("acea")?.trim();
    const apiParam = searchParams.get("api")?.trim();

    const oem = approval ? approval.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [];
    const sae = saeParam ? saeParam.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [];
    const acea = aceaParam ? aceaParam.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [];
    const api = apiParam ? apiParam.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [];

    if (oem.length === 0 && sae.length === 0 && acea.length === 0 && api.length === 0) {
      return NextResponse.json(
        { error: "Укажите хотя бы один параметр: approval, sae, acea или api" },
        { status: 400 }
      );
    }

    const requirements: OilRequirements = {
      sae_viscosities: sae,
      oem_approvals: oem,
      acea,
      api,
      confidence: 0.5,
    };

    const oils = await fetchOilCandidatesByRequirements(requirements);
    const { recommended, alternatives } = scoreAndMatch(requirements, oils, 20);
    const list = recommended.concat(alternatives).map((r) => ({
      name: r.product.name,
      article: r.product.article,
      price: r.product.price,
      currency: r.product.currency,
      score: r.score,
      why: r.why,
    }));

    return NextResponse.json({
      query: { approval: approval ?? null, sae: saeParam ?? null, acea: aceaParam ?? null, api: apiParam ?? null },
      count: list.length,
      oils: list,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[oil-search]", e);
    return NextResponse.json(
      { error: msg, ...(process.env.NODE_ENV === "development" && stack ? { stack } : {}) },
      { status: 500 }
    );
  }
}
