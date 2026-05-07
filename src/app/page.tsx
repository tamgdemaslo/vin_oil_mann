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
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <HomeDashboard
        role={session.user.role}
        login={session.user.login}
        userName={session.user.name ?? session.user.login}
        needShiftNotice={sp.needShift === "1"}
      />
    </div>
  );
}
