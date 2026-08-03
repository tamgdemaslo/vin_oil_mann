import crypto from "crypto";
import { getScopedBranchId } from "@/lib/request-tenant-store";

type MessengerStorageConfig = {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string | null;
  forcePathStyle: boolean;
};

type PutObjectInput = {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string | null;
  cacheControl?: string | null;
  contentDisposition?: string | null;
};

type GetObjectResult = {
  body: Buffer;
  contentType: string;
  contentLength: number | null;
  contentRange: string | null;
  etag: string | null;
  statusCode: number;
};

const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");

export function bufferToArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function envFlag(name: string, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

export function getMessengerStorageConfig(): MessengerStorageConfig {
  return {
    enabled: envFlag("MESSENGER_STORAGE_ENABLED"),
    endpoint: (process.env.MESSENGER_STORAGE_ENDPOINT ?? "").trim().replace(/\/+$/, ""),
    region: (process.env.MESSENGER_STORAGE_REGION ?? "auto").trim() || "auto",
    bucket: (process.env.MESSENGER_STORAGE_BUCKET ?? "").trim(),
    accessKeyId: (process.env.MESSENGER_STORAGE_ACCESS_KEY_ID ?? "").trim(),
    secretAccessKey: (process.env.MESSENGER_STORAGE_SECRET_ACCESS_KEY ?? "").trim(),
    publicBaseUrl: (process.env.MESSENGER_STORAGE_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "") || null,
    forcePathStyle: envFlag("MESSENGER_STORAGE_FORCE_PATH_STYLE", true),
  };
}

export function messengerStorageStatus() {
  const config = getMessengerStorageConfig();
  const missing = [
    ["MESSENGER_STORAGE_ENDPOINT", config.endpoint],
    ["MESSENGER_STORAGE_BUCKET", config.bucket],
    ["MESSENGER_STORAGE_ACCESS_KEY_ID", config.accessKeyId],
    ["MESSENGER_STORAGE_SECRET_ACCESS_KEY", config.secretAccessKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return {
    enabled: config.enabled,
    configured: config.enabled && missing.length === 0,
    bucket: config.bucket || null,
    endpoint: config.endpoint || null,
    region: config.region,
    publicBaseUrl: config.publicBaseUrl,
    forcePathStyle: config.forcePathStyle,
    missing,
  };
}

type StorageProbeResult = {
  ok: boolean;
  configured: boolean;
  checkedAt: string;
  durationMs: number;
  key?: string;
  contentLength?: number;
  cleanupError?: string | null;
  error?: string;
  storage: ReturnType<typeof messengerStorageStatus>;
};

function assertStorageConfigured() {
  const config = getMessengerStorageConfig();
  const status = messengerStorageStatus();
  if (!status.configured) {
    throw new Error(
      status.enabled
        ? `Messenger storage не настроен: ${status.missing.join(", ")}`
        : "MESSENGER_STORAGE_ENABLED=true не задан"
    );
  }
  return config;
}

function hmac(key: Buffer | string, value: string) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function hexSha256(value: Buffer | Uint8Array | string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function amzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function encodeKeyPath(key: string) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function storageUrl(config: MessengerStorageConfig, key: string) {
  const endpoint = new URL(config.endpoint);
  const encodedKey = encodeKeyPath(key);
  if (config.forcePathStyle) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/${encodeURIComponent(config.bucket)}/${encodedKey}`;
  } else {
    endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/${encodedKey}`;
  }
  return endpoint;
}

function signedHeaders(input: {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  url: URL;
  bodyHash: string;
  contentType?: string | null;
  contentDisposition?: string | null;
  cacheControl?: string | null;
  contentLength?: number | null;
  range?: string | null;
}) {
  const config = assertStorageConfigured();
  const { amzDate, dateStamp } = amzDates();
  const headers: Record<string, string> = {
    host: input.url.host,
    "x-amz-content-sha256": input.bodyHash,
    "x-amz-date": amzDate,
  };
  if (input.contentType) headers["content-type"] = input.contentType;
  if (input.contentDisposition) headers["content-disposition"] = input.contentDisposition;
  if (input.cacheControl) headers["cache-control"] = input.cacheControl;
  if (typeof input.contentLength === "number") headers["content-length"] = String(input.contentLength);
  if (input.range) headers.range = input.range;

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const signedHeaderNames = sortedHeaderNames.join(";");
  const canonicalQuery = [...input.url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const canonicalRequest = [
    input.method,
    input.url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames,
    input.bodyHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
  };
}

export function messengerStorageProxyUrl(kind: "attachment" | "thumbnail" | "avatar", id: string) {
  if (kind === "avatar") return `/api/messenger/conversations/${encodeURIComponent(id)}/avatar`;
  if (kind === "thumbnail") return `/api/messenger/attachments/${encodeURIComponent(id)}/thumbnail`;
  return `/api/messenger/attachments/${encodeURIComponent(id)}/content`;
}

export function publicMessengerStorageUrl(key: string) {
  const config = getMessengerStorageConfig();
  return config.publicBaseUrl ? `${config.publicBaseUrl}/${encodeKeyPath(key)}` : null;
}

export async function putMessengerStorageObject(input: PutObjectInput) {
  const config = assertStorageConfigured();
  const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
  const url = storageUrl(config, input.key);
  const headers = signedHeaders({
    method: "PUT",
    url,
    bodyHash: hexSha256(body),
    contentType: input.contentType || "application/octet-stream",
    contentDisposition: input.contentDisposition,
    cacheControl: input.cacheControl,
    contentLength: body.length,
  });
  const response = await fetch(url, { method: "PUT", headers, body: bufferToArrayBuffer(body) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Messenger storage PUT failed: ${response.status} ${text.slice(0, 180)}`);
  }
  return { key: input.key, size: body.length, etag: response.headers.get("etag") };
}

export async function getMessengerStorageObject(key: string, options?: { range?: string | null }): Promise<GetObjectResult> {
  const config = assertStorageConfigured();
  const url = storageUrl(config, key);
  const range = options?.range?.trim();
  const headers = signedHeaders({ method: "GET", url, bodyHash: EMPTY_SHA256, range: range || null });
  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Messenger storage GET failed: ${response.status} ${text.slice(0, 180)}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  return {
    body,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    contentLength: Number(response.headers.get("content-length")) || body.length || null,
    contentRange: response.headers.get("content-range"),
    etag: response.headers.get("etag"),
    statusCode: response.status,
  };
}

export async function deleteMessengerStorageObject(key: string) {
  const config = assertStorageConfigured();
  const url = storageUrl(config, key);
  const headers = signedHeaders({ method: "DELETE", url, bodyHash: EMPTY_SHA256 });
  const response = await fetch(url, { method: "DELETE", headers });
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(`Messenger storage DELETE failed: ${response.status} ${text.slice(0, 180)}`);
  }
  return { key, deleted: true };
}

export async function probeMessengerStorageConnection(): Promise<StorageProbeResult> {
  const startedAt = Date.now();
  const storage = messengerStorageStatus();
  const checkedAt = new Date().toISOString();
  if (!storage.configured) {
    return {
      ok: false,
      configured: false,
      checkedAt,
      durationMs: Date.now() - startedAt,
      error: storage.enabled
        ? `Messenger storage не настроен: ${storage.missing.join(", ")}`
        : "MESSENGER_STORAGE_ENABLED=true не задан",
      storage,
    };
  }

  const body = Buffer.from(`eco messenger storage probe ${checkedAt}\n`, "utf8");
  const key = messengerObjectKey(["messenger", "_health", checkedAt.slice(0, 10)], `probe-${crypto.randomUUID()}.txt`);
  let cleanupError: string | null = null;
  try {
    await putMessengerStorageObject({
      key,
      body,
      contentType: "text/plain; charset=utf-8",
      cacheControl: "no-store",
      contentDisposition: `inline; filename="storage-probe.txt"`,
    });
    const object = await getMessengerStorageObject(key);
    if (!object.body.equals(body)) {
      throw new Error("Storage probe read-back mismatch");
    }
    try {
      await deleteMessengerStorageObject(key);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : "Storage probe cleanup failed";
    }
    return {
      ok: true,
      configured: true,
      checkedAt,
      durationMs: Date.now() - startedAt,
      key,
      contentLength: object.body.length,
      cleanupError,
      storage,
    };
  } catch (error) {
    try {
      await deleteMessengerStorageObject(key);
    } catch {
      // Best-effort cleanup after a failed probe.
    }
    return {
      ok: false,
      configured: true,
      checkedAt,
      durationMs: Date.now() - startedAt,
      key,
      error: error instanceof Error ? error.message : "Messenger storage probe failed",
      storage,
    };
  }
}

export function safeStorageFileName(name: string, fallback = "file") {
  const normalized = name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

export function messengerObjectKey(parts: Array<string | number | null | undefined>, fileName: string) {
  const cleanParts = ["branches", getScopedBranchId(), ...parts]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .map((part) => safeStorageFileName(part, "part"));
  return `${cleanParts.join("/")}/${safeStorageFileName(fileName)}`;
}
