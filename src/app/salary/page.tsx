import { requireActiveShiftAccess } from "@/lib/app-access";
import SalaryDashboard from "./SalaryDashboard";

export default async function SalaryPage() {
  const session = await requireActiveShiftAccess("/salary");

  return (
    <SalaryDashboard
      role={session.user.role}
      login={session.user.login}
      isOwner={session.user.role === "owner"}
    />
  );
}
