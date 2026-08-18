const BRANCH_QUERY_PARAM = "branchId";

export function publicBookingPath(branchId?: string | null) {
  const normalizedBranchId = branchId?.trim();
  if (!normalizedBranchId) return "/booking";
  return `/booking?${BRANCH_QUERY_PARAM}=${encodeURIComponent(normalizedBranchId)}`;
}

export function publicBookingBranchFromSearch(search: string) {
  const params = new URLSearchParams(search);
  return params.get(BRANCH_QUERY_PARAM)?.trim() || params.get("branch")?.trim() || null;
}
