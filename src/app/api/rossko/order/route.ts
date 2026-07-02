import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { RosskoCheckoutPart, rosskoCheckout, rosskoCheckoutDetails, rosskoConfig, suggestRosskoDefaults } from "@/lib/rossko";

export const runtime = "nodejs";

type BodyPart = Partial<RosskoCheckoutPart>;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      delivery_id?: string;
      address_id?: string;
      payment_id?: string;
      requisite_id?: string;
      contact_name?: string;
      contact_phone?: string;
      comment?: string;
      delivery_parts?: boolean;
      parts?: BodyPart[];
    };
    const cfg = rosskoConfig();
    let deliveryId = (cfg.deliveryId || body.delivery_id || "").trim();
    let addressId = (cfg.addressId || body.address_id || "").trim();
    let paymentId = (cfg.paymentId || body.payment_id || "").trim();
    let requisiteId = (cfg.requisiteId || body.requisite_id || "").trim();
    const contactName = (cfg.contactName || body.contact_name || "").trim();
    const contactPhone = (cfg.contactPhone || body.contact_phone || "").trim();
    const deliveryParts = body.delivery_parts !== undefined ? !!body.delivery_parts : cfg.deliveryParts;

    if (!deliveryId || !addressId || !paymentId || !requisiteId) {
      try {
        const details = await rosskoCheckoutDetails(cfg);
        const suggested = suggestRosskoDefaults(details);
        deliveryId = deliveryId || suggested.delivery_id || "";
        addressId = addressId || suggested.address_id || "";
        paymentId = paymentId || suggested.payment_id || "";
        requisiteId = requisiteId || suggested.requisite_id || "";
      } catch {
        // Validation below will report the missing checkout settings.
      }
    }

    const missing: string[] = [];
    if (!deliveryId) missing.push("ROSSKO_DELIVERY_ID");
    if (!addressId) missing.push("ROSSKO_ADDRESS_ID");
    if (!paymentId) missing.push("ROSSKO_PAYMENT_ID");
    if (!contactName) missing.push("ROSSKO_CONTACT_NAME");
    if (!contactPhone) missing.push("ROSSKO_CONTACT_PHONE");
    if (missing.length) {
      return NextResponse.json({ error: `Не заданы параметры: ${missing.join(", ")}` }, { status: 400 });
    }

    const parts = (Array.isArray(body.parts) ? body.parts : [])
      .map((p): RosskoCheckoutPart | null => {
        const partnumber = String(p.partnumber || "").trim();
        const brand = String(p.brand || "").trim();
        const stock = String(p.stock || "").trim();
        const count = Math.max(0, Math.floor(Number(p.count || 0)));
        if (!partnumber || !brand || !stock || count <= 0) return null;
        const comment = String(p.comment || "").trim();
        return {
          partnumber,
          brand,
          stock,
          count,
          ...(comment ? { comment: comment.slice(0, 50) } : {}),
        };
      })
      .filter((p): p is RosskoCheckoutPart => !!p);

    if (!parts.length) {
      return NextResponse.json({ error: "Нет валидных позиций для заказа" }, { status: 400 });
    }

    const data = await rosskoCheckout(cfg, {
      deliveryId,
      addressId,
      paymentId,
      requisiteId: requisiteId || undefined,
      contactName,
      contactPhone,
      comment: (body.comment || "").trim() || undefined,
      deliveryParts,
      parts,
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
