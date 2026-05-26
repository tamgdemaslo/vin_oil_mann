import { requireAuthenticatedSession } from "@/lib/app-access";
import CabinetDashboard from "./CabinetDashboard";

export default async function CabinetPage() {
  await requireAuthenticatedSession("/cabinet");

  return <CabinetDashboard />;
}
