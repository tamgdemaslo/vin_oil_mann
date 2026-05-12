import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";

/** ID доп. поля «Ячейка» у товара */
const CELL_ATTR_ID = "7ad15eda-204c-11f1-0a80-19f100217481";

type ProductAttr = { id?: string; value?: string | number };
type ProductRow = { id?: string; attributes?: ProductAttr[] };

function extractProductId(href: string): string | null {
  const s = (href ?? "").trim();
  if (!s) return null;
  const match = s.match(/\/entity\/product\/([a-f0-9-]+)/i);
  return match ? match[1] : null;
}

/** GET /api/moysklad/product-cells?hrefs=... — значения доп. поля «Ячейка» по href товаров. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  const hrefsParam = request.nextUrl.searchParams.get("hrefs") ?? "";
  const hrefs = hrefsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const uniqueHrefs = [...new Set(hrefs)];
  const cells: Record<string, number | string> = {};
  for (const href of uniqueHrefs) {
    const id = extractProductId(href);
    if (!id) {
      cells[href] = "";
      continue;
    }
    const res = await moyskladFetch<ProductRow>(`/entity/product/${id}`, { cache: "no-store" });
    if (!res.ok) {
      cells[href] = "";
      continue;
    }
    const a = res.data?.attributes?.find((x) => x.id === CELL_ATTR_ID);
    const val = a?.value;
    if (val != null && val !== "") {
      cells[href] = typeof val === "number" ? val : String(val).trim();
    } else {
      cells[href] = "";
    }
  }
  return NextResponse.json(cells);
}
