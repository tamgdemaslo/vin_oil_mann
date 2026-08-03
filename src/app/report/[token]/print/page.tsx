import { headers } from "next/headers";
import { DiagnosticPublicReport } from "@/components/diagnostic/DiagnosticPublicReport";
import { getDiagnosticMapByToken } from "@/lib/diagnostic-map-service";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function requestOriginFromHeaders(): Promise<string> {
  const envOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (envOrigin) return envOrigin.replace(/\/$/, "");

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

export default async function DiagnosticReportPrintPage({ params, searchParams }: PageProps) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const autoPrint = firstSearchParam(sp.autoprint) === "1";
  const diagnostic = await getDiagnosticMapByToken(token, await requestOriginFromHeaders());

  return (
    <DiagnosticPublicReport
      token={token}
      mode="print"
      autoPrint={autoPrint}
      initialPayload={diagnostic}
      initialError={diagnostic ? null : "Отчёт не найден"}
    />
  );
}
