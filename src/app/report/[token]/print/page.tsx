"use client";

import { useParams, useSearchParams } from "next/navigation";
import { DiagnosticPublicReport } from "@/components/diagnostic/DiagnosticPublicReport";

export default function DiagnosticReportPrintPage() {
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get("autoprint") === "1";

  return <DiagnosticPublicReport token={params.token} mode="print" autoPrint={autoPrint} />;
}
