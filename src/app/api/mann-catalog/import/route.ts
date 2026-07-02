import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dryRunMannImport, getMannCatalogStats, importMannCatalog } from "@/lib/mann-catalog";

async function readUploadText(form: FormData, key: string): Promise<{ name: string; text: string } | null> {
  const value = form.get(key);
  if (!(value instanceof File)) return null;
  return { name: value.name, text: await value.text() };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  return NextResponse.json(await getMannCatalogStats());
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав для импорта MANN PDF" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Передайте CSV-файлы через multipart/form-data" }, { status: 400 });
  const applications = await readUploadText(form, "applications");
  const filters = await readUploadText(form, "filters");
  const summary = await readUploadText(form, "summary");
  if (!applications || !filters) {
    return NextResponse.json({ error: "Нужны файлы applications и filters" }, { status: 400 });
  }

  const payload = {
    applicationsCsv: applications.text,
    applicationsFileName: applications.name,
    filtersCsv: filters.text,
    filtersFileName: filters.name,
    summaryJson: summary?.text ?? null,
    importedById: session.user.login,
    dryRun: form.get("dryRun") === "1" || form.get("dryRun") === "true",
  };

  const result = payload.dryRun ? await dryRunMannImport(payload) : await importMannCatalog(payload);
  return NextResponse.json({ ok: true, result });
}
