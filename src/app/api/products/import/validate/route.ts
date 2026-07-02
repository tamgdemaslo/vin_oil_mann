import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateProductImportFile, type ProductImportOptions } from "@/lib/product-import-export";

function canManageProducts(role: string) {
  return role === "owner" || role === "admin";
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!canManageProducts(session.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
    const rawOptions = formData.get("options");
    const options = typeof rawOptions === "string" && rawOptions.trim()
      ? JSON.parse(rawOptions) as ProductImportOptions
      : undefined;
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await validateProductImportFile({
      fileName: file.name,
      contentType: file.type,
      buffer,
      options,
      userLogin: session.user.login,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
