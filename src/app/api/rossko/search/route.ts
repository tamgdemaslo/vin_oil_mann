import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rosskoCheckoutDetails, rosskoConfig, rosskoSearch, suggestRosskoDefaults } from "@/lib/rossko";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  const text = (request.nextUrl.searchParams.get("text") ?? "").trim();
  if (text.length < 2) {
    return NextResponse.json({ error: "text должен быть не короче 2 символов" }, { status: 400 });
  }

  try {
    const cfg = await rosskoConfig();
    let deliveryId = (cfg.deliveryId || request.nextUrl.searchParams.get("delivery_id") || "").trim();
    let addressId = (cfg.addressId || request.nextUrl.searchParams.get("address_id") || "").trim();

    if (!deliveryId || !addressId) {
      try {
        const details = await rosskoCheckoutDetails(cfg);
        const suggested = suggestRosskoDefaults(details);
        deliveryId = deliveryId || suggested.delivery_id || "";
        addressId = addressId || suggested.address_id || "";
      } catch {
        // The clearer validation errors below are more useful for the UI.
      }
    }

    if (!deliveryId) {
      return NextResponse.json({ error: "ROSSKO_DELIVERY_ID не задан" }, { status: 400 });
    }
    if (!addressId) {
      return NextResponse.json({ error: "ROSSKO_ADDRESS_ID не задан" }, { status: 400 });
    }

    const data = await rosskoSearch(cfg, { text, deliveryId, addressId });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
