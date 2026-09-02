import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { listActiveSuppliers } from "@/lib/local-inventory-admin";
import {
  NONSTOCK_PRODUCT_GROUPS,
  NONSTOCK_PRODUCT_UOMS,
  normalizeNonstockProductBrand,
  normalizeNonstockProductArticle,
} from "@/lib/one-off-product";
import { sameExactProductIdentity } from "@/lib/product-identity";

function decimalToNumber(value: unknown): number {
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  return runWithBranchApiContext(branchAccess.context, async () => {
    const branchId = branchAccess.context.branchId!;
    const brandInput = request.nextUrl.searchParams.get("brand")?.trim() ?? "";
    const articleInput = request.nextUrl.searchParams.get("article")?.trim() ?? "";
    const storeId = request.nextUrl.searchParams.get("storeId")?.trim() ?? "";
    const [products, suppliers, store] = await Promise.all([
      prisma.localProduct.findMany({
        where: { branchId, archived: false },
        select: {
          id: true,
          name: true,
          entityType: true,
          brand: true,
          article: true,
          code: true,
          salePriceCents: true,
          cell: true,
          stockBalances: {
            where: storeId ? { storeId } : undefined,
            select: { storeId: true, quantity: true, reserve: true, available: true, slotName: true },
            take: storeId ? 1 : 20,
          },
        },
      }),
      listActiveSuppliers({ branchId, limit: 100 }),
      storeId ? prisma.localStore.findFirst({ where: { id: storeId, branchId }, select: { id: true } }) : Promise.resolve(null),
    ]);

    if (storeId && !store) return NextResponse.json({ error: "Склад не относится к текущему филиалу" }, { status: 400 });

    const brandOptions = [...new Set(products
      .map((product) => normalizeNonstockProductBrand(product.brand).display)
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ru"));
    const normalizedBrand = normalizeNonstockProductBrand(brandInput);
    const normalizedArticle = normalizeNonstockProductArticle(articleInput);
    const exactProduct = normalizedBrand.identity && normalizedArticle.canonical
      ? products.find((product) => sameExactProductIdentity(
          { brand: normalizedBrand.display, article: normalizedArticle.display },
          { brand: product.brand, article: product.article || product.code },
        ))
      : null;
    const balance = exactProduct
      ? exactProduct.stockBalances.find((item) => !storeId || item.storeId === storeId) ?? exactProduct.stockBalances[0]
      : null;

    return NextResponse.json({
      groups: NONSTOCK_PRODUCT_GROUPS,
      uoms: NONSTOCK_PRODUCT_UOMS,
      brands: brandOptions,
      suppliers: suppliers.suppliers.map((supplier) => ({ id: supplier.id, name: supplier.displayName })),
      normalized: {
        brand: normalizedBrand.display,
        article: normalizedArticle.display,
        articleCanonical: normalizedArticle.canonical,
      },
      exactMatch: exactProduct
        ? {
            id: exactProduct.id,
            name: exactProduct.name,
            brand: exactProduct.brand ?? "",
            article: exactProduct.article ?? exactProduct.code ?? "",
            price: exactProduct.salePriceCents / 100,
            currency: "RUB",
            meta: {
              href: `local://${exactProduct.entityType || "product"}/${exactProduct.id}`,
              type: exactProduct.entityType || "product",
              mediaType: "application/json",
            },
            cell: balance?.slotName ?? exactProduct.cell ?? undefined,
            slotName: balance?.slotName ?? exactProduct.cell ?? undefined,
            stockQuantity: decimalToNumber(balance?.quantity),
            reserveQuantity: decimalToNumber(balance?.reserve),
            availableQuantity: decimalToNumber(balance?.available),
          }
        : null,
    });
  });
}
