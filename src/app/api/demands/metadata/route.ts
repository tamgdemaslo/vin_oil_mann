import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";

type Meta = { href: string; type: string; mediaType: string };
type AttributeMeta = { id: string; name: string; type: string; meta: Meta };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const metaRes = await moyskladFetch<{ rows?: AttributeMeta[] } | AttributeMeta[]>(
    "/entity/demand/metadata/attributes",
    { cache: "no-store" }
  );
  if (!metaRes.ok) return NextResponse.json({ error: metaRes.error }, { status: 502 });

  const d: unknown = metaRes.data;
  let metaAttributes: AttributeMeta[] = [];
  if (Array.isArray(d)) {
    metaAttributes = d as AttributeMeta[];
  } else if (d && typeof d === "object" && Array.isArray((d as { rows?: AttributeMeta[] }).rows)) {
    metaAttributes = (d as { rows: AttributeMeta[] }).rows;
  }

  const attributes = metaAttributes.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    meta: m.meta,
    value: null as string | null,
  }));

  return NextResponse.json({ attributes });
}
