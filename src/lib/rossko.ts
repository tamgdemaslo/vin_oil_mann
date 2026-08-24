import * as soap from "soap";
import { createHash } from "node:crypto";
import { assertExternalSideEffectAllowed } from "@/lib/external-side-effects";
import { getBranchIntegrationValues } from "@/lib/branch-integration-credentials";

const ROSSKO_WSDL_BASE = "https://api.rossko.ru/service/v2.1";

export type RosskoOfferPriority = "optimal" | "fastest" | "lowest_price" | "local_stock";

export type RosskoConfig = {
  key1: string;
  key2: string;
  timeoutMs: number;
  requestsPerSecond: number;
  deliveryId?: string;
  addressId?: string;
  paymentId?: string;
  requisiteId?: string;
  contactName?: string;
  contactPhone?: string;
  contactComment?: string;
  deliveryParts: boolean;
  offerPriority: RosskoOfferPriority;
};

export class RosskoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosskoError";
  }
}

type SoapClient = soap.Client & {
  GetSearchAsync?: (args: Record<string, unknown>) => Promise<unknown[]>;
  GetCheckoutDetailsAsync?: (args: Record<string, unknown>) => Promise<unknown[]>;
  GetCheckoutAsync?: (args: Record<string, unknown>) => Promise<unknown[]>;
  GetOrdersAsync?: (args: Record<string, unknown>) => Promise<unknown[]>;
};

class RateLimiter {
  private queue = Promise.resolve();
  private lastAt = 0;

  constructor(private readonly requestsPerSecond: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const minInterval = this.requestsPerSecond <= 0 ? 0 : 1000 / this.requestsPerSecond;
    const prev = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const wait = this.lastAt + minInterval - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastAt = Date.now();
      return await fn();
    } finally {
      release();
    }
  }
}

const limiters = new Map<number, RateLimiter>();
const searchClients = new Map<string, Promise<SoapClient>>();
const checkoutDetailsCache = new Map<string, { at: number; data: Record<string, unknown> }>();

function credentialFingerprint(cfg: RosskoConfig) {
  return createHash("sha256").update(`${cfg.key1}\u0000${cfg.key2}`, "utf8").digest("base64url");
}

function wsdlUrl(service: string): string {
  return `${ROSSKO_WSDL_BASE}/${service}?wsdl`;
}

function limiter(cfg: RosskoConfig): RateLimiter {
  const key = cfg.requestsPerSecond;
  let l = limiters.get(key);
  if (!l) {
    l = new RateLimiter(key);
    limiters.set(key, l);
  }
  return l;
}

async function createClient(service: string, cfg: RosskoConfig): Promise<SoapClient> {
  const client = (await soap.createClientAsync(wsdlUrl(service), {
    wsdl_options: {
      timeout: cfg.timeoutMs,
    },
  })) as SoapClient;
  return client;
}

export async function recoverableRosskoClient<T>(cache: Map<string, Promise<T>>, key: string, create: () => Promise<T>): Promise<T> {
  let pending = cache.get(key);
  if (!pending) {
    pending = Promise.resolve().then(create);
    cache.set(key, pending);
  }
  try {
    return await pending;
  } catch (error) {
    // A rejected Promise must not poison every later search until the app is
    // restarted. Delete only the same attempt so a concurrent replacement is
    // never removed accidentally.
    if (cache.get(key) === pending) cache.delete(key);
    throw error;
  }
}

async function getSearchClient(cfg: RosskoConfig): Promise<SoapClient> {
  const sig = `${cfg.timeoutMs}:${credentialFingerprint(cfg)}`;
  if (!searchClients.has(sig) && searchClients.size >= 20) searchClients.delete(searchClients.keys().next().value!);
  return recoverableRosskoClient(searchClients, sig, () => createClient("GetSearch", cfg));
}

function firstResult(v: unknown): Record<string, unknown> {
  const raw = Array.isArray(v) ? v[0] : v;
  const safe = jsonSafe(raw);
  const unwrapped = unwrapSoapPayload(safe);
  if (unwrapped && typeof unwrapped === "object") return unwrapped as Record<string, unknown>;
  return { data: jsonSafe(raw) };
}

function unwrapSoapPayload(v: unknown): unknown {
  let cur = v;
  for (let i = 0; i < 5; i++) {
    if (!isRecord(cur)) return cur;
    const keys = Object.keys(cur);
    const unwrapKey = keys.find((key) =>
      ["return", "result", "data"].includes(key.toLowerCase()) || key.toLowerCase().endsWith("result")
    );
    if (!unwrapKey) return cur;
    const next = cur[unwrapKey];
    if (!next || next === cur) return cur;
    cur = next;
  }
  return cur;
}

function jsonSafe(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

function assertSuccess(data: Record<string, unknown>, fallback: string): Record<string, unknown> {
  const success = data.success ?? data.Success;
  if (success === false || success === "false" || success === 0 || success === "0") {
    throw new RosskoError(String(data.message || data.Message || fallback));
  }
  return data;
}

function configOpt(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

export async function rosskoConfig(): Promise<RosskoConfig> {
  const values = await getBranchIntegrationValues(
    "rossko",
    ["key1", "key2", "timeoutMs", "requestsPerSecond", "deliveryId", "addressId", "paymentId", "requisiteId", "contactName", "contactPhone", "contactComment", "deliveryParts", "offerPriority"],
    ["key1", "key2"]
  );
  const deliveryPartsRaw = (values.deliveryParts ?? "true").trim().toLowerCase();
  return {
    key1: values.key1.trim(),
    key2: values.key2.trim(),
    timeoutMs: Math.max(5_000, parseInt(values.timeoutMs ?? "20000", 10) || 20_000),
    requestsPerSecond: Math.max(0.2, parseFloat(values.requestsPerSecond ?? "4") || 4),
    deliveryId: configOpt(values.deliveryId),
    addressId: configOpt(values.addressId),
    paymentId: configOpt(values.paymentId),
    requisiteId: configOpt(values.requisiteId),
    contactName: configOpt(values.contactName),
    contactPhone: configOpt(values.contactPhone),
    contactComment: configOpt(values.contactComment),
    deliveryParts: !["0", "false", "no"].includes(deliveryPartsRaw),
    offerPriority: parseOfferPriority(values.offerPriority),
  };
}

function parseOfferPriority(value: string | undefined): RosskoOfferPriority {
  if (value === "fastest" || value === "lowest_price" || value === "local_stock") return value;
  return "optimal";
}

export function assertRosskoKeys(cfg: RosskoConfig): void {
  if (!cfg.key1 || !cfg.key2) {
    throw new RosskoError("Для активного филиала не настроены key1/key2 интеграции ROSSKO");
  }
}

export async function rosskoCheckoutDetails(cfg: RosskoConfig): Promise<Record<string, unknown>> {
  assertRosskoKeys(cfg);
  const now = Date.now();
  const cacheKey = credentialFingerprint(cfg);
  const cached = checkoutDetailsCache.get(cacheKey);
  if (cached && now - cached.at < 10 * 60 * 1000) {
    return cached.data;
  }
  try {
    const client = await createClient("GetCheckoutDetails", cfg);
    const resp = await limiter(cfg).run(() =>
      client.GetCheckoutDetailsAsync!({ KEY1: cfg.key1, KEY2: cfg.key2 })
    );
    const data = assertSuccess(firstResult(resp), "ROSSKO GetCheckoutDetails failed");
    if (checkoutDetailsCache.size >= 20) checkoutDetailsCache.delete(checkoutDetailsCache.keys().next().value!);
    checkoutDetailsCache.set(cacheKey, { at: Date.now(), data });
    return data;
  } catch (e) {
    throw formatRosskoError(e);
  }
}

export async function rosskoSearch(
  cfg: RosskoConfig,
  opts: { text: string; deliveryId: string; addressId?: string }
): Promise<Record<string, unknown>> {
  assertRosskoKeys(cfg);
  const params: Record<string, unknown> = {
    KEY1: cfg.key1,
    KEY2: cfg.key2,
    text: opts.text,
    delivery_id: opts.deliveryId,
  };
  if (opts.addressId) params.address_id = opts.addressId;
  try {
    const client = await getSearchClient(cfg);
    const resp = await limiter(cfg).run(() => client.GetSearchAsync!(params));
    return prioritizeRosskoSearch(assertSuccess(firstResult(resp), "ROSSKO GetSearch failed"), cfg.offerPriority);
  } catch (e) {
    throw formatRosskoError(e);
  }
}

/**
 * This is a local business preference, not a ROSSKO request parameter. The
 * candidate stock remains the exact `stock.id` returned by GetSearch and is
 * passed unchanged to GetCheckout.
 */
export function prioritizeRosskoSearch(data: Record<string, unknown>, priority: RosskoOfferPriority): Record<string, unknown> {
  const copy = jsonSafe(data);
  if (!isRecord(copy)) return data;
  const partsList = asRecord(copy.PartsList);
  const parts = partsList?.Part;
  for (const part of Array.isArray(parts) ? parts : parts ? [parts] : []) {
    const partRow = asRecord(part);
    const stocks = asRecord(partRow?.stocks);
    const stockValue = stocks?.stock;
    const list = Array.isArray(stockValue) ? stockValue : stockValue == null ? [] : [stockValue];
    if (!stocks || !list.length) continue;
    stocks.stock = [...list].sort((left, right) => compareRosskoStock(asRecord(left), asRecord(right), priority));
  }
  return copy;
}

function compareRosskoStock(left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined, priority: RosskoOfferPriority) {
  const price = (row: Record<string, unknown> | undefined) => finiteNumber(row?.price, Number.MAX_SAFE_INTEGER);
  const delivery = (row: Record<string, unknown> | undefined) => finiteNumber(row?.delivery, Number.MAX_SAFE_INTEGER);
  // GetSearch documents `extra`: 0 is a regular offer and 1 is an additional warehouse offer.
  const extra = (row: Record<string, unknown> | undefined) => finiteNumber(row?.extra, 1);
  const primary = (row: Record<string, unknown> | undefined) => [extra(row), delivery(row), price(row)];
  const by = (pairs: number[][]) => {
    for (const [a, b] of pairs) if (a !== b) return a - b;
    return 0;
  };
  if (priority === "fastest") return by([[delivery(left), delivery(right)], [price(left), price(right)], [extra(left), extra(right)]]);
  if (priority === "lowest_price") return by([[price(left), price(right)], [delivery(left), delivery(right)], [extra(left), extra(right)]]);
  if (priority === "local_stock") return by([[extra(left), extra(right)], [delivery(left), delivery(right)], [price(left), price(right)]]);
  return by(primary(left).map((value, index) => [value, primary(right)[index]]));
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

export type RosskoCheckoutPart = {
  partnumber: string;
  brand: string;
  stock: string;
  count: number;
  comment?: string;
};

export async function rosskoCheckout(
  cfg: RosskoConfig,
  opts: {
    deliveryId: string;
    addressId?: string;
    paymentId: string;
    requisiteId?: string;
    contactName: string;
    contactPhone: string;
    comment?: string;
    deliveryParts: boolean;
    parts: RosskoCheckoutPart[];
  }
): Promise<Record<string, unknown>> {
  assertExternalSideEffectAllowed("supplier_order");
  assertExternalSideEffectAllowed("rossko_order");
  assertRosskoKeys(cfg);
  const payload: Record<string, unknown> = {
    KEY1: cfg.key1,
    KEY2: cfg.key2,
    delivery: {
      delivery_id: opts.deliveryId,
      ...(opts.addressId ? { address_id: opts.addressId } : {}),
    },
    payment: {
      payment_id: opts.paymentId,
      ...(opts.requisiteId ? { requisite_id: opts.requisiteId } : {}),
    },
    contact: {
      name: opts.contactName,
      phone: opts.contactPhone,
      ...(opts.comment ? { comment: opts.comment.slice(0, 200) } : {}),
    },
    delivery_parts: opts.deliveryParts,
    PARTS: { Part: opts.parts },
  };

  try {
    const client = await createClient("GetCheckout", cfg);
    const resp = await limiter(cfg).run(() => client.GetCheckoutAsync!(payload));
    return assertSuccess(firstResult(resp), "ROSSKO GetCheckout failed");
  } catch (e) {
    throw formatRosskoError(e);
  }
}

export async function rosskoOrders(cfg: RosskoConfig, orderIds: number[]): Promise<Record<string, unknown>> {
  assertRosskoKeys(cfg);
  if (!orderIds.length) throw new RosskoError("ids пустой");
  const payload = {
    KEY1: cfg.key1,
    KEY2: cfg.key2,
    order_ids: { id: orderIds.slice(0, 20).map((x) => Number(x)) },
  };
  try {
    const client = await createClient("GetOrders", cfg);
    const resp = await limiter(cfg).run(() => client.GetOrdersAsync!(payload));
    return assertSuccess(firstResult(resp), "ROSSKO GetOrders failed");
  } catch (e) {
    throw formatRosskoError(e);
  }
}

export type RosskoCheckoutOptions = {
  delivery: Array<{ id: string; name: string }>;
  payment: Array<{ id: string; name: string }>;
  address: Array<{ id: string; city: string; street: string; house: string; office: string; deliveryIds: string[]; label: string }>;
  company: Array<{ id: string; name: string; requisite: string }>;
};

type RosskoCheckoutSelection = Pick<RosskoConfig, "deliveryId" | "addressId" | "paymentId" | "requisiteId">;

/**
 * Keep this adapter intentionally narrow: every value comes from a documented
 * GetCheckoutDetails response path. It must not infer a profile, warehouse, or
 * default delivery address from unrelated SOAP fields.
 */
export function rosskoCheckoutOptions(details: Record<string, unknown>): RosskoCheckoutOptions {
  const deliveries = collectionAt(details, "DeliveryType", "delivery").flatMap((row) => {
    const id = textAt(row, "id");
    const name = textAt(row, "name");
    return id && name ? [{ id, name }] : [];
  });
  const payments = collectionAt(details, "PaymentType", "payment").flatMap((row) => {
    const id = textAt(row, "id");
    const name = textAt(row, "name");
    return id && name ? [{ id, name }] : [];
  });
  const addresses = collectionAt(details, "DeliveryAddress", "address").flatMap((row) => {
    const id = textAt(row, "id");
    if (!id) return [];
    const city = textAt(row, "city");
    const street = textAt(row, "street");
    const house = textAt(row, "house");
    const office = textAt(row, "office");
    const deliveryIds = primitiveArray(asRecord(row.Delivery)?.ids && asRecord(asRecord(row.Delivery)?.ids)?.id);
    const label = [city, street, house && `д. ${house}`, office && `оф. ${office}`].filter(Boolean).join(", ") || `Адрес ${id}`;
    return [{ id, city, street, house, office, deliveryIds, label }];
  });
  const companies = collectionAt(details, "CompanyList", "company").flatMap((row) => {
    const id = textAt(row, "id");
    const name = textAt(row, "name");
    const requisite = textAt(row, "requisite");
    return id && name ? [{ id, name, requisite }] : [];
  });
  return { delivery: deliveries, payment: payments, address: addresses, company: companies };
}

/** Returns user-safe configuration errors before a value can be persisted. */
export function validateRosskoCheckoutSelection(options: RosskoCheckoutOptions, selection: RosskoCheckoutSelection): string[] {
  const errors: string[] = [];
  const deliveryId = configOpt(selection.deliveryId);
  const addressId = configOpt(selection.addressId);
  const paymentId = configOpt(selection.paymentId);
  const requisiteId = configOpt(selection.requisiteId);
  const delivery = options.delivery.find((row) => row.id === deliveryId);
  const address = options.address.find((row) => row.id === addressId);

  if (!deliveryId || !delivery) errors.push("Выберите способ доставки из списка ROSSKO.");
  if (!paymentId || !options.payment.some((row) => row.id === paymentId)) errors.push("Выберите способ оплаты из списка ROSSKO.");
  if (options.company.length && (!requisiteId || !options.company.some((row) => row.id === requisiteId))) {
    errors.push("Выберите организацию из реквизитов ROSSKO.");
  }

  if (addressId && !address) {
    errors.push("Выберите адрес доставки из списка ROSSKO.");
  } else if (address && delivery && address.deliveryIds.length && !address.deliveryIds.includes(delivery.id)) {
    errors.push("Выбранный адрес не поддерживает этот способ доставки.");
  } else if (!addressId && delivery && options.address.some((row) => row.deliveryIds.includes(delivery.id))) {
    errors.push("Для выбранного способа доставки укажите совместимый адрес ROSSKO.");
  }

  return errors;
}

function collectionAt(root: Record<string, unknown>, containerKey: string, itemKey: string): Record<string, unknown>[] {
  const container = asRecord(root[containerKey]);
  return recordArray(container?.[itemKey]);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function primitiveArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function textAt(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value === undefined || value === null ? "" : String(value).trim();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function formatRosskoError(e: unknown): RosskoError {
  if (e instanceof RosskoError) return e;
  if (e instanceof Error) return new RosskoError(e.message || e.name);
  return new RosskoError(String(e));
}
