import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";

type AttrMeta = { id: string; name: string; meta?: { href: string } };

/** GET — список доп. полей товара (для фильтров «OEM PARTS», «Наименование по Mann» и т.д.). */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  const res = await moyskladFetch<{ rows?: AttrMeta[] }>("/entity/product/metadata/attributes");
  if (!res.ok) {
    return NextResponse.json({ error: res.error, attributes: [] }, { status: 502 });
  }
  const rows = res.data.rows ?? [];
  const attributes = rows.map((a) => ({
    id: a.id,
    name: a.name ?? "",
    href: a.meta?.href ?? "",
  }));
  return NextResponse.json({ attributes });
}
