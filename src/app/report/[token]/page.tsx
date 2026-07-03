"use client";

import { useParams } from "next/navigation";
import { DiagnosticPublicReport } from "@/components/diagnostic/DiagnosticPublicReport";

export default function DiagnosticReportPage() {
  const params = useParams<{ token: string }>();
  return <DiagnosticPublicReport token={params.token} mode="online" />;
}
