import { withAvitoPublicProfile, readAvitoValue, writeAvitoValue, avitoAudit, type AvitoSnapshot } from "@/lib/avito-autoload/storage";
import { prepareAvitoFeed } from "@/lib/avito-autoload/service";
import { avitoFeedBlocker } from "@/lib/avito-autoload/feed-state";
import type { AvitoFeedFormat } from "./types";
import { AvitoAutoloadError } from "@/lib/avito-autoload/schemas";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Avito-Feed-Policy": "skip-invalid" };

export async function serveAvitoFeed(token: string, format: AvitoFeedFormat, head = false) {
  const failure = (code: string, message: string, status = 503) => new Response(head ? null : `${code}\n${message}\n`, {
    status, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8", "X-Avito-Feed-Status": code, ...(status === 503 ? { "Retry-After": "300" } : {}) },
  });
  try {
    const result = await withAvitoPublicProfile(token, async (profile, scope) => {
      try {
        const snapshot = await readAvitoValue<AvitoSnapshot>(scope, "snapshot");
        const blocker = avitoFeedBlocker(profile.settings.enabled, Boolean(snapshot));
        if (blocker) throw new AvitoAutoloadError(blocker.message, 503, blocker.code);
        const feed = await prepareAvitoFeed(profile, scope, false, true);
        if (!head) {
          await writeAvitoValue(scope, "snapshot", feed.snapshot);
          await avitoAudit(scope, "feed_fetched", "ok", `Файл ${format.toUpperCase()} выдан по ссылке: ${feed.stats.included} объявлений; пропущено с ошибками: ${feed.stats.invalid}`, { stats: feed.stats, format });
        }
        return new Response(head ? null : feed[format], { headers: { ...headers, "Content-Type": `${format === "xml" ? "application/xml" : "text/csv"}; charset=utf-8`, "X-Avito-Feed-Format": format, "X-Avito-Feed-Status": "ready", "X-Avito-Skipped-Invalid": String(feed.stats.invalid), "X-Avito-Excluded-Packaging": String(feed.stats.excludedByPackaging ?? 0) } });
      } catch (error) {
        // Failed database reads or feed-wide validation must never become an
        // empty file. Individual listing errors are skipped in prepareAvitoFeed.
        const code = error instanceof AvitoAutoloadError ? error.code : "AVITO_FEED_UNAVAILABLE";
        const message = error instanceof AvitoAutoloadError ? error.message : "Не удалось сформировать файл. Повторите позже; если ошибка сохраняется, обратитесь к администратору платформы.";
        if (!head) await avitoAudit(scope, "feed_failed", "error", message, { errorCode: code }).catch(() => undefined);
        return failure(code, message);
      }
    });
    return result ?? failure("AVITO_FEED_NOT_FOUND", "Ссылка недействительна. Скопируйте текущую ссылку в настройках Авито в платформе.", 404);
  } catch { return failure("AVITO_FEED_UNAVAILABLE", "Файл временно недоступен. Повторите позже."); }
}
