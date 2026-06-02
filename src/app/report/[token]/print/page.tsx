"use client";

import { useParams } from "next/navigation";
import { DiagnosticPublicReport } from "@/components/diagnostic/DiagnosticPublicReport";

export default function DiagnosticReportPrintPage() {
  const params = useParams<{ token: string }>();
  return <DiagnosticPublicReport token={params.token} />;
}
