import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessCustomerAnalytics } from "@/lib/customer-analytics-access";
import { loadCustomerDemandHistory } from "@/lib/customer-analytics";

function parseServices(param: string | null): string[] {
  if (!param?.trim()) return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  if (!canAccessCustomerAnalytics(session.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const clientKey = sp.get("clientKey")?.trim() || "";
  const phone = sp.get("phone")?.trim() || "";
  if (!clientKey && !phone) {
    return NextResponse.json({ error: "Укажите клиента" }, { status: 400 });
  }

  const dateFrom = sp.get("dateFrom")?.trim() || null;
  const dateTo = sp.get("dateTo")?.trim() || null;
  const services = parseServices(sp.get("services"));

  const result = await loadCustomerDemandHistory({
    clientKey: clientKey || `phone:${phone}`,
    normalizedPhone: phone || null,
    dateFrom,
    dateTo,
    serviceIds: services,
  });

  return NextResponse.json(result);
}
