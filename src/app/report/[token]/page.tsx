import type { Metadata } from "next";
import { headers } from "next/headers";
import { DiagnosticPublicReport } from "@/components/diagnostic/DiagnosticPublicReport";
import { getDiagnosticReportMeta } from "@/lib/diagnostic-report-meta";

type ReportPageProps = {
  params: Promise<{ token: string }>;
};

async function requestOrigin() {
  const envOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (envOrigin) return envOrigin.replace(/\/$/u, "");
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

export async function generateMetadata({ params }: ReportPageProps): Promise<Metadata> {
  const { token } = await params;
  const meta = await getDiagnosticReportMeta(token, await requestOrigin());
  if (!meta) {
    return {
      title: "Отчёт диагностики",
      description: "Публичный отчёт диагностики автомобиля.",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: meta.url },
    openGraph: {
      title: meta.title,
      description: meta.description,
      type: "website",
      url: meta.url,
      images: [{ url: meta.imageUrl, width: 1200, height: 630, alt: meta.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [meta.imageUrl],
    },
  };
}

export default async function DiagnosticReportPage({ params }: ReportPageProps) {
  const { token } = await params;
  return <DiagnosticPublicReport token={token} mode="online" />;
}
