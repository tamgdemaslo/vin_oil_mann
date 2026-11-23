import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import { readableBranchIds, requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { loyaltyJson } from "@/lib/loyalty/http";

export async function GET(request: Request) {
  const access = await requireBranchApi({ allowAll: true });
  if (!access.ok) return access.response;
  if (!(await canViewWarehouseAnalytics(access.context.user))) return loyaltyJson({ error: "Недостаточно прав" }, 403);
  const ids = readableBranchIds(access.context);
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!date.test(from) || !date.test(to) || from > to || !ids.length) return loyaltyJson({ error: "Проверьте период и филиал" }, 400);
  const storeId = params.get("store") || null;
  return runWithBranchApiContext(access.context, async () => {
    const [schema] = await prisma.$queryRaw<Array<{ ready: boolean }>>`SELECT to_regclass('loyalty_sales') IS NOT NULL AS ready`;
    const branchCondition = Prisma.sql`d.branch_id IN (${Prisma.join(ids)}) AND (${storeId}::text IS NULL OR d.store_id = ${storeId})`;
    const [row] = schema?.ready
      ? await prisma.$queryRaw<Array<{ before: bigint; cash: bigint; spent: bigint; spentCents: bigint; earned: bigint }>>`
        WITH totals AS (
          SELECT d.sum_cents + COALESCE(s.before_cents - s.cash_cents, 0) AS before,
            d.sum_cents AS cash, COALESCE(s.spent, 0) AS spent,
            COALESCE(s.before_cents - s.cash_cents, 0) AS spend_cents, COALESCE(s.earned, 0) AS earned
          FROM local_demands d
          LEFT JOIN loyalty_sales s ON s.shipment_id = d.id AND s.branch_id = d.branch_id
            AND s.business_group_id = ${access.context.businessGroupId} AND s.voided_at IS NULL
          WHERE ${branchCondition} AND d.applicable AND d.document_date BETWEEN ${from} AND ${to}
          UNION ALL
          SELECT -r.before_cents, -r.cash_cents, -r.restored, -(r.before_cents - r.cash_cents), -r.earned_reversed
          FROM loyalty_returns r
          JOIN loyalty_sales s ON s.id = r.sale_id AND s.branch_id = r.branch_id
          JOIN local_demands d ON d.id = s.shipment_id AND d.branch_id = s.branch_id
          WHERE ${branchCondition} AND s.business_group_id = ${access.context.businessGroupId}
            AND r.document_date BETWEEN ${from} AND ${to} AND s.voided_at IS NULL
        )
        SELECT COALESCE(SUM(before), 0)::bigint AS before, COALESCE(SUM(cash), 0)::bigint AS cash,
          COALESCE(SUM(spent), 0)::bigint AS spent, COALESCE(SUM(spend_cents), 0)::bigint AS "spentCents",
          COALESCE(SUM(earned), 0)::bigint AS earned FROM totals`
      : await prisma.$queryRaw<Array<{ before: bigint; cash: bigint; spent: bigint; spentCents: bigint; earned: bigint }>>`
        SELECT COALESCE(SUM(sum_cents), 0)::bigint AS before, COALESCE(SUM(sum_cents), 0)::bigint AS cash,
          0::bigint AS spent, 0::bigint AS "spentCents", 0::bigint AS earned
        FROM local_demands d WHERE ${branchCondition} AND d.applicable AND d.document_date BETWEEN ${from} AND ${to}`;
    return loyaltyJson(Object.fromEntries(Object.entries(row).map(([key, val]) => [key, Number(val)])));
  });
}
