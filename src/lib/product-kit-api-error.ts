import { NextResponse } from "next/server";
import { KitError } from "@/lib/product-kits";

export function kitErrorResponse(error: unknown) {
  if (error instanceof KitError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  console.error("[product-kits]", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "Не удалось загрузить или сохранить комплекты. Повторите попытку" }, { status: 500 });
}
