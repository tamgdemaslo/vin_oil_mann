import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAIAssistantAccess, runWithAIAssistantBranchContext } from "@/lib/ai-assistant/access";
import { prepareQuickShipment, QuickShipmentError } from "@/lib/ai-assistant/quick-shipment";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { prisma } from "@/lib/db";
import { createLocalDemand } from "@/lib/local-demand-write";

export async function POST(request: NextRequest) {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  if (request.headers.get("x-eco-assistant-branch") !== access.branchId) {
    return NextResponse.json({ error: "Филиал изменился. Подготовьте новый черновик." }, { status: 409 });
  }
  const input = await request.json().catch(() => null);
  const sourceId = input?.sourceId;
  const fingerprint = input?.fingerprint;
  const nonce = input?.nonce;
  if (input?.confirm !== true ||
      typeof sourceId !== "string" || !sourceId || sourceId.length > 180 ||
      typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint) ||
      typeof nonce !== "string" || !/^[a-f0-9-]{36}$/.test(nonce)) {
    return NextResponse.json({ error: "Подтвердите подготовленный черновик отгрузки." }, { status: 400 });
  }
  return runWithAIAssistantBranchContext(access, async () => {
    try {
      const cashAccess = await requireApiSessionWithCashShift();
      if (!cashAccess.ok) return cashAccess.response;
      const demandId = "quick-" + createHash("sha256").update(JSON.stringify([
        access.branchId, access.actorId, sourceId, nonce,
      ])).digest("hex").slice(0, 40);
      const findSaved = () => prisma.localDemand.findFirst({
        where: { branchId: access.branchId, id: demandId },
        select: { id: true, name: true },
      });
      const saved = await findSaved();
      if (saved) return NextResponse.json(saved);
      const { preview, body } = await prepareQuickShipment(access, sourceId, nonce);
      if (preview.fingerprint !== fingerprint) {
        return NextResponse.json({ error: "Заказ или остатки изменились. Проверьте обновлённый черновик.", shipment: preview }, { status: 409 });
      }
      const result = await createLocalDemand(body, {
        actor: access.session.user,
        ecoUserName: access.session.user.name || access.actorId,
        branchId: access.branchId,
        organizationId: access.organizationId,
        demandId,
      });
      if (!result.ok) {
        const concurrent = await findSaved();
        if (concurrent) return NextResponse.json(concurrent);
        return NextResponse.json({ error: "Не удалось сохранить черновик отгрузки. Проверьте заказ и настройки филиала." }, { status: 422 });
      }
      return NextResponse.json({ id: result.id, name: result.name }, { status: 201 });
    } catch (error) {
      if (error instanceof QuickShipmentError) return NextResponse.json({ error: error.message }, { status: error.status });
      return NextResponse.json({ error: "Результат сохранения неизвестен. Повторное подтверждение этого черновика не создаст дубль." }, { status: 502 });
    }
  });
}
