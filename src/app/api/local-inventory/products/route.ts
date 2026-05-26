import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createLocalAdminProduct,
  listLocalAdminProducts,
} from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const includeArchived = request.nextUrl.searchParams.get("archived") === "1";
  const sort = request.nextUrl.searchParams.get("sort") ?? "";
  const direction = request.nextUrl.searchParams.get("direction") ?? "";
  const brand = request.nextUrl.searchParams.get("brand") ?? "";
  const sae = request.nextUrl.searchParams.get("sae") ?? "";
  const supplier = request.nextUrl.searchParams.get("supplier") ?? "";
  const group = request.nextUrl.searchParams.get("group") ?? "";
  const entityType = request.nextUrl.searchParams.get("entityType") ?? "";
  const apiSpec = request.nextUrl.searchParams.get("apiSpec") ?? "";
  const acea = request.nextUrl.searchParams.get("acea") ?? "";
  const packageVolume = request.nextUrl.searchParams.get("packageVolume") ?? "";
  const stock = request.nextUrl.searchParams.get("stock") ?? "";

  return NextResponse.json(await listLocalAdminProducts({
    search,
    limit,
    offset,
    includeArchived,
    sort,
    direction,
    brand,
    sae,
    supplier,
    group,
    entityType,
    apiSpec,
    acea,
    packageVolume,
    stock,
  }));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await createLocalAdminProduct(body as Parameters<typeof createLocalAdminProduct>[0]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.product);
}
