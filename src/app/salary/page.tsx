import { requireActiveShiftAccess } from "@/lib/app-access";
import SalaryDashboard from "./SalaryDashboard";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SalaryPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[]; view?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const tab = firstParam(params?.tab)?.trim();
  const personalView = firstParam(params?.view)?.trim() === "mine";
  const from = tab ? `/salary?tab=${encodeURIComponent(tab)}` : "/salary";
  const session = await requireActiveShiftAccess(from);

  return (
    <SalaryDashboard
      role={session.user.role}
      login={session.user.login}
      name={session.user.name}
      isOwner={session.user.role === "owner"}
      initialPersonalView={personalView}
    />
  );
}
