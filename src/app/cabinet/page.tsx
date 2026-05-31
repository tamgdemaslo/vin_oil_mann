import { requireAuthenticatedSession } from "@/lib/app-access";
import CabinetDashboard from "./CabinetDashboard";

export default async function CabinetPage() {
  const session = await requireAuthenticatedSession("/cabinet");

  return <CabinetDashboard role={session.user.role} />;
}
