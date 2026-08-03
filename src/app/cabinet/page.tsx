import { requireAuthenticatedSession } from "@/lib/app-access";
import { canManageOrganizations } from "@/lib/organizations";
import CabinetDashboard from "./CabinetDashboard";

export default async function CabinetPage() {
  const session = await requireAuthenticatedSession("/cabinet");
  const canManageOrganizationsSection = await canManageOrganizations(session.user);

  return <CabinetDashboard role={session.user.role} canManageOrganizations={canManageOrganizationsSection} />;
}
