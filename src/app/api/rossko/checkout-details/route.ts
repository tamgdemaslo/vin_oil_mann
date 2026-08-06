import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { rosskoCheckoutDetails, rosskoCheckoutOptions, rosskoConfig } from "@/lib/rossko";
import { rosskoIntegrationError } from "@/lib/rossko-integration";

export const runtime = "nodejs";

export async function GET() {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  try {
    const checkout = await runWithBranchApiContext(branch.context, async () => {
      const cfg = await rosskoConfig();
      return rosskoCheckoutOptions(await rosskoCheckoutDetails(cfg));
    });
    return NextResponse.json({ ok: true, checkout });
  } catch (e) {
    const safe = rosskoIntegrationError(e);
    return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
  }
}
