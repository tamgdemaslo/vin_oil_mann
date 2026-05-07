import { randomUUID } from "crypto";

export type OrdersTotals = {
  cashTotal: number;
  cardTotal: number;
  error?: string;
};

export type AqsiPendingOrderItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  sku?: string | null;
};

export type SyncAqsiPendingOrderInput = {
  id: string;
  number: string;
  dateTime?: string | null;
  comment?: string | null;
  customer?: string | null;
  customerContact?: string | null;
  items: AqsiPendingOrderItem[];
};

export type SyncAqsiPendingOrderResult = {
  orderId: string;
  uid?: string;
  status?: string;
  deviceId?: string;
  shopId?: string;
  cashierId?: string;
  raw: unknown;
};

type AqsiConfig = {
  apiKey: string;
  baseUrl: string;
  ordersPath: string;
  pendingOrderPath: string;
  devicesPath: string;
  deviceId?: string;
  shopId?: string;
  cashierId?: string;
};

type AqsiDevice = {
  id?: string | number;
  shopId?: string | number | null;
};

type AqsiRecord = Record<string, unknown>;

type AqsiPayment = AqsiRecord & {
  amount?: number | string;
  sum?: number | string;
  total?: number | string;
  value?: number | string;
  cashSum?: number | string;
  cardSum?: number | string;
  type?: number | string;
  paymentType?: string;
  paymentMethod?: string;
  payType?: string;
  kind?: string;
  typeName?: string;
  methodName?: string;
  isCash?: boolean;
};

function getAqsiConfig(): AqsiConfig {
  const apiKey = process.env.AQSI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Не настроен AQSI_API_KEY в .env.local");
  }
  return {
    apiKey,
    // Swagger aQsi: базовый URL боевого сервера https://api.aqsi.ru/pub
    baseUrl: process.env.AQSI_BASE_URL?.trim() || "https://api.aqsi.ru/pub",
    ordersPath: process.env.AQSI_ORDERS_PATH?.trim() || "/v2/Receipts",
    pendingOrderPath: process.env.AQSI_PENDING_ORDER_PATH?.trim() || "/v2/Orders/simple",
    devicesPath: process.env.AQSI_DEVICES_PATH?.trim() || "/v1/Devices",
    deviceId: process.env.AQSI_DEVICE_ID?.trim() || undefined,
    shopId: process.env.AQSI_SHOP_ID?.trim() || undefined,
    cashierId: process.env.AQSI_CASHIER_ID?.trim() || undefined,
  };
}

function getAqsiHeaders(apiKey: string): Record<string, string> {
  const clientKey = apiKey.startsWith("Application ") ? apiKey : `Application ${apiKey}`;
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-client-key": clientKey,
  };
}

function buildAqsiUrl(baseUrl: string, path: string): string {
  return path.startsWith("http")
    ? path
    : `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function extractAqsiError(rawText: string, statusText: string): string {
  let detail = rawText.slice(0, 300) || statusText;
  try {
    const errJson = JSON.parse(rawText) as Record<string, unknown>;
    const errMsg =
      errJson?.message ??
      errJson?.error ??
      errJson?.detail ??
      (Array.isArray(errJson?.errors) ? (errJson.errors[0] as string) : undefined);
    if (errMsg && typeof errMsg === "string") detail = errMsg;
  } catch {
    // Оставляем detail как rawText.
  }
  return detail;
}

async function aqsiFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiKey, baseUrl } = getAqsiConfig();
  const res = await fetch(buildAqsiUrl(baseUrl, path), {
    ...init,
    headers: { ...getAqsiHeaders(apiKey), ...init?.headers },
    cache: "no-store",
  });

  const rawText = await res.text();
  if (!res.ok) {
    const detail = extractAqsiError(rawText, res.statusText);
    const hint =
      res.status === 401
        ? " Проверьте AQSI_API_KEY в .env.local."
        : res.status === 404
          ? " Проверьте AQSI_BASE_URL и путь к эндпоинту AQSI."
          : "";
    // Логируем, чтобы в терминале видеть причину отказа AQSI (обычно 4xx/412).
    // Это помогает быстрее локализовать некорректные параметры запроса.
    console.error(`[aqsiFetchJson] ${path} -> ${res.status}. ${detail}${hint}`);
    throw new Error(`AQSI ответил ${res.status}. ${detail}${hint}`);
  }

  if (!rawText.trim()) return {} as T;

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error("AQSI вернул не JSON: " + rawText.slice(0, 100));
  }
}

function extractItems(data: unknown): AqsiRecord[] {
  if (Array.isArray(data)) {
    return data.filter((item): item is AqsiRecord => Boolean(item) && typeof item === "object");
  }
  if (!data || typeof data !== "object") return [];
  const d = data as AqsiRecord;
  for (const key of ["items", "data", "rows", "list", "receipts", "cheques", "result"]) {
    const v = d[key];
    if (Array.isArray(v)) return v.filter((item): item is AqsiRecord => Boolean(item) && typeof item === "object");
  }
  return [];
}

function sumFromPayments(payments: AqsiPayment[]): { cash: number; card: number } {
  let cash = 0;
  let card = 0;
  for (const p of payments) {
    const amount = Number(
      p.amount ?? p.sum ?? p.total ?? p.value ?? p.cashSum ?? p.cardSum ?? 0
    );
    if (!Number.isFinite(amount) || amount <= 0) continue;
    // AQSI V2: type 0 = наличные, 1 = безналичные (карта)
    const typeNum = p.type != null ? Number(p.type) : NaN;
    const typeRaw = String(
      p.paymentType ?? p.paymentMethod ?? p.type ?? p.payType ?? p.kind ?? ""
    ).toLowerCase();
    const typeRu = String(p.typeName ?? p.methodName ?? "").toLowerCase();
    if (
      typeNum === 0 ||
      typeRaw.includes("cash") ||
      typeRu.includes("нал") ||
      typeRaw === "0" ||
      p.isCash === true
    ) {
      cash += amount;
    } else if (
      typeNum === 1 ||
      typeRaw.includes("card") ||
      typeRaw.includes("bank") ||
      typeRaw.includes("electron") ||
      typeRu.includes("карт") ||
      typeRaw === "1" ||
      p.isCash === false
    ) {
      card += amount;
    }
  }
  return { cash, card };
}

export async function getOrdersTotalsForDate(params: {
  serviceDate: string;
  timezone: string;
}): Promise<OrdersTotals> {
  const { serviceDate } = params;
  const { apiKey, baseUrl, ordersPath } = getAqsiConfig();

  // Собираем URL вручную, чтобы не терять суффикс `/pub` у baseUrl
  const urlStr = buildAqsiUrl(baseUrl, ordersPath);
  const url = new URL(urlStr);
  // AQSI V2: filtered.beginDate, filtered.endDate (ГГГГ-ММ-ДДТЧЧ:ММ:СС)
  url.searchParams.set("filtered.beginDate", `${serviceDate}T00:00:00`);
  url.searchParams.set("filtered.endDate", `${serviceDate}T23:59:59`);
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("page", "0");

  const headers = getAqsiHeaders(apiKey);

  const allItems: AqsiRecord[] = [];
  let page = 0;
  let pagesTotal = 1;

  do {
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), {
      method: "GET",
      headers,
      cache: "no-store",
    });

    const rawText = await res.text();
    if (!res.ok) {
      const detail = extractAqsiError(rawText, res.statusText);
      const hint =
        res.status === 401
          ? " Проверьте AQSI_API_KEY в .env.local (Настройки → Интеграции → Интеграция по внешнему API)."
          : res.status === 404
            ? " Проверьте AQSI_BASE_URL и AQSI_ORDERS_PATH в .env.local."
            : res.status === 400
              ? " Часто это «история чеков за последние 6 месяцев» — укажите дату смены не старше 6 месяцев."
              : "";
      throw new Error(`AQSI ответил ${res.status}. ${detail}${hint}`);
    }

    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error("AQSI вернул не JSON: " + rawText.slice(0, 100));
    }

    const d = data as AqsiRecord;
    const items = extractItems(data);
    allItems.push(...items);
    pagesTotal = Number(d?.pages ?? 1);
    page += 1;
  } while (page < pagesTotal);

  let cashTotal = 0;
  let cardTotal = 0;

  for (const item of allItems) {
    const itemRecord = item as AqsiRecord & {
      payments?: AqsiPayment[];
      paymentList?: AqsiPayment[];
      content?: { checkClose?: { payments?: AqsiPayment[] } };
      total?: number | string;
      sum?: number | string;
      amount?: number | string;
      totalSum?: number | string;
    };
    // AQSI V2: платежи в content.checkClose.payments; V4 — в item.payments
    const payments = Array.isArray(itemRecord.payments)
      ? itemRecord.payments
      : Array.isArray(itemRecord.paymentList)
        ? itemRecord.paymentList
        : Array.isArray(itemRecord.content?.checkClose?.payments)
          ? itemRecord.content.checkClose.payments
          : [itemRecord as AqsiPayment];
    const sums = sumFromPayments(payments);
    const itemSum =
      Number(itemRecord.total ?? itemRecord.sum ?? itemRecord.amount ?? itemRecord.totalSum ?? 0) || 0;
    if (itemSum > 0 && sums.cash === 0 && sums.card === 0) {
      cashTotal += itemSum;
    } else {
      cashTotal += sums.cash;
      cardTotal += sums.card;
    }
  }

  return { cashTotal, cardTotal };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeIsoDateTime(value?: string | null): string {
  if (value?.trim()) {
    const candidate = value.includes("T") ? value : value.replace(" ", "T");
    const dt = new Date(candidate);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  return new Date().toISOString();
}

function normalizeString(value?: string | null, maxLength?: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return typeof maxLength === "number" ? trimmed.slice(0, maxLength) : trimmed;
}

async function resolveAqsiBinding(config: AqsiConfig): Promise<{
  deviceId?: string;
  shopId?: string;
  cashierId?: string;
}> {
  if (config.deviceId || (config.shopId && config.cashierId)) {
    return {
      deviceId: config.deviceId,
      shopId: config.shopId,
      cashierId: config.cashierId,
    };
  }

  const devicesData = await aqsiFetchJson<{ devices?: AqsiDevice[] } | AqsiDevice[]>(
    config.devicesPath,
    { method: "GET" }
  );
  const devices = Array.isArray(devicesData)
    ? devicesData
    : Array.isArray(devicesData?.devices)
      ? devicesData.devices
      : [];

  if (devices.length === 1 && devices[0]?.id != null) {
    return {
      deviceId: String(devices[0].id),
      shopId:
        config.shopId ??
        (devices[0].shopId != null ? String(devices[0].shopId) : undefined),
      cashierId: config.cashierId,
    };
  }

  if (devices.length === 0) {
    throw new Error("В AQSI не найдено ни одного устройства. Укажите AQSI_DEVICE_ID в .env.local.");
  }

  throw new Error(
    "В AQSI найдено несколько устройств. Укажите AQSI_DEVICE_ID в .env.local, чтобы понять, куда отправлять заказ."
  );
}

export async function syncAqsiPendingOrder(
  input: SyncAqsiPendingOrderInput
): Promise<SyncAqsiPendingOrderResult> {
  if (!normalizeString(input.id)) {
    throw new Error("Не передан идентификатор заказа для AQSI.");
  }

  const items = input.items
    .map((item, index) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const discountPercent = Math.max(0, Math.min(100, Number(item.discountPercent) || 0));
      // AQSI schema: OrderDtoPosition.text has maxLength=128
      const name = normalizeString(item.name, 128) ?? `Позиция ${index + 1}`;
      if (quantity <= 0 || unitPrice <= 0) return null;
      const effectiveUnitPrice = roundMoney(unitPrice * (1 - discountPercent / 100));
      if (effectiveUnitPrice <= 0) return null;

      return {
        positionId: randomUUID(),
        text: name,
        // AQSI schema allows sku as nullable string; sending empty string instead of `undefined`
        // avoids potential "missing/invalid parameter" validations on the provider side.
        sku: normalizeString(item.sku, 64) ?? "",
        quantity,
        price: effectiveUnitPrice,
        tax: 6,
        // Для /v2/Orders/simple на этом аккаунте AQSI принимает 1/2, но не 4.
        // 1 стабильно проходит в прямой проверке API.
        paymentMethodType: 1,
        paymentSubjectType: 1,
        addingType: 1,
        addedAt: new Date().toISOString(),
        editable: true,
        unitOfMeasurement: "Piece",
        unitCode: 0,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (items.length === 0) {
    throw new Error("В отгрузке нет позиций с количеством и ценой для отправки в AQSI.");
  }

  const config = getAqsiConfig();
  const binding = await resolveAqsiBinding(config);
  const orderId = normalizeString(input.id)!;
  const payload: Record<string, unknown> = {
    id: orderId,
    number: normalizeString(input.number, 32) ?? orderId.slice(0, 32),
    dateTime: normalizeIsoDateTime(input.dateTime),
    status: "Отложен",
    content: {
      type: 1,
      positions: items,
      customer: normalizeString(input.customer, 243),
      customerContact: normalizeString(input.customerContact, 512),
    },
    isEditableByDevice: true,
    ignoreItemCodeCheck: false,
  };

  const comment = normalizeString(input.comment, 1024);
  if (comment) payload.comment = comment;
  if (binding.deviceId) payload.device = binding.deviceId;
  if (binding.shopId) payload.shop = binding.shopId;
  if (binding.cashierId) payload.cashier = binding.cashierId;

  const basePositionPayload = items.map((item) => ({
    positionId: item.positionId,
    text: item.text,
    sku: item.sku,
    quantity: item.quantity,
    price: item.price,
    tax: item.tax,
    paymentMethodType: item.paymentMethodType,
    paymentSubjectType: item.paymentSubjectType,
    addingType: item.addingType,
    addedAt: item.addedAt,
    editable: item.editable,
    unitOfMeasurement: item.unitOfMeasurement,
    unitCode: item.unitCode,
  }));

  const fallbackPayloads: Record<string, unknown>[] = [
    payload,
    {
      id: payload.id,
      number: payload.number,
      dateTime: payload.dateTime,
      content: {
        positions: basePositionPayload.map((position) => ({
          text: position.text,
          sku: position.sku,
          quantity: position.quantity,
          price: position.price,
          tax: position.tax,
          paymentMethodType: position.paymentMethodType,
          paymentSubjectType: position.paymentSubjectType,
        })),
      },
      comment: payload.comment,
      device: payload.device,
      shop: payload.shop,
      cashier: payload.cashier,
    },
    {
      id: payload.id,
      number: payload.number,
      dateTime: payload.dateTime,
      content: {
        positions: basePositionPayload.map((position) => ({
          text: position.text,
          quantity: position.quantity,
          price: position.price,
          tax: position.tax,
          paymentMethodType: position.paymentMethodType,
        })),
      },
      device: payload.device,
      shop: payload.shop,
      cashier: payload.cashier,
    },
  ];

  let lastError: unknown;
  for (let attempt = 0; attempt < fallbackPayloads.length; attempt += 1) {
    try {
      await aqsiFetchJson(config.pendingOrderPath, {
        method: "POST",
        body: JSON.stringify(fallbackPayloads[attempt]),
      });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isInvalidParams =
        message.includes("AQSI ответил 412") ||
        /некорректн(ые|ых) параметр/i.test(message) ||
        (message.includes("AQSI ответил 400") &&
          (/field .* is invalid/i.test(message) ||
            /позиция\s+\d+:/i.test(message)));
      const canRetry = isInvalidParams && attempt < fallbackPayloads.length - 1;
      if (!canRetry) throw error;
      console.warn(
        `[syncAqsiPendingOrder] Retry ${attempt + 2}/${fallbackPayloads.length} with simplified payload after AQSI validation error`
      );
    }
  }

  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  try {
    const raw = await aqsiFetchJson<Record<string, unknown>>(
      `${config.pendingOrderPath}/${encodeURIComponent(orderId)}`,
      { method: "GET" }
    );

    return {
      orderId,
      uid: typeof raw?.uid === "string" ? raw.uid : undefined,
      status: typeof raw?.status === "string" ? raw.status : undefined,
      deviceId: binding.deviceId,
      shopId: binding.shopId,
      cashierId: binding.cashierId,
      raw,
    };
  } catch {
    // Иногда AQSI принимает заказ, но не сразу отдаёт его по GET.
    // Для UI важнее не потерять успешное создание отложенного заказа.
    return {
      orderId,
      status: "Отложен",
      deviceId: binding.deviceId,
      shopId: binding.shopId,
      cashierId: binding.cashierId,
      raw: null,
    };
  }
}

