import { serveAvitoFeed } from "@/lib/avito-autoload/public-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Existing Avito profiles may retain this address without allowing API updates.
// Serve XML directly: the provider already parses this legacy URL as XML, and
// relying on a redirect would require the downloader to follow it.
async function legacyFeed(token: string, head = false) {
  const response = await serveAvitoFeed(token, "xml", head);
  response.headers.set("X-Avito-Feed-Alias", "feed.csv");
  return response;
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  return legacyFeed((await params).token);
}

export async function HEAD(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  return legacyFeed((await params).token, true);
}
