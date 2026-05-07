import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rosskoCheckoutDetails, rosskoConfig, suggestRosskoDefaults } from "@/lib/rossko";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  try {
    const cfg = rosskoConfig();
    const data = await rosskoCheckoutDetails(cfg);
    return NextResponse.json({ ok: true, data, suggested: suggestRosskoDefaults(data) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
