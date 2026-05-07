import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { MOYSKLAD_BASE, getMoySkladHeaders } from "@/lib/moysklad";

type TemplateKey = "default" | "birka_own" | "birka_box" | "job_order";

function resolveTemplate(key: TemplateKey) {
  switch (key) {
    case "birka_own":
      return {
        href: process.env.MOYSKLAD_TEMPLATE_BIRKA_OWN_HREF,
        type: process.env.MOYSKLAD_TEMPLATE_BIRKA_OWN_TYPE || "customtemplate",
        ext: process.env.MOYSKLAD_TEMPLATE_BIRKA_OWN_EXTENSION || "pdf",
        label: "Бирка со своим",
      };
    case "birka_box":
      return {
        href: process.env.MOYSKLAD_TEMPLATE_BIRKA_BOX_HREF,
        type: process.env.MOYSKLAD_TEMPLATE_BIRKA_BOX_TYPE || "customtemplate",
        ext: process.env.MOYSKLAD_TEMPLATE_BIRKA_BOX_EXTENSION || "pdf",
        label: "Бирка коробка",
      };
    case "job_order":
      return {
        href: process.env.MOYSKLAD_TEMPLATE_JOB_ORDER_HREF,
        type: process.env.MOYSKLAD_TEMPLATE_JOB_ORDER_TYPE || "customtemplate",
        ext: process.env.MOYSKLAD_TEMPLATE_JOB_ORDER_EXTENSION || "pdf",
        label: "Заказ-наряд",
      };
    case "default":
    default:
      return {
        href: process.env.MOYSKLAD_DEMAND_TEMPLATE_HREF,
        type: process.env.MOYSKLAD_DEMAND_TEMPLATE_TYPE || "embeddedtemplate",
        ext: process.env.MOYSKLAD_DEMAND_TEMPLATE_EXTENSION || "pdf",
        label: "Шаблон по умолчанию",
      };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id не указан" }, { status: 400 });
  }

  const headers = getMoySkladHeaders();
  if (!headers) {
    return NextResponse.json(
      { error: "Не настроены MOYSKLAD_TOKEN или MOYSKLAD_LOGIN/MOYSKLAD_PASSWORD" },
      { status: 500 }
    );
  }

  let bodyJson: any = {};
  try {
    bodyJson = await request.json();
  } catch {
    bodyJson = {};
  }
  const templateKey: TemplateKey = (bodyJson.templateKey as TemplateKey) || "default";

  const cfg = resolveTemplate(templateKey);
  const templateHref = cfg.href;
  const templateType = cfg.type;
  const extension = cfg.ext;

  if (!templateHref) {
    return NextResponse.json(
      {
        error:
          `Не настроен шаблон печати (${cfg.label}). Укажите переменную окружения для этого шаблона в .env.local.`,
      },
      { status: 500 }
    );
  }

  const body = {
    template: {
      meta: {
        href: templateHref,
        type: templateType,
        mediaType: "application/json",
      },
    },
    extension,
  };

  try {
    const res = await fetch(
      `${MOYSKLAD_BASE}/entity/demand/${encodeURIComponent(id)}/export/`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "manual",
      }
    );

    const location = res.headers.get("Location") || null;

    if (res.status === 303 && location) {
      return NextResponse.json({ status: 303, location });
    }

    if (res.status === 202 && location) {
      // Сервер может вернуть URL статуса — всё равно отдаём его клиенту
      return NextResponse.json({ status: 202, location });
    }

    const text = await res.text().catch(() => "");
    return NextResponse.json(
      {
        error: `Ошибка печати МойСклад: ${res.status} ${res.statusText || ""} ${text}`,
      },
      { status: 502 }
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Ошибка запроса к МойСклад при печати документа",
      },
      { status: 502 }
    );
  }
}

