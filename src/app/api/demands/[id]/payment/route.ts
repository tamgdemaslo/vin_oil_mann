import { NextResponse } from "next/server";
import { syncAqsiPendingOrder, type AqsiPendingOrderItem } from "@/lib/aqsi";
import { getSession } from "@/lib/auth";
import { loadLocalDemandDetailPayload } from "@/lib/local-demand-write";
import {
  isLikelyMarkedMotorOilProductName,
  isMeasuredMotorOilQuantity,
  isRecognizedMotorOilMarkingCode,
  normalizeMarkingCodeInput,
  parseMarkingCodesInput,
  requiredMarkingCodeCount,
} from "@/lib/marking";
import { toMoyskladMomentString } from "@/lib/time";

type Meta = { href: string; type: string; mediaType: string };

type DemandAgent = {
  name?: string;
  phone?: string;
  email?: string;
  phones?: Array<{ phone?: string } | string>;
  meta?: Meta;
} & Record<string, unknown>;

type PaymentBody = {
  markingCodes?: Record<string, string | string[] | undefined>;
  markingBypassPositionIds?: string[];
  markingBypassPassword?: string;
};

type OrderPosition = {
  id: string;
  name: string;
  quantity: number;
  priceCents: number;
  discountPercent: number;
  sku?: string | null;
  assortmentType?: string;
  assortmentHref?: string;
};

function pickCustomerContact(agent: DemandAgent | undefined): string | undefined {
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

function isProductOrderPosition(row: OrderPosition): boolean {
  const type = row.assortmentType ?? "";
  if (type === "service") return false;
  if (type === "product" || type === "variant" || type === "bundle") return true;
  return /\/entity\/(?:product|variant|bundle)\//i.test(row.assortmentHref ?? "");
}

function pickRawAgent(raw: unknown): DemandAgent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const agent = (raw as { agent?: unknown }).agent;
  return agent && typeof agent === "object" ? (agent as DemandAgent) : undefined;
}

function buildAqsiItems(rows: OrderPosition[], body: PaymentBody): AqsiPendingOrderItem[] | NextResponse {
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
  for (const row of rows) {
    const name = row.name || "Позиция без названия";
    const quantity = Number(row.quantity) || 0;
    const unitPrice = (Number(row.priceCents) || 0) / 100;
    const discountPercent = typeof row.discountPercent === "number" ? row.discountPercent : 0;
    const sku = row.sku ?? undefined;
    const markingRequired = isProductOrderPosition(row) && isLikelyMarkedMotorOilProductName(name);
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

  return items;
}

async function sendAqsiOrder(input: {
  id: string;
  number: string;
  comment?: string | null;
  customer?: string | null;
  customerContact?: string | null;
  items: AqsiPendingOrderItem[];
}) {
  const aqsi = await syncAqsiPendingOrder({
    id: input.id,
    number: input.number,
    dateTime: toMoyskladMomentString(),
    comment: input.comment ?? "",
    customer: input.customer ?? "",
    customerContact: input.customerContact ?? undefined,
    items: input.items,
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
}

async function trySendLocalDemand(id: string, body: PaymentBody): Promise<NextResponse | null> {
  const loaded = await loadLocalDemandDetailPayload(id);
  if (!loaded.ok) {
    if (loaded.notFound) return null;
    return NextResponse.json({ error: loaded.error }, { status: 400 });
  }

  const rows: OrderPosition[] = loaded.data.positions.map((position) => ({
    id: position.id,
    name: position.name,
    quantity: position.quantity,
    priceCents: position.price,
    discountPercent: typeof position.discount === "number" ? position.discount : 0,
    assortmentType: position.assortmentMeta?.type,
    assortmentHref: position.assortmentMeta?.href,
  }));
  const items = buildAqsiItems(rows, body);
  if (items instanceof NextResponse) return items;

  const agent = pickRawAgent(loaded.data.raw);
  return sendAqsiOrder({
    id: loaded.data.header.id,
    number: loaded.data.header.name || loaded.data.header.id,
    comment: loaded.data.header.description ?? "",
    customer: loaded.data.header.agentName ?? "",
    customerContact: pickCustomerContact(agent),
    items,
  });
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

  try {
    const localResponse = await trySendLocalDemand(id, body);
    if (localResponse) return localResponse;
    return NextResponse.json({ error: "Локальная отгрузка не найдена" }, { status: 404 });
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
