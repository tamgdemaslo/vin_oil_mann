import { serveAvitoFeed } from "@/lib/avito-autoload/public-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  return serveAvitoFeed((await params).token, "xml");
}

export async function HEAD(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  return serveAvitoFeed((await params).token, "xml", true);
}
