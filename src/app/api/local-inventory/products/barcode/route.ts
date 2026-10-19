import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { getLocalAdminProduct } from "@/lib/local-inventory-admin";
import { normalizeBindableBarcode, productBarcodeWhere } from "@/lib/product-barcode-binding";
import { bindReceiptProductBarcode } from "@/lib/receipt-product-barcode";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  let barcode: string;
  try { barcode = normalizeBindableBarcode(request.nextUrl.searchParams.get("barcode")); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  return runWithBranchApiContext(branch.context, async () => {
    const products = await prisma.localProduct.findMany({
      where: { branchId: branch.context.branchId!, archived: false, entityType: { not: "service" }, ...productBarcodeWhere(barcode) },
      select: { id: true, name: true }, take: 10,
    });
    if (!products.length) return NextResponse.json({ status: "NOT_FOUND", barcode });
    if (products.length > 1) return NextResponse.json({ status: "CONFLICT", products });
    const product = await getLocalAdminProduct(products[0].id, branch.context.branchId!);
    if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    return NextResponse.json({ status: "FOUND", product });
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Выберите товар и штрихкод" }, { status: 400 });
  return runWithBranchApiContext(branch.context, async () => {
    const result = await bindReceiptProductBarcode(branch.context, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    const product = await getLocalAdminProduct(result.productId, branch.context.branchId!);
    if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    return NextResponse.json({ product, alreadyLinked: result.alreadyLinked });
  });
}
