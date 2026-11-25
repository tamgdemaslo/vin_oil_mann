import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ANONYMOUS_RETAIL_COUNTERPARTY_NAME, isAnonymousRetailCounterpartyId } from "@/lib/anonymous-retail-counterparty";
import { normalizePhoneKey } from "@/lib/phone-normalize";

export type ServiceHistoryItem = {
  id: string;
  date: string;
  branch: string;
  posted: boolean;
  mileage: string | null;
  services: string[];
  positions: { id: string; name: string; quantity: string; service: boolean }[];
  href: string | null;
};

export type ServiceHistoryPage = {
  items: ServiceHistoryItem[];
  nextCursor: string | null;
};

const PAGE_SIZE = 15;
const EMPTY_PAGE: ServiceHistoryPage = { items: [], nextCursor: null };

export function parseServiceHistoryCursor(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2}):([^:]{1,200})$/.exec(value);
  return match ? { date: match[1], id: match[2] } : null;
}

export async function loadCustomerServiceHistory(input: {
  cardId: string;
  branchId: string;
  businessGroupId: string;
  canOpenActiveBranchDocuments: boolean;
  recentOnly?: boolean;
  cursor: ReturnType<typeof parseServiceHistoryCursor>;
}): Promise<ServiceHistoryPage | null> {
  const { cardId, branchId, businessGroupId, cursor } = input;
  const pageSize = input.recentOnly ? 3 : PAGE_SIZE;
  const card = await prisma.localCounterparty.findFirst({
    where: { id: cardId, branchId },
    select: { id: true, category: true, companyType: true, name: true, normalizedPhone: true, phone: true },
  });
  if (!card) return null;
  const retailName = ANONYMOUS_RETAIL_COUNTERPARTY_NAME.toLowerCase();
  if (card.category !== "INDIVIDUAL" || card.companyType !== "individual"
      || isAnonymousRetailCounterpartyId(card.id, branchId) || card.name.trim().toLowerCase() === retailName) {
    return EMPTY_PAGE;
  }

  const phone = normalizePhoneKey(card.normalizedPhone) ?? normalizePhoneKey(card.phone);
  const phoneKeys = phone && /^7\d{10}$/.test(phone) ? [phone, `8${phone.slice(1)}`] : phone ? [phone] : [];

  // Cross-branch access is limited to this projection. The signed active branch
  // authorizes the seed card, and the server's group ID scopes every matched card.
  const rows = await prisma.$queryRaw<Array<Omit<ServiceHistoryItem, "href" | "services"> & { branchId: string }>>(Prisma.sql`
    WITH matched_cards AS (
      SELECT ${cardId}::text AS id, ${branchId}::text AS branch_id
      ${phoneKeys.length ? Prisma.sql`
        UNION
        SELECT c.id, c.branch_id
        FROM local_counterparties c
        JOIN branches b ON b.id = c.branch_id AND b.business_group_id = ${businessGroupId}
        WHERE c.normalized_phone IN (${Prisma.join(phoneKeys)})
          AND c.category = 'INDIVIDUAL' AND c.company_type = 'individual'
          AND c.id <> 'system:anonymous-retail:' || c.branch_id
          AND lower(btrim(c.name)) <> ${retailName}
      ` : Prisma.empty}
    ),
    page AS (
      SELECT d.id, d.branch_id, d.document_date, d.applicable, d.attributes
      FROM matched_cards c
      JOIN local_demands d ON d.counterparty_id = c.id AND d.branch_id = c.branch_id
      WHERE (${!input.recentOnly} OR d.applicable)
      ${cursor ? Prisma.sql`AND (d.document_date, d.id) < (${cursor.date}, ${cursor.id})` : Prisma.empty}
      ORDER BY d.document_date DESC, d.id DESC
      LIMIT ${input.recentOnly ? pageSize : pageSize + 1}
    )
    SELECT d.id, d.branch_id AS "branchId", d.document_date AS date,
           COALESCE(NULLIF(b.short_name, ''), b.name) AS branch, d.applicable AS posted,
           (SELECT attr->>'value'
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.attributes) = 'array'
              THEN d.attributes ELSE '[]'::jsonb END) attr
            WHERE lower(btrim(attr->>'name')) = 'пробег'
              AND jsonb_typeof(attr->'value') IN ('number', 'string')
            LIMIT 1) AS mileage,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'quantity', p.quantity::text,
               'service', COALESCE(p.assortment_type = 'service' OR p.raw->>'lineKind' = 'one_off_service', false)
             ) ORDER BY p.id)
             FROM local_demand_positions p
             WHERE p.demand_id = d.id AND p.branch_id = d.branch_id
           ), '[]'::jsonb) AS positions
    FROM page d
    JOIN branches b ON b.id = d.branch_id AND b.business_group_id = ${businessGroupId}
    ORDER BY d.document_date DESC, d.id DESC
  `);
  const items = rows.slice(0, pageSize).map(({ branchId: documentBranch, ...row }) => ({
    ...row,
    services: [...new Set(row.positions.filter((position) => position.service && position.name.trim()).map((position) => position.name))],
    href: documentBranch === branchId && input.canOpenActiveBranchDocuments
      ? `/shipment/${encodeURIComponent(row.id)}${row.posted ? "" : "/edit"}`
      : null,
  }));
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rows.length > pageSize && last ? `${last.date}:${last.id}` : null,
  };
}
