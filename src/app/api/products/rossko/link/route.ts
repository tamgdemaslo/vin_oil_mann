import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { rosskoConfig, rosskoSearch } from "@/lib/rossko";
import { rosskoIntegrationError } from "@/lib/rossko-integration";
import { parseRosskoProductLink, rosskoProductFromSearch } from "@/lib/rossko-product-link";
import { buildRosskoProductName, recommendedRosskoRetailCents, suggestRosskoProductGroup } from "@/lib/rossko-product-import";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  let guid: string;
  try { guid = parseRosskoProductLink((await request.json())?.url); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Проверьте ссылку" }, { status: 400 }); }

  try {
    return await runWithBranchApiContext(branch.context, async () => {
      const cfg = await rosskoConfig();
      if (!cfg.deliveryId?.trim()) return NextResponse.json({ error: "Выберите способ доставки в настройках ROSSKO" }, { status: 409 });
      const data = await rosskoSearch(cfg, { text: guid, deliveryId: cfg.deliveryId, addressId: cfg.addressId });
      let product: ReturnType<typeof rosskoProductFromSearch>;
      try { product = rosskoProductFromSearch(data, guid); }
      catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 422 }); }
      const products = await prisma.localProduct.findMany({
        where: { branchId: branch.context.branchId!, archived: false, entityType: "product", groupPath: { not: null } },
        select: { id: true, name: true, brand: true, article: true, groupPath: true },
        take: 20_000,
      });
      const salePrice = recommendedRosskoRetailCents(product.purchasePriceCents);
      return NextResponse.json({
        fields: {
          name: buildRosskoProductName(product), brand: product.brand, article: product.article,
          groupPath: suggestRosskoProductGroup(products, product.sourceName),
          rosskoPartNumber: product.article, rosskoBrand: product.brand,
          buyPrice: product.purchasePriceCents == null ? "" : String(product.purchasePriceCents / 100),
          salePrice: salePrice == null ? "" : String(salePrice / 100), uomName: "шт",
        },
        message: "Карточка заполнена. Проверьте категорию и цены перед сохранением. OEM, штрихкоды, фото и характеристики API ROSSKO не передаёт — заполните их отдельно." +
          (product.purchasePriceCents == null ? " Доступная закупочная цена не найдена." : " Розничная цена рассчитана по правилам импорта ROSSKO."),
      });
    });
  } catch (error) {
    const safe = rosskoIntegrationError(error);
    return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
  }
}
