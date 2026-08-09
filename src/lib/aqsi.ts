import { randomUUID } from "crypto";
import {
  AQSI_MARKING_TYPE_AUTO_FLUIDS,
  AQSI_PAYMENT_SUBJECT_MARKED,
  AQSI_UNIT_CODE_LITER,
  AQSI_UNIT_CODE_PIECE,
} from "@/lib/marking";
import { toAqsiDateTimeString } from "@/lib/time";
import {
  normalizeAqsiCashierId,
  resolveAqsiCashRegister,
  type AqsiResolvedConfig,
} from "@/lib/aqsi-integration";

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
  markingCode?: string | null;
  markingRequired?: boolean;
  markingBypass?: boolean;
  measuredPour?: boolean;
};

export type SyncAqsiPendingOrderInput = {
  id: string;
  registerId?: string | null;
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

type AqsiConfig = AqsiResolvedConfig;

type AqsiDevice = {
  id?: string | number;
  shopId?: string | number | null;
  name?: string | null;
  title?: string | null;
  serial?: string | null;
};

export type AqsiDeviceOption = { id: string; label: string; shopId?: string };

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
  const fallback = rawText.slice(0, 1_000) || statusText;
  try {
    const parsed = JSON.parse(rawText) as unknown;
    const details = new Set<string>();
    const visit = (value: unknown, path?: string) => {
      if (typeof value === "string") {
        const text = value.trim();
        if (text) details.add(path ? `${path}: ${text}` : text);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, path ? `${path}[${index}]` : undefined));
        return;
      }
      if (!value || typeof value !== "object") return;
      const row = value as Record<string, unknown>;
      for (const key of ["message", "error", "detail", "reason", "code"]) {
        if (typeof row[key] === "string") visit(row[key], key === "code" ? undefined : path);
      }
      if (row.errors !== undefined) visit(row.errors, "errors");
    };
    visit(parsed);
    const detail = Array.from(details).join("; ").slice(0, 1_000);
    return detail || fallback;
  } catch {
    return fallback;
  }
}

function numericAqsiId(value: string | undefined, entityName: string): number | undefined {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`Идентификатор ${entityName} AQSI должен состоять только из цифр. Проверьте настройки кассы.`);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error(`Идентификатор ${entityName} AQSI имеет недопустимое значение. Проверьте настройки кассы.`);
  }
  return id;
}

export async function aqsiFetchJson<T>(config: AqsiConfig, path: string, init?: RequestInit): Promise<T> {
  const { apiKey, baseUrl } = config;
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
        ? " Проверьте API-ключ кассы в Управление → Интеграции."
        : res.status === 404
          ? " Проверьте адрес и путь API кассы в Управление → Интеграции."
          : "";
    // AQSI отдаёт 412 и для ошибок проверок заказа. Без detail невозможно
    // отличить неверную позицию от закрытой смены или недоступной кассы.
    console.error("[aqsiFetchJson] provider request failed", { path, status: res.status, detail });
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
  registerId?: string | null;
}): Promise<OrdersTotals> {
  const { serviceDate } = params;
  const { apiKey, baseUrl, ordersPath } = await resolveAqsiCashRegister(params.registerId);

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
          ? " Проверьте API-ключ кассы в Управление → Интеграции."
          : res.status === 404
            ? " Проверьте адрес и путь чеков AQSI в настройках кассы."
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

function normalizeAqsiDateTime(value?: string | null): string {
  const trimmed = value?.trim();
  if (trimmed) {
    const localMatch = trimmed.match(
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/
    );
    if (localMatch) return `${localMatch[1]}T${localMatch[2]}`;

    const dt = new Date(trimmed);
    if (!Number.isNaN(dt.getTime())) return toAqsiDateTimeString(dt);
  }
  return toAqsiDateTimeString();
}

function normalizeString(value?: string | null, maxLength?: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return typeof maxLength === "number" ? trimmed.slice(0, maxLength) : trimmed;
}

async function fetchAqsiDeviceRows(config: AqsiConfig) {
  const devicesData = await aqsiFetchJson<{ devices?: AqsiDevice[] } | AqsiDevice[]>(config,
    config.devicesPath,
    { method: "GET" }
  );
  return Array.isArray(devicesData)
    ? devicesData
    : Array.isArray(devicesData?.devices)
      ? devicesData.devices
      : [];
}

function publicAqsiDevices(devices: AqsiDevice[]): AqsiDeviceOption[] {
  return devices.flatMap((device) => {
    if (device.id == null) return [];
    const id = String(device.id);
    const shopId = device.shopId == null ? undefined : String(device.shopId);
    const name = device.name?.trim() || device.title?.trim() || device.serial?.trim();
    return [{ id, shopId, label: name ? `${name} · ${id}` : `Устройство ${id}` }];
  });
}

function resolveAqsiBindingFromDevices(config: AqsiConfig, devices: AqsiDevice[]): {
  deviceId?: string;
  shopId?: string;
  cashierId?: string;
} {
  const cashierId = normalizeAqsiCashierId(config.cashierId);
  if (config.deviceId || (config.shopId && cashierId)) {
    return {
      deviceId: config.deviceId,
      shopId: config.shopId,
      cashierId,
    };
  }

  if (devices.length === 1 && devices[0]?.id != null) {
    const discoveredShopId =
      config.shopId ??
      (devices[0].shopId != null ? String(devices[0].shopId) : undefined);
    if (discoveredShopId) {
      return {
        shopId: discoveredShopId,
        cashierId,
      };
    }

    return {
      deviceId: String(devices[0].id),
      cashierId,
    };
  }

  if (devices.length === 0) {
    throw new Error("В AQSI не найдено ни одного устройства. Укажите устройство в настройках кассы.");
  }

  throw new Error(
    "В AQSI найдено несколько устройств. Выберите устройство в настройках кассы."
  );
}

async function resolveAqsiBinding(config: AqsiConfig) {
  if (config.deviceId || (config.shopId && normalizeAqsiCashierId(config.cashierId))) {
    return resolveAqsiBindingFromDevices(config, []);
  }
  return resolveAqsiBindingFromDevices(config, await fetchAqsiDeviceRows(config));
}

/**
 * Проверяет не только доступность API, но и однозначность кассы/магазина.
 * Фискальные документы при этом не создаются.
 */
export async function validateAqsiConfig(config: AqsiResolvedConfig) {
  const rows = await fetchAqsiDeviceRows(config);
  if (rows.length === 0) throw new Error("В AQSI не найдено ни одного устройства. Укажите устройство в настройках кассы.");
  if (config.deviceId && !rows.some((device) => device.id != null && String(device.id) === config.deviceId)) {
    throw new Error("Выбранное устройство AQSI недоступно этому ключу.");
  }
  const needsDevice =
    !config.deviceId &&
    !(config.shopId && normalizeAqsiCashierId(config.cashierId)) &&
    rows.length > 1;
  return {
    binding: needsDevice ? null : resolveAqsiBindingFromDevices(config, rows),
    devices: publicAqsiDevices(rows),
    needsDevice,
  };
}

export async function syncAqsiPendingOrder(
  input: SyncAqsiPendingOrderInput
): Promise<SyncAqsiPendingOrderResult> {
  if (!normalizeString(input.id)) {
    throw new Error("Не передан идентификатор заказа для AQSI.");
  }

  const orderDateTime = normalizeAqsiDateTime(input.dateTime);
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
      const markingCode = normalizeString(item.markingCode, 256);
      const markingRequired = item.markingRequired === true;
      const shouldSendMarking = markingRequired && item.markingBypass !== true && Boolean(markingCode);
      const paymentSubjectType = shouldSendMarking ? AQSI_PAYMENT_SUBJECT_MARKED : 1;
      const measuredPour = item.measuredPour === true;

      return {
        positionId: randomUUID(),
        text: name,
        // AQSI schema allows sku as nullable string; sending empty string instead of `undefined`
        // avoids potential "missing/invalid parameter" validations on the provider side.
        sku: normalizeString(item.sku, 64) ?? "",
        quantity,
        price: effectiveUnitPrice,
        tax: 6,
        // ФФД 1.2, тег 1214: при передаче товара покупателю должен быть полный расчет.
        // Для маркированных товаров "Предоплата 100%" не считается выбытием в ГИС МТ.
        paymentMethodType: 4,
        paymentSubjectType,
        ...(shouldSendMarking ? { markingType: AQSI_MARKING_TYPE_AUTO_FLUIDS } : {}),
        ...(shouldSendMarking && markingCode ? { itemCode: markingCode } : {}),
        addingType: shouldSendMarking ? 2 : 1,
        addedAt: orderDateTime,
        editable: true,
        unitOfMeasurement: measuredPour ? "Litre" : "Piece",
        unitCode: measuredPour ? AQSI_UNIT_CODE_LITER : AQSI_UNIT_CODE_PIECE,
        isWeight: measuredPour ? 1 : 0,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (items.length === 0) {
    throw new Error("В отгрузке нет позиций с количеством и ценой для отправки в AQSI.");
  }

  const config = await resolveAqsiCashRegister(input.registerId);
  const binding = await resolveAqsiBinding(config);
  const orderId = normalizeString(input.id)!;
  const payload: Record<string, unknown> = {
    id: orderId,
    number: normalizeString(input.number, 32) ?? orderId.slice(0, 32),
    dateTime: orderDateTime,
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
  // В V2 AQSI ждёт числовые идентификаторы device и shop (int64), хотя UI
  // хранит их строками, чтобы без потерь показывать значения в формах.
  const deviceId = numericAqsiId(binding.deviceId, "устройства");
  const shopId = numericAqsiId(binding.shopId, "магазина");
  if (deviceId !== undefined) payload.device = deviceId;
  if (shopId !== undefined) payload.shop = shopId;
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
    markingType: item.markingType,
    itemCode: item.itemCode,
    addingType: item.addingType,
    addedAt: item.addedAt,
    editable: item.editable,
    unitOfMeasurement: item.unitOfMeasurement,
    unitCode: item.unitCode,
    isWeight: item.isWeight,
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
          markingType: position.markingType,
          itemCode: position.itemCode,
          unitOfMeasurement: position.unitOfMeasurement,
          unitCode: position.unitCode,
          isWeight: position.isWeight,
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
          paymentSubjectType: position.paymentSubjectType,
          markingType: position.markingType,
          itemCode: position.itemCode,
          unitOfMeasurement: position.unitOfMeasurement,
          unitCode: position.unitCode,
          isWeight: position.isWeight,
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
      await aqsiFetchJson(config, config.pendingOrderPath, {
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
    const raw = await aqsiFetchJson<Record<string, unknown>>(config,
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
