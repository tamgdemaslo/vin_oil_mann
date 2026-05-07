import * as soap from "soap";

const ROSSKO_WSDL_BASE = "http://api.rossko.ru/service/v2.1";

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
  deliveryParts: boolean;
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
let checkoutDetailsCache: { at: number; data: Record<string, unknown> } | null = null;

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

async function getSearchClient(cfg: RosskoConfig): Promise<SoapClient> {
  const sig = `${cfg.timeoutMs}:${cfg.key1}:${cfg.key2}`;
  let client = searchClients.get(sig);
  if (!client) {
    client = createClient("GetSearch", cfg);
    searchClients.set(sig, client);
  }
  return client;
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

function envOpt(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

export function rosskoConfig(): RosskoConfig {
  const deliveryPartsRaw = (process.env.ROSSKO_DELIVERY_PARTS ?? "true").trim().toLowerCase();
  return {
    key1: (process.env.ROSSKO_KEY1 ?? "").trim(),
    key2: (process.env.ROSSKO_KEY2 ?? "").trim(),
    timeoutMs: Math.max(5_000, parseInt(process.env.ROSSKO_TIMEOUT_MS ?? "20000", 10) || 20_000),
    requestsPerSecond: Math.max(0.2, parseFloat(process.env.ROSSKO_RPS ?? "4") || 4),
    deliveryId: envOpt("ROSSKO_DELIVERY_ID"),
    addressId: envOpt("ROSSKO_ADDRESS_ID"),
    paymentId: envOpt("ROSSKO_PAYMENT_ID"),
    requisiteId: envOpt("ROSSKO_REQUISITE_ID"),
    contactName: envOpt("ROSSKO_CONTACT_NAME"),
    contactPhone: envOpt("ROSSKO_CONTACT_PHONE"),
    deliveryParts: !["0", "false", "no"].includes(deliveryPartsRaw),
  };
}

export function assertRosskoKeys(cfg: RosskoConfig): void {
  if (!cfg.key1 || !cfg.key2) {
    throw new RosskoError("ROSSKO_KEY1/ROSSKO_KEY2 не заданы");
  }
}

export async function rosskoCheckoutDetails(cfg: RosskoConfig): Promise<Record<string, unknown>> {
  assertRosskoKeys(cfg);
  const now = Date.now();
  if (checkoutDetailsCache && now - checkoutDetailsCache.at < 10 * 60 * 1000) {
    return checkoutDetailsCache.data;
  }
  try {
    const client = await createClient("GetCheckoutDetails", cfg);
    const resp = await limiter(cfg).run(() =>
      client.GetCheckoutDetailsAsync!({ KEY1: cfg.key1, KEY2: cfg.key2 })
    );
    const data = assertSuccess(firstResult(resp), "ROSSKO GetCheckoutDetails failed");
    checkoutDetailsCache = { at: Date.now(), data };
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
    return assertSuccess(firstResult(resp), "ROSSKO GetSearch failed");
  } catch (e) {
    throw formatRosskoError(e);
  }
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

export function suggestRosskoDefaults(details: Record<string, unknown>): {
  delivery_id?: string;
  address_id?: string;
  payment_id?: string;
  requisite_id?: string;
} {
  const deliveries = findCollection(details, ["TypeDelivery", "typeDelivery", "Delivery", "delivery"]);
  const addresses = findCollection(details, ["AddressDelivery", "addressDelivery", "Address", "address"]);
  const payments = findCollection(details, ["TypePayment", "typePayment", "Payment", "payment"]);
  const companies = findCollection(details, ["CompanyList", "companyList", "Company", "company"]);

  const delivery = pickByName(deliveries, ["курьер"]) ?? deliveries[0];
  const address = addresses[0];
  const payment = pickByName(payments, ["нал"]) ?? payments[0];
  const company =
    pickByName(companies, ["елисеенко"]) ??
    pickByName(companies, ["ип"]) ??
    companies[0];

  return {
    delivery_id: idValue(delivery, ["ID", "id"]),
    address_id: idValue(address, ["ID", "id"]),
    payment_id: idValue(payment, ["ID", "id"]),
    requisite_id: idValue(company, ["ID", "id", "RequisiteID", "requisite_id"]),
  };
}

function findCollection(root: unknown, keys: string[]): Record<string, unknown>[] {
  const wanted = new Set(keys.map((x) => x.toLowerCase()));
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];

  while (queue.length) {
    const cur = queue.shift();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);

    if (Array.isArray(cur)) {
      const arr = cur.filter(isRecord);
      if (arr.length) return arr;
      queue.push(...cur);
      continue;
    }

    if (!isRecord(cur)) continue;
    for (const [key, value] of Object.entries(cur)) {
      if (wanted.has(key.toLowerCase())) {
        const arr = asArray(value);
        if (arr.length) return arr;
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return [];
}

function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter(isRecord);
  if (isRecord(v)) {
    if (Array.isArray(v.Item)) return v.Item.filter(isRecord);
    if (Array.isArray(v.item)) return v.item.filter(isRecord);
    return [v];
  }
  return [];
}

function pickByName(rows: Record<string, unknown>[], tokens: string[]): Record<string, unknown> | undefined {
  return rows.find((row) => {
    const name = String(row.Name ?? row.name ?? "").toLowerCase();
    return tokens.some((token) => name.includes(token));
  });
}

function idValue(row: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!row) return undefined;
  for (const key of keys) {
    const v = row[key];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function formatRosskoError(e: unknown): RosskoError {
  if (e instanceof RosskoError) return e;
  if (e instanceof Error) return new RosskoError(e.message || e.name);
  return new RosskoError(String(e));
}
