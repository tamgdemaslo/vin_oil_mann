import { withAvitoPublicProfile, readAvitoValue, writeAvitoValue, avitoAudit, type AvitoSnapshot } from "@/lib/avito-autoload/storage";
import { prepareAvitoFeed } from "@/lib/avito-autoload/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const result = await withAvitoPublicProfile(token, async (profile, scope) => {
      const snapshot = await readAvitoValue<AvitoSnapshot>(scope, "snapshot");
      if (!profile.settings.enabled || !snapshot) return new Response("Feed is paused or has not been reviewed", { status: 503, headers: { ...headers, "Retry-After": "300" } });
      try {
        const feed = await prepareAvitoFeed(profile, scope, false, true);
        await writeAvitoValue(scope, "snapshot", feed.snapshot);
        await avitoAudit(scope, "feed_fetched", "ok", `Авито получил файл: ${feed.stats.included} объявлений`, { stats: feed.stats });
        return new Response(feed.csv, { headers });
      } catch {
        // Never turn failed validation, database reads or an incomplete selection
        // into an empty file that would withdraw existing ads.
        await avitoAudit(scope, "feed_failed", "error", "Автовыгрузка остановлена: файл не прошёл проверку").catch(() => undefined);
        return new Response("Feed temporarily unavailable", { status: 503, headers: { ...headers, "Retry-After": "300" } });
      }
    });
    return result ?? new Response("Not found", { status: 404, headers });
  } catch { return new Response("Feed temporarily unavailable", { status: 503, headers: { ...headers, "Retry-After": "300" } }); }
}

export async function HEAD(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const result = await withAvitoPublicProfile(token, async (profile, scope) => {
      const snapshot = await readAvitoValue<AvitoSnapshot>(scope, "snapshot");
      return new Response(null, { status: profile.settings.enabled && snapshot ? 200 : 503, headers });
    });
    return result ?? new Response(null, { status: 404, headers });
  } catch { return new Response(null, { status: 503, headers }); }
}
