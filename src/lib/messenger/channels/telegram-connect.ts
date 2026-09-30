export type TelegramTransport = "tcp" | "websocket";

export function canUseTelegramUserSession(account: { isActive: boolean; status: string } | null): boolean {
  return Boolean(account?.isActive && (account.status === "connected" || account.status === "degraded"));
}

export function isTelegramConnectionFailure(error: unknown): boolean {
  if (error instanceof TelegramConnectionError) return true;
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; cause?: unknown; type?: unknown };
  if (typeof value.code === "string" && /^(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN)$/.test(value.code)) return true;
  if (typeof value.message === "string" && /connect timeout|connection.*timed out|socket.*(closed|timeout)|connection (closed|not connected)|websocket.*(error|fail)/i.test(value.message)) return true;
  // GramJS WebSocket failures may be ErrorEvent objects rather than Errors.
  if (value.type === "error") return true;
  return value.cause !== error && value.cause != null ? isTelegramConnectionFailure(value.cause) : false;
}

export class TelegramConnectionError extends Error {
  constructor(transports: TelegramTransport[], cause: unknown) {
    super(`Сервер не смог подключиться к Telegram (${transports.map((transport) => transport === "tcp" ? "TCP" : "WebSocket").join(", ")}). Соединение временно недоступно.`, { cause });
    this.name = "TelegramConnectionError";
  }
}

export async function connectTelegramWithFallback<T>(input: {
  preferredTransport: TelegramTransport;
  proxyConfigured: boolean;
  createClient: (transport: TelegramTransport) => T;
  connectClient: (client: T) => Promise<void>;
  closeClient: (client: T) => Promise<void>;
}): Promise<{ client: T; transport: TelegramTransport }> {
  const transports: TelegramTransport[] = input.proxyConfigured
    ? ["tcp"]
    : [input.preferredTransport, input.preferredTransport === "tcp" ? "websocket" : "tcp"];
  for (const [index, transport] of transports.entries()) {
    const client = input.createClient(transport);
    try {
      await input.connectClient(client);
      return { client, transport };
    } catch (error) {
      await input.closeClient(client);
      if (!isTelegramConnectionFailure(error)) throw error;
      if (index === transports.length - 1) throw new TelegramConnectionError(transports, error);
    }
  }
  throw new Error("Telegram transport is unavailable");
}
