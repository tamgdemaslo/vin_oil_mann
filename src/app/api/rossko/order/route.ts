import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { RosskoCheckoutPart, RosskoError, rosskoCheckout, rosskoCheckoutDetails, rosskoCheckoutOptions, rosskoConfig, validateRosskoCheckoutSelection } from "@/lib/rossko";
import { rosskoIntegrationError } from "@/lib/rossko-integration";

export const runtime = "nodejs";

type BodyPart = Partial<RosskoCheckoutPart>;

export async function POST(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  try {
    const body = (await request.json()) as {
      comment?: string;
      parts?: BodyPart[];
    };
    return await runWithBranchApiContext(branch.context, async () => {
    const cfg = await rosskoConfig();
    const deliveryId = cfg.deliveryId?.trim() || "";
    const addressId = cfg.addressId?.trim() || "";
    const paymentId = cfg.paymentId?.trim() || "";
    const requisiteId = cfg.requisiteId?.trim() || "";
    const contactName = cfg.contactName?.trim() || "";
    const contactPhone = cfg.contactPhone?.trim() || "";

    const selectionErrors = validateRosskoCheckoutSelection(
      rosskoCheckoutOptions(await rosskoCheckoutDetails(cfg)),
      cfg
    );
    if (selectionErrors.length) throw new RosskoError(selectionErrors.join(" "));

    const missing: string[] = [];
    if (!deliveryId) missing.push("ROSSKO_DELIVERY_ID");
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
      comment: [cfg.contactComment, body.comment].map((value) => value?.trim()).filter(Boolean).join(" · ").slice(0, 200) || undefined,
      deliveryParts: cfg.deliveryParts,
      parts,
    });
    return NextResponse.json({ ok: true, data });
    });
  } catch (e) {
    const safe = rosskoIntegrationError(e);
    return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
  }
}
