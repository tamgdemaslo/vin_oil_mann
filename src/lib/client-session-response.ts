export type ClientSessionUnavailable = {
  status: "unavailable";
  httpStatus: number;
  retryAfterSeconds: number | null;
};

export type ClientSessionResult<T extends { user?: unknown }> =
  | { status: "authenticated"; data: T & { user: NonNullable<T["user"]> } }
  | { status: "unauthenticated" }
  | ClientSessionUnavailable;

function retryAfterSeconds(response: Response) {
  const raw = response.headers.get("Retry-After");
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * A transient API failure must not be interpreted as a destroyed session.
 * The session endpoint intentionally returns HTTP 200 with `{ user: null }`
 * when the cookie is not authenticated; only that response (or 401/403) is a
 * reason to navigate to the login screen.
 */
export async function readClientSessionResponse<T extends { user?: unknown }>(
  response: Response
): Promise<ClientSessionResult<T>> {
  if (response.status === 401 || response.status === 403) {
    return { status: "unauthenticated" };
  }
  if (!response.ok) {
    return {
      status: "unavailable",
      httpStatus: response.status,
      retryAfterSeconds: retryAfterSeconds(response),
    };
  }
  try {
    const data = (await response.json()) as T;
    if (!data?.user) return { status: "unauthenticated" };
    return {
      status: "authenticated",
      data: data as T & { user: NonNullable<T["user"]> },
    };
  } catch {
    return { status: "unavailable", httpStatus: response.status, retryAfterSeconds: null };
  }
}

export function clientSessionUnavailableMessage(result: ClientSessionUnavailable) {
  if (result.httpStatus === 429) {
    const wait = result.retryAfterSeconds ? ` Подождите ${result.retryAfterSeconds} сек. и повторите.` : " Повторите через несколько секунд.";
    return `Сервер временно ограничил фоновые запросы.${wait}`;
  }
  return "Не удалось проверить авторизацию. Проверьте соединение и повторите попытку.";
}
