import HomeDashboard from "./HomeDashboard";
import { requireAuthenticatedSession } from "@/lib/app-access";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ needShift?: string }>;
}) {
  const session = await requireAuthenticatedSession("/");
  const sp = await searchParams;

  return (
    <HomeDashboard
      role={session.user.role}
      userName={session.user.name ?? session.user.login}
      needShiftNotice={sp.needShift === "1"}
    />
  );
}
