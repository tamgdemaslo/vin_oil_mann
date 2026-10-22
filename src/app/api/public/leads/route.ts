import { caseDayDeadline } from "@/lib/client-case-simple";
import { NextRequest } from "next/server";
import { resolvePublicStorefront } from "@/lib/public-storefront";
import { getFirstCrmStage } from "@/lib/crm";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import {
  checkPublicRateLimit,
  getPublicLeadLimitPerHour,
  hasLeadHoneypot,
  publicJson,
  publicOptions,
  rateLimitHeaders,
  rejectDisallowedPublicOrigin,
} from "@/lib/public-api";
import { normalizePublicVin } from "@/lib/public-oil";

type LeadBody = {
  intent?: unknown;
  name?: unknown;
  phone?: unknown;
  vin?: unknown;
  vehicle?: unknown;
  service?: unknown;
  preferredAt?: unknown;
  comment?: unknown;
  sourcePage?: unknown;
  utm?: unknown;
};

function text(value: unknown, maxLength = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function parseDate(value: unknown): { date: Date | null; error?: string } {
  const raw = text(value, 80);
  if (!raw) return { date: null };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { date: null, error: "Некорректное желаемое время записи" };
  return { date };
}

function compactJson(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim().slice(0, 1000) || null;
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return null;
  }
}

function buildLeadNotes(params: {
  name: string | null;
  phone: string;
  vin: string | null;
  vehicle: string | null;
  service: string | null;
  preferredAt: string | null;
  comment: string | null;
  sourcePage: string | null;
  utm: string | null;
}): string {
  return [
    "Источник: клиентский сайт",
    params.name ? `Имя: ${params.name}` : null,
    `Телефон: ${params.phone}`,
    params.vin ? `VIN: ${params.vin}` : null,
    params.vehicle ? `Авто: ${params.vehicle}` : null,
    params.service ? `Услуга: ${params.service}` : null,
    params.preferredAt ? `Желаемое время: ${params.preferredAt}` : null,
    params.sourcePage ? `Страница: ${params.sourcePage}` : null,
    params.utm ? `UTM: ${params.utm}` : null,
    params.comment ? `Комментарий: ${params.comment}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}

export async function POST(request: NextRequest) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;

  const rate = checkPublicRateLimit(request, "lead", getPublicLeadLimitPerHour());
  if (!rate.ok) {
    return publicJson(
      request,
      { error: "Слишком много заявок. Попробуйте позже." },
      { status: 429, headers: rateLimitHeaders(rate) }
    );
  }

  try {
    const body = (await request.json().catch(() => null)) as LeadBody | null;
    if (!body || typeof body !== "object") {
      return publicJson(request, { error: "Неверное тело запроса" }, { status: 400, headers: rateLimitHeaders(rate) });
    }

    if (hasLeadHoneypot(body)) {
      return publicJson(request, { ok: true }, { status: 202, headers: rateLimitHeaders(rate) });
    }

    const transmissionQuote = body.intent === "transmission_oil_quote";
    const name = text(body.name, 120);
    const phone = text(body.phone, 80);
    const phoneNormalized = normalizePhoneKey(phone);
    const vin = normalizePublicVin(body.vin) || null;
    const vehicle = text(body.vehicle, 200);
    const service = transmissionQuote ? "Расчёт стоимости замены масла в АКПП" : text(body.service, 200);
    const comment = text(body.comment, 1500);
    const sourcePage = text(body.sourcePage, 500);
    const utm = compactJson(body.utm);
    const preferredRaw = text(body.preferredAt, 80);
    const preferred = parseDate(body.preferredAt);

    if (!phone || !phoneNormalized) {
      return publicJson(request, { error: "Укажите корректный телефон" }, { status: 400, headers: rateLimitHeaders(rate) });
    }
    if (transmissionQuote && (!name || name.length < 2 || !vehicle)) {
      return publicJson(request, { error: "Укажите имя и автомобиль для расчёта" }, { status: 400, headers: rateLimitHeaders(rate) });
    }
    if (transmissionQuote && body.vin && (typeof body.vin !== "string" || !/^[A-HJ-NPR-Z0-9]{17}$/i.test(body.vin.trim()))) {
      return publicJson(request, { error: "VIN должен содержать 17 латинских букв и цифр без I, O и Q" }, { status: 400, headers: rateLimitHeaders(rate) });
    }
    if (!name && !vin && !comment && !service) {
      return publicJson(
        request,
        { error: "Укажите имя, VIN, услугу или комментарий к заявке" },
        { status: 400, headers: rateLimitHeaders(rate) }
      );
    }
    if (preferred.error) {
      return publicJson(request, { error: preferred.error }, { status: 400, headers: rateLimitHeaders(rate) });
    }

    const storefront = await resolvePublicStorefront();
    const configuredBranchId = process.env.PUBLIC_LEAD_BRANCH_ID?.trim();
    const leadBranch = configuredBranchId
      ? storefront.branches.find(branch => branch.branchId === configuredBranchId)
      : storefront.branches[0];
    if (!leadBranch) {
      return publicJson(request, { error: "Филиал для заявок не настроен" }, { status: 503, headers: rateLimitHeaders(rate) });
    }
    const firstStage = await getFirstCrmStage(leadBranch.branchId);
    if (!firstStage) {
      return publicJson(request, { error: "Не найдены стадии CRM" }, { status: 500, headers: rateLimitHeaders(rate) });
    }

    const responsibleLogin = process.env.PUBLIC_LEAD_RESPONSIBLE_LOGIN?.trim() || null;
    const createdByLogin = "client-site";
    const notes = buildLeadNotes({
      name,
      phone,
      vin,
      vehicle,
      service,
      preferredAt: preferredRaw,
      comment,
      sourcePage,
      utm,
    });

    const calculationDue = caseDayDeadline();
    const created = await prisma.crmDeal.create({
      data: {
        branchId: leadBranch.branchId,
        caseType: transmissionQuote ? "calculation" : "manual",
        caseStatus: "calculation_needed",
        title: transmissionQuote ? "Расчёт замены масла в АКПП" : service ?? comment?.slice(0, 160) ?? "Заявка с сайта",
        customerName: name,
        phoneNormalized,
        vehicle: vehicle ?? (vin ? `VIN ${vin}` : null),
        source: "client-site",
        clientType: "new_lead",
        nextAction: "Рассчитать стоимость и связаться с клиентом",
        stageId: firstStage.id,
        responsibleLogin,
        nextActionAt: calculationDue,
        nextContactAt: calculationDue,
        notes,
        createdByLogin,
      },
    });

    return publicJson(
      request,
      {
        ok: true,
        lead: {
          id: created.id,
          stageId: created.stageId,
          status: created.status,
        },
      },
      { status: 201, headers: rateLimitHeaders(rate) }
    );
  } catch (error) {
    console.error("[public/leads]", error);
    return publicJson(request, { error: "Не удалось создать заявку" }, { status: 500, headers: rateLimitHeaders(rate) });
  }
}
