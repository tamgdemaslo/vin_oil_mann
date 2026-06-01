import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createLocalAdminProduct,
  listLocalAdminProducts,
} from "@/lib/local-inventory-admin";

function readFilterValues(request: NextRequest, key: string) {
  return request.nextUrl.searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const includeArchived = request.nextUrl.searchParams.get("archived") === "1";
  const sort = request.nextUrl.searchParams.get("sort") ?? "";
  const direction = request.nextUrl.searchParams.get("direction") ?? "";
  const brand = readFilterValues(request, "brand");
  const sae = readFilterValues(request, "sae");
  const supplier = readFilterValues(request, "supplier");
  const group = readFilterValues(request, "group");
  const entityType = readFilterValues(request, "entityType");
  const apiSpec = readFilterValues(request, "apiSpec");
  const acea = readFilterValues(request, "acea");
  const packageVolume = readFilterValues(request, "packageVolume");
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
