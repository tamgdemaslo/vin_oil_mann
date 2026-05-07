import { NextRequest, NextResponse } from "next/server";
import type { VinDecodeResponse } from "@/types/oil";
import { partsCatalogsRequest } from "@/lib/parts-catalogs";

type CarInfoItem = {
  title?: string;
  make?: string;
  model?: string;
  year?: string;
  modelYear?: string;
  manufacturer?: string;
  vin?: string;
  [key: string]: unknown;
};

/** POST /api/vin/decode — расшифровка VIN (марка, модель, год, двигатель/рынок если есть). Источник: Parts Catalogs car/info. */
export async function POST(request: NextRequest) {
  try {
    const { vin } = await request.json();
    const cleanVin = (typeof vin === "string" ? vin : "").replace(/\s/g, "").toUpperCase().replace(/-/g, "");
    if (cleanVin.length < 8) {
      return NextResponse.json({ error: "Укажите корректный VIN (минимум 8 символов)" }, { status: 400 });
    }

    const { status, data: carData } = await partsCatalogsRequest("/car/info", { q: cleanVin });
    if (status !== 200 || !carData) {
      return NextResponse.json({
        make: undefined,
        model: undefined,
        year: undefined,
        raw: carData != null && typeof carData === "object" ? (carData as Record<string, unknown>) : undefined,
      } satisfies VinDecodeResponse);
    }

    const items = Array.isArray(carData) ? carData : [carData];
    const first = items[0] as CarInfoItem | undefined;
    if (!first) {
      return NextResponse.json({ make: undefined, model: undefined, year: undefined } satisfies VinDecodeResponse);
    }

    const make = (first.make ?? first.manufacturer ?? "").trim() || undefined;
    const model = (first.model ?? "").trim() || undefined;
    const year = (first.modelYear ?? first.year ?? "").trim() || undefined;
    const title = (first.title ?? "").trim();

    let engine: string | undefined;
    let trim: string | undefined;
    if (title && !model) {
      const parts = title.split(/\s+/);
      const yearMatch = parts.find((p) => /^\d{4}$/.test(p));
      const yearIdx = yearMatch ? parts.indexOf(yearMatch) : -1;
      if (yearIdx >= 0 && parts.length > yearIdx + 1) trim = parts.slice(yearIdx + 1).join(" ");
      if (parts.length >= 2) engine = parts.find((p) => /^[A-Z0-9]{2,5}$/i.test(p)) ?? parts[1];
    }

    const response: VinDecodeResponse = {
      make: make || (title ? title.split(/\s+/)[0] : undefined),
      model: model || (title ? title.split(/\s+/).slice(1).join(" ") : undefined),
      year,
      engine,
      trim,
      market: undefined,
      region: undefined,
      raw: first as Record<string, unknown>,
    };
    return NextResponse.json(response);
  } catch (e) {
    console.error("[vin/decode]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка декодирования VIN" }, { status: 500 });
  }
}
