import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessClientCases } from "@/lib/crm-access";
import CrmPipelineClient from "./CrmPipelineClient";

export default async function CrmPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login?from=/crm");
  }
  if (!canAccessClientCases(session.user.role)) {
    redirect("/");
  }

  return <CrmPipelineClient userLogin={session.user.login} userName={session.user.name} />;
}
