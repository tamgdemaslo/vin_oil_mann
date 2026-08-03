import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import { canManageOrganizations } from "@/lib/organizations";
import OrganizationsClient from "./OrganizationsClient";

export default async function OrganizationsPage() {
  const session = await requireAuthenticatedSession("/cabinet/organizations");
  if (!(await canManageOrganizations(session.user))) redirect("/cabinet");

  return <OrganizationsClient />;
}
