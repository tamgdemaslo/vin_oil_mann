import { createHash } from "node:crypto";
import { AvitoAutoloadError } from "./schemas";

const API_ORIGIN = "https://api.avito.ru";
const tokens = new Map<string, { token: string; expiresAt: number }>();
export type AvitoFetch = typeof fetch;

/** Fixed provider origin. GET requests may be repeated by the caller; publication POSTs are never retried automatically. */
export class AvitoAutoloadClient {
  readonly credentialFingerprint: string;
  constructor(private readonly clientId: string, private readonly clientSecret: string, private readonly request: AvitoFetch = fetch) {
    this.credentialFingerprint = createHash("sha256").update(`${this.clientId}\0${this.clientSecret}`).digest("hex");
  }

  private async readResponse(response: Response) {
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: "Авито отклонил ключи подключения", 403: "У аккаунта нет доступа к этому методу API Авито",
        404: "Метод API Авито недоступен для этого аккаунта", 429: "Авито ограничил частоту запросов. Повторите позже",
      };
      throw new AvitoAutoloadError(messages[response.status] ?? `Авито вернул ошибку HTTP ${response.status}`, 502, `AVITO_HTTP_${response.status}`);
    }
    const text = await response.text();
    if (!text.trim()) return {} as Record<string, unknown>;
    let data: Record<string, unknown>;
    try { data = JSON.parse(text); } catch { throw new AvitoAutoloadError("Авито вернул ответ неизвестного формата", 502, "AVITO_INVALID_RESPONSE"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new AvitoAutoloadError("Авито вернул ответ неизвестного формата", 502, "AVITO_INVALID_RESPONSE");
    if (data.error) throw new AvitoAutoloadError("Авито не принял запрос. Проверьте настройки аккаунта и отчёт автозагрузки", 502, "AVITO_REJECTED_REQUEST");
    return data;
  }

  private async token() {
    const key = this.credentialFingerprint;
    const cached = tokens.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await this.request(`${API_ORIGIN}/token`, {
      method: "POST", body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.clientId, client_secret: this.clientSecret }),
      signal: AbortSignal.timeout(20_000), cache: "no-store", redirect: "error",
    });
    const data = await this.readResponse(response);
    if (typeof data.access_token !== "string" || !data.access_token) throw new AvitoAutoloadError("Не удалось получить токен Авито", 502, "AVITO_TOKEN_MISSING");
    if (tokens.size >= 256) tokens.delete(tokens.keys().next().value!);
    tokens.set(key, { token: data.access_token, expiresAt: Date.now() + Math.min(86_400, Math.max(60, Number(data.expires_in) || 3600)) * 1000 });
    return data.access_token;
  }

  async call(path: string, method: "GET" | "POST" = "GET", body?: unknown) {
    if (!/^\/(autoload|core)\/v\d+\//.test(path)) throw new Error("Unsupported Avito API path");
    const token = await this.token();
    const response = await this.request(API_ORIGIN + path, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000), cache: "no-store", redirect: "error",
    });
    if (response.status === 401) tokens.delete(this.credentialFingerprint);
    return this.readResponse(response);
  }

  profile() { return this.call("/autoload/v2/profile"); }
  account() { return this.call("/core/v1/accounts/self"); }
  upload() { return this.call("/autoload/v1/upload", "POST"); }

  async connectFeed(feedUrl: string, feedName: string, replacedFeedUrl?: string) {
    const current = await this.profile();
    const existing = Array.isArray(current.feeds_data) ? current.feeds_data.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value))) : [];
    const feeds = existing.filter((feed) => feed.feed_name !== feedName && feed.feed_url !== feedUrl && (!replacedFeedUrl || feed.feed_url !== replacedFeedUrl));
    feeds.push({ feed_name: feedName, feed_url: feedUrl });
    // Keep paid-placement limits, schedule and other provider-owned settings.
    // A missing schedule must be set in Avito rather than silently enabling every slot.
    // GET may return null here; POST requires the report_email string even
    // when delivery by email is disabled. Omitting it makes Avito reject 400.
    const payload = Object.fromEntries(Object.entries({ ...current, feeds_data: feeds, autoload_enabled: true, report_email: typeof current.report_email === "string" ? current.report_email : "" }).filter(([, value]) => value !== null));
    await this.call("/autoload/v2/profile", "POST", payload);
    const updated = await this.profile();
    const updatedFeeds = Array.isArray(updated.feeds_data) ? updated.feeds_data : [];
    if (!updatedFeeds.some((feed) => feed && typeof feed === "object" && (feed as Record<string, unknown>).feed_url === feedUrl)) {
      throw new AvitoAutoloadError("Авито принял запрос, но XML-ссылка ещё не появилась в профиле. Проверьте настройки подключения", 502, "AVITO_FEED_NOT_CONNECTED");
    }
    return updated;
  }

  reports() { return this.call("/autoload/v4/uploads?perPage=10&page=1"); }

  async reportItems(reportId: string) {
    if (!/^\d+$/.test(reportId)) throw new AvitoAutoloadError("Авито вернул некорректный номер отчёта", 502);
    const checkCurrent = async () => {
      const current = await this.call("/autoload/v4/uploads/current");
      if (String(current.upload_id ?? "") !== reportId) throw new AvitoAutoloadError("Подробности этой загрузки пока недоступны. Повторите получение отчёта позже", 409, "AVITO_REPORT_DETAILS_CHANGED");
    };
    // 'current' can refer to an older upload if the newest one failed before
    // processing any items. Never attach those old results to the latest one.
    await checkCurrent();
    const items: Record<string, unknown>[] = [];
    for (let page = 1; page <= 501; page++) {
      const data = await this.call(`/autoload/v4/uploads/current/items?page=${page}&perPage=100`);
      if (!Array.isArray(data.items)) throw new AvitoAutoloadError("В ответе Авито отсутствует список объявлений", 502, "AVITO_INVALID_REPORT");
      const batch = data.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
      items.push(...batch);
      if (items.length > 50_000) throw new AvitoAutoloadError("Отчёт Авито превышает 50 000 объявлений", 502, "AVITO_REPORT_TOO_LARGE");
      const meta = data.meta && typeof data.meta === "object" ? data.meta as Record<string, unknown> : {};
      const pages = Number(meta.pages);
      if (Number.isSafeInteger(pages) && pages > 0 ? page >= pages : batch.length < 100) {
        await checkCurrent();
        return items;
      }
    }
    throw new AvitoAutoloadError("Отчёт Авито превышает 50 000 объявлений", 502, "AVITO_REPORT_TOO_LARGE");
  }
}
