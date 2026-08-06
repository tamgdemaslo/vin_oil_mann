import { prisma } from "@/lib/db";
import { runWithRequestTenant } from "@/lib/request-tenant-store";

export type BranchWorkerResult<T> = {
  branchId: string;
  branchName: string;
  ok: boolean;
  result?: T;
  error?: string;
};

export async function runForBranch<T>(branchId: string, operation: () => Promise<T>): Promise<T> {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, status: "active" },
    select: { id: true, businessGroupId: true, legacyOrganizationId: true },
  });
  if (!branch) throw new Error("Филиал не найден или отключён");
  const organizationId = branch.legacyOrganizationId ?? branch.id;
  return runWithRequestTenant(
    { mode: "branch", branchId: branch.id, organizationId, businessGroupId: branch.businessGroupId, allowedBranchIds: [branch.id] },
    operation
  );
}

export async function runForActiveBranches<T>(
  operation: (branch: { id: string; name: string; organizationId: string }) => Promise<T>
): Promise<BranchWorkerResult<T>[]> {
  const branches = await prisma.branch.findMany({
    where: { status: "active" },
    select: { id: true, name: true, businessGroupId: true, legacyOrganizationId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const results: BranchWorkerResult<T>[] = [];
  for (const branch of branches) {
    const organizationId = branch.legacyOrganizationId ?? branch.id;
    try {
      const result = await runWithRequestTenant(
        {
          mode: "branch",
          branchId: branch.id,
          organizationId,
          businessGroupId: branch.businessGroupId,
          allowedBranchIds: [branch.id],
        },
        () => operation({ id: branch.id, name: branch.name, organizationId })
      );
      results.push({ branchId: branch.id, branchName: branch.name, ok: true, result });
    } catch (error) {
      results.push({
        branchId: branch.id,
        branchName: branch.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
