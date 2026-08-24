import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { rosskoConfig, rosskoSearch } from "@/lib/rossko";
import { rosskoIntegrationError } from "@/lib/rossko-integration";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  const text = (request.nextUrl.searchParams.get("text") ?? "").trim();
  if (text.length < 2) {
    return NextResponse.json({ error: "text должен быть не короче 2 символов" }, { status: 400 });
  }

  try {
    return await runWithBranchApiContext(branch.context, async () => {
    const cfg = await rosskoConfig();
    const deliveryId = cfg.deliveryId?.trim() || "";
    const addressId = cfg.addressId?.trim() || "";

    if (!deliveryId) {
      return NextResponse.json({ error: "Выберите способ доставки в настройках ROSSKO." }, { status: 400 });
    }

    const data = await rosskoSearch(cfg, { text, deliveryId, addressId });
    return NextResponse.json({ ok: true, data });
    });
  } catch (e) {
    const safe = rosskoIntegrationError(e, "search");
    return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
  }
}
