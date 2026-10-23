import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { rosskoConfig, rosskoSearch } from "@/lib/rossko";
import { rosskoIntegrationError } from "@/lib/rossko-integration";
import { getAgentSettings } from "@/lib/ai-agent/settings";
import { quoteRosskoFilters } from "@/lib/maintenance-quote-rossko";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({error: "Необходима авторизация"}, {status: 401});
  const branch = await requireBranchApi({allowAll: false, requireActive: true});
  if (!branch.ok) return branch.response;
  const article = request.nextUrl.searchParams.get("article")?.trim() ?? "";
  if (article.length < 2 || article.length > 80) return NextResponse.json({error: "Укажите артикул MANN"}, {status: 400});
  try {
    return await runWithBranchApiContext(branch.context, async () => {
      const [cfg, settings] = await Promise.all([rosskoConfig(), getAgentSettings(branch.context.organizationId!)]);
      if (!cfg.deliveryId?.trim()) return NextResponse.json({error: "Выберите способ доставки в настройках Роско."}, {status: 409});
      const data = await rosskoSearch(cfg, {text: `MANN ${article}`, deliveryId: cfg.deliveryId, addressId: cfg.addressId});
      return NextResponse.json({products: quoteRosskoFilters(data, article, branch.context.branchId!, settings.rosskoMarkupRules, branch.context.branch?.timezone ?? "Europe/Kaliningrad")}, {headers: {"Cache-Control": "no-store"}});
    });
  } catch (error) {
    const safe = rosskoIntegrationError(error, "search");
    return NextResponse.json(safe, {status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502});
  }
}
