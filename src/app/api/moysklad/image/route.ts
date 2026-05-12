import { NextRequest, NextResponse } from "next/server";
import { getMoySkladAuthHeader, MOYSKLAD_BASE } from "@/lib/moysklad";

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get("href")?.trim();
  if (!href) {
    return NextResponse.json({ error: "Не передан href изображения" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return NextResponse.json({ error: "Некорректный href изображения" }, { status: 400 });
  }

  const allowedHosts = new Set([
    new URL(MOYSKLAD_BASE).host,
    "tinyimage-prod.moysklad.ru",
    "image.moysklad.ru",
  ]);

  if (!allowedHosts.has(url.host)) {
    return NextResponse.json({ error: "Недопустимый источник изображения" }, { status: 400 });
  }

  const auth = getMoySkladAuthHeader();
  if (!auth) {
    return NextResponse.json({ error: "Не заданы данные МойСклад" }, { status: 500 });
  }

  try {
    const res = await fetch(href, {
      headers: {
        Authorization: auth,
        Accept: "*/*",
        "Accept-Encoding": "gzip",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Не удалось загрузить изображение" }, { status: res.status });
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка загрузки изображения" },
      { status: 500 }
    );
  }
}
