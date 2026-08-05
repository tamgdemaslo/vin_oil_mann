import { requireAuthenticatedSession } from "@/lib/app-access";
import { getBranchContext } from "@/lib/branch-context";
import CabinetDashboard from "./CabinetDashboard";

const PERSONAL_TABS = new Set(["profile", "security", "telegram", "branches"]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CabinetPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireAuthenticatedSession("/cabinet");
  const params = searchParams ? await searchParams : undefined;
  const requestedTab = first(params?.tab) ?? "profile";
  const initialTab = PERSONAL_TABS.has(requestedTab) ? requestedTab as "profile" | "security" | "telegram" | "branches" : "profile";
  const branchContext = await getBranchContext({ allowAll: true, requireActive: false }).catch(() => null);

  return (
    <CabinetDashboard
      user={session.user}
      branches={branchContext?.branches ?? []}
      activeBranchId={branchContext?.branchId ?? null}
      branchRole={branchContext?.branchRole ?? branchContext?.groupRole ?? null}
      initialTab={initialTab}
    />
  );
}
