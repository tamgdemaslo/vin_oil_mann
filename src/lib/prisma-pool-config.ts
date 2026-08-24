const DEFAULT_CONNECTION_LIMIT = 8;
// Production logs showed healthy requests failing during short bursts because
// all eight connections stayed busy for slightly more than five seconds. Keep
// the connection count bounded, but allow the existing pool to drain.
const DEFAULT_POOL_TIMEOUT_SECONDS = 10;
const MAX_CONNECTION_LIMIT = 20;
const MAX_POOL_TIMEOUT_SECONDS = 30;

function boundedInteger(value: string | null | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) return fallback;
  return Math.min(parsed, maximum);
}

export type PrismaPoolConfig = {
  url: string;
  connectionLimit: number;
  poolTimeoutSeconds: number;
};

type PrismaPoolEnvironment = {
  PRISMA_CONNECTION_LIMIT?: string;
  PRISMA_POOL_TIMEOUT_SECONDS?: string;
};

export function configurePrismaPool(
  rawUrl: string | undefined,
  environment: PrismaPoolEnvironment = {
    PRISMA_CONNECTION_LIMIT: process.env.PRISMA_CONNECTION_LIMIT,
    PRISMA_POOL_TIMEOUT_SECONDS: process.env.PRISMA_POOL_TIMEOUT_SECONDS,
  }
): PrismaPoolConfig | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return null;

  const connectionLimit = boundedInteger(
    environment.PRISMA_CONNECTION_LIMIT,
    DEFAULT_CONNECTION_LIMIT,
    1,
    MAX_CONNECTION_LIMIT
  );
  const poolTimeoutSeconds = boundedInteger(
    environment.PRISMA_POOL_TIMEOUT_SECONDS,
    DEFAULT_POOL_TIMEOUT_SECONDS,
    1,
    MAX_POOL_TIMEOUT_SECONDS
  );

  url.searchParams.set("connection_limit", String(connectionLimit));
  url.searchParams.set("pool_timeout", String(poolTimeoutSeconds));
  return { url: url.toString(), connectionLimit, poolTimeoutSeconds };
}
