import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { canAccessCustomerAnalytics } from "@/lib/customer-analytics-access";
import { documentProfitCents } from "@/lib/customer-analytics";
import { calculateCustomerCohorts } from "@/lib/customer-cohorts";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import { readJournalContact } from "@/lib/booking/journal-contact";
import { prisma } from "@/lib/db";

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

async function readComparison(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true });
  if (!access.ok) return access.response;
  const { context } = access;
  if (!canAccessCustomerAnalytics(context.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const branches = context.branches.filter((branch) => branch.businessGroupId === context.businessGroupId);
  const allowed = branches.map((branch) => branch.id);
  const groupBranchCount = await prisma.branch.count({ where: { businessGroupId: context.businessGroupId } });
  const network = allowed.length >= 2 && allowed.length === groupBranchCount;
  if (request.method === "GET") return NextResponse.json({
    network, branches: branches.map(({ id, name }) => ({ id, name })),
  }, { headers: { "Cache-Control": "private, no-store" } });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  const scope = body?.scope || context.branchId || allowed[0];
  const firstBranch = body?.firstBranch || undefined;
  if (!(scope === "network" ? network : allowed.includes(scope)) || (firstBranch && !allowed.includes(firstBranch))) {
    return NextResponse.json({ error: "Нет доступа к этому охвату" }, { status: 403 });
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kaliningrad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const asOf = body?.asOf || today;
  const periods = body?.periods;
  if (!validDate(asOf) || asOf > today || !Array.isArray(periods) || periods.length < 2 || periods.length > 8 ||
      periods.some((p) => !validDate(p?.from) || !validDate(p?.to) || p.from > p.to || p.to > asOf)) {
    return NextResponse.json({ error: "Укажите от 2 до 8 корректных периодов до даты расчёта" }, { status: 400 });
  }
  const filters: string[] = Array.isArray(body.services)
    ? body.services.filter((value: unknown): value is string => typeof value === "string").slice(0, 100)
    : [];
  type Line = Parameters<typeof documentProfitCents>[0][number] & { serviceId: string | null; name: string };
  const rows = await prisma.$queryRaw<Array<{
    id: string; branch: string; card: string | null; phone: string | null; rawPhone: string | null;
    date: string; booking: string | null; bookingContact: string | null; retail: boolean; revenue: number; lines: Line[];
  }>>(Prisma.sql`
    SELECT d.id, d.branch_id AS branch, d.document_date AS date, d.sum_cents AS revenue,
      CASE WHEN c.category = 'INDIVIDUAL' AND c.company_type = 'individual' THEN c.id END AS card,
      c.normalized_phone AS phone, c.phone AS "rawPhone",
      COALESCE(c.id = 'system:anonymous-retail:' || d.branch_id OR lower(btrim(c.name)) = 'розничный покупатель', false) AS retail,
      COALESCE(k.id, CASE WHEN d.raw #>> '{appointmentShipmentLink,linkSource}' = 'manual'
        THEN 'manual:' || NULLIF(d.raw #>> '{appointmentShipmentLink,appointmentId}', '') END) AS booking,
      CASE WHEN k.client_id = c.id THEN k.internal_comment END AS "bookingContact",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'quantity', p.quantity::text, 'discount', p.discount::text, 'priceCentsPerUnit', p.price_cents_per_unit,
          'buyPriceCentsPerUnit', p.buy_price_cents_per_unit, 'assortmentType', p.assortment_type,
          'serviceId', CASE WHEN p.assortment_type = 'service' THEN COALESCE(p.product_id, p.name) END,
          'name', p.name
        ))
        FROM local_demand_positions p WHERE p.branch_id=d.branch_id AND p.demand_id=d.id
      ), '[]'::jsonb) AS lines
    FROM local_demands d
    LEFT JOIN local_counterparties c ON c.branch_id=d.branch_id AND c.id=d.counterparty_id
    LEFT JOIN bookings k ON k.branch_id=d.branch_id AND k.id=COALESCE(
      NULLIF(d.raw #>> '{sourceRecord,bookingId}', ''),
      NULLIF(d.raw #>> '{appointmentShipmentLink,appointmentId}', ''),
      NULLIF(d.raw #>> '{sourceRecord,id}', '')
    )
    WHERE d.branch_id IN (${Prisma.join(allowed)}) AND d.applicable AND d.document_date <= ${asOf}
  `);
  const settingsBranch = scope === "network" ? context.branchId ?? allowed[0] : scope;
  const settings = await prisma.customerAnalyticsSettings.findFirst({
    where: { branchId: settingsBranch, id: "default" }, select: { regularVisitThreshold: true },
  });
  const configured = Number(process.env.CUSTOMER_ANALYTICS_REGULAR_VISITS);
  const threshold = settings?.regularVisitThreshold ?? (Number.isInteger(configured) && configured > 0 ? configured : 3);
  const serviceOptions = new Map<string, string>();
  const starts = new Map<string, string>();
  const documents = rows.map(({ lines, rawPhone, bookingContact, ...row }) => {
    const previous = starts.get(row.branch);
    if (!previous || row.date < previous) starts.set(row.branch, row.date);
    for (const line of lines) if (line.serviceId) serviceOptions.set(line.serviceId, line.name);
    return {
      ...row, source: readJournalContact(bookingContact).source, phone: normalizePhoneKey(row.phone) ?? normalizePhoneKey(rawPhone),
      services: [...new Set(lines.flatMap((line) => line.serviceId ? [line.serviceId] : []))],
      profit: lines.length ? documentProfitCents(lines) : null,
    };
  });
  // Earliest stored document does not prove coverage since opening.
  const verifiedBranches = new Set((process.env.CUSTOMER_ANALYTICS_VERIFIED_HISTORY_BRANCHES ?? "").split(",").map((id) => id.trim()).filter(Boolean));
  const completeHistory = network && allowed.every((id) => verifiedBranches.has(id));
  const result = calculateCustomerCohorts({ documents, periods, asOf, scope, services: filters, threshold, completeHistory, firstBranch });
  return NextResponse.json({
    ...result, scope, asOf, threshold, network, completeHistory,
    branches: branches.map(({ id, name }) => ({ id, name, start: starts.get(id) ?? null })),
    services: [...serviceOptions].map(([id, name]) => ({ id, name })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export const GET = readComparison;
export const POST = readComparison;
