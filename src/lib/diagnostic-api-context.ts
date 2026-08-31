import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";

/**
 * Runs a private diagnostic route inside the verified active branch.
 * Public token routes intentionally do not use this wrapper.
 */
export function withDiagnosticBranchRoute<Args extends unknown[], Result>(
  handler: (...args: Args) => Result | Promise<Result>
) {
  return async (...args: Args) => {
    const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
    if (!branchAccess.ok) return branchAccess.response;

    return runWithBranchApiContext(branchAccess.context, () => handler(...args));
  };
}
