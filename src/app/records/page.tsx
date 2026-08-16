import { Suspense } from "react";
import { getBranchContext } from "@/lib/branch-context";
import AllBranchRecordsClient from "./AllBranchRecordsClient";
import RecordsPageClient from "./RecordsPageClient";

export default async function RecordsPage() {
  const context = await getBranchContext({ allowAll: true, requireActive: false });
  if (context?.mode === "all") return <AllBranchRecordsClient branches={context.branches.map((branch) => ({ id: branch.id, name: branch.displayName || branch.shortName || branch.name, timezone: branch.timezone }))} />;
  return (
    <Suspense fallback={null}>
      <RecordsPageClient />
    </Suspense>
  );
}
