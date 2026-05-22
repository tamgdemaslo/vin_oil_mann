import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";
import { syncAqsiPendingOrder, type AqsiPendingOrderItem } from "@/lib/aqsi";
import { toMoyskladMomentString } from "@/lib/time";
import {
  isRecognizedMotorOilMarkingCode,
  isLikelyMarkedMotorOilProductName,
  isMeasuredMotorOilQuantity,
  normalizeMarkingCodeInput,
  parseMarkingCodesInput,
  requiredMarkingCodeCount,
} from "@/lib/marking";

type Meta = { href: string; type: string; mediaType: string };

type DemandGet = {
  id: string;
  name: string;
  moment: string;
  description?: string;
  agent?: {
    name?: string;
    phone?: string;
    email?: string;
    phones?: Array<{ phone?: string } | string>;
    meta?: Meta;
  } & Record<string, unknown>;
} & Record<string, unknown>;

type DemandPositionRow = {
  id: string;
  quantity: number;
  price: number;
  discount?: number;
  assortment?: {
    name?: string;
    code?: string;
    article?: string;
    meta?: Meta;
  } & Record<string, unknown>;
} & Record<string, unknown>;

type PaymentBody = {
  markingCodes?: Record<string, string | string[] | undefined>;
  markingBypassPositionIds?: string[];
  markingBypassPassword?: string;
};

function pickCustomerContact(agent: DemandGet["agent"]): string | undefined {
  if (!agent) return undefined;

  const directPhone = typeof agent.phone === "string" ? agent.phone.trim() : "";
  if (directPhone) return directPhone;

  const directEmail = typeof agent.email === "string" ? agent.email.trim() : "";
  if (directEmail) return directEmail;

  if (Array.isArray(agent.phones)) {
    for (const phone of agent.phones) {
      if (typeof phone === "string" && phone.trim()) return phone.trim();
      if (phone && typeof phone === "object" && typeof phone.phone === "string" && phone.phone.trim()) {
        return phone.phone.trim();
      }
    }
  }

  return undefined;
}

async function readPaymentBody(request: Request): Promise<PaymentBody> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as PaymentBody;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function normalizeCodes(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((code) => normalizeMarkingCodeInput(String(code ?? ""))).filter(Boolean);
  }
  return typeof value === "string" ? parseMarkingCodesInput(value) : [];
}

function hasCorrectBypassPassword(password?: string): boolean {
  const expected = process.env.AQSI_MARKING_BYPASS_PASSWORD?.trim();
  if (!expected) return false;
  return password?.trim() === expected;
}

function isProductPosition(row: DemandPositionRow): boolean {
  const meta = row.assortment?.meta;
  if (meta?.type === "service") return false;
  if (meta?.type === "product" || meta?.type === "variant") return true;
  return /\/entity\/(product|variant)\//i.test(meta?.href ?? "");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id не указан" }, { status: 400 });
  }

  let body: PaymentBody;
  try {
    body = await readPaymentBody(request);
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const [demandRes, positionsRes] = await Promise.all([
    moyskladFetch<DemandGet>(`/entity/demand/${id}?expand=agent`, {
      cache: "no-store",
    }),
    moyskladFetch<{ rows: DemandPositionRow[] }>(
      `/entity/demand/${id}/positions?expand=assortment`,
      { cache: "no-store" }
    ),
  ]);

  if (!demandRes.ok) {
    return NextResponse.json({ error: demandRes.error }, { status: 502 });
  }
  if (!positionsRes.ok) {
    return NextResponse.json({ error: positionsRes.error }, { status: 502 });
  }

  const bypassIds = new Set(
    Array.isArray(body.markingBypassPositionIds)
      ? body.markingBypassPositionIds.map((id) => String(id).trim()).filter(Boolean)
      : []
  );
  if (bypassIds.size > 0 && !hasCorrectBypassPassword(body.markingBypassPassword)) {
    return NextResponse.json(
      { error: "Неверный пароль для пропуска маркировки" },
      { status: 403 }
    );
  }

  const usedCodes = new Set<string>();
  const items: AqsiPendingOrderItem[] = [];
  for (const row of positionsRes.data.rows ?? []) {
    const name =
      row.assortment?.name ??
      row.assortment?.article ??
      row.assortment?.code ??
      "Позиция без названия";
    const quantity = Number(row.quantity) || 0;
    const unitPrice = (Number(row.price) || 0) / 100;
    const discountPercent = typeof row.discount === "number" ? row.discount : 0;
    const sku = row.assortment?.article ?? row.assortment?.code ?? undefined;
    const markingRequired = isProductPosition(row) && isLikelyMarkedMotorOilProductName(name);
    const measuredPour = markingRequired && isMeasuredMotorOilQuantity(name, quantity);
    const codes = normalizeCodes(body.markingCodes?.[row.id]);
    const requiredCount = requiredMarkingCodeCount(quantity, { measuredPour });
    const bypassed = markingRequired && bypassIds.has(row.id) && codes.length < requiredCount;

    if (markingRequired && !bypassed) {
      if (codes.length < requiredCount) {
        const missingMarkingError = measuredPour
          ? `Для позиции «${name}» нужно указать код маркировки для продажи в литрах.`
          : requiredCount > 1
            ? `Для позиции «${name}» нужно указать ${requiredCount} кодов маркировки.`
            : `Для позиции «${name}» нужно указать код маркировки.`;
        return NextResponse.json(
          { error: missingMarkingError },
          { status: 400 }
        );
      }

      const invalidCode = codes.slice(0, requiredCount).find((code) => !isRecognizedMotorOilMarkingCode(code));
      if (invalidCode) {
        return NextResponse.json(
          {
            error:
              `Код маркировки для позиции «${name}» не похож на формат моторных масел. ` +
              "Проверьте, что сканируется полный DataMatrix, а сканер передаёт GS/FNC1-разделители.",
          },
          { status: 400 }
        );
      }

      for (const code of codes.slice(0, requiredCount)) {
        if (usedCodes.has(code)) {
          return NextResponse.json(
            { error: `Код маркировки повторяется: ${code}` },
            { status: 400 }
          );
        }
        usedCodes.add(code);
      }

      if (!measuredPour && requiredCount > 1 && Number.isInteger(quantity)) {
        for (const code of codes.slice(0, requiredCount)) {
          items.push({
            name,
            quantity: 1,
            unitPrice,
            discountPercent,
            sku,
            markingRequired: true,
            markingCode: code,
            measuredPour: false,
          });
        }
        continue;
      }
    }

    items.push({
      name,
      quantity,
      unitPrice,
      discountPercent,
      sku,
      markingRequired,
      markingCode: markingRequired && !bypassed ? codes[0] : undefined,
      markingBypass: bypassed,
      measuredPour,
    });
  }

  try {
    const aqsi = await syncAqsiPendingOrder({
      id: demandRes.data.id,
      number: demandRes.data.name || demandRes.data.id,
      dateTime: toMoyskladMomentString(),
      comment: demandRes.data.description ?? "",
      customer: demandRes.data.agent?.name ?? "",
      customerContact: pickCustomerContact(demandRes.data.agent),
      items,
    });

    return NextResponse.json({
      ok: true,
      orderId: aqsi.orderId,
      uid: aqsi.uid,
      status: aqsi.status,
      deviceId: aqsi.deviceId,
      shopId: aqsi.shopId,
      cashierId: aqsi.cashierId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось отправить заказ в AQSI",
      },
      { status: 502 }
    );
  }
}
