import type { ReturnReason } from "./customer-return-candidates";
export type CustomerReturnSharedState = {
  clientKey: string;
  draftText: string | null;
  draftFingerprint: string | null;
  skipped: boolean;
  version: number;
  updatedByLogin: string;
  updatedByName: string;
  updatedAt: string;
};
export type CustomerReturnStatePatch = {
  serviceDate: string;
  clientKey: string;
  expectedVersion: number;
  fingerprint: string;
  draftText?: string | null;
  skipped?: boolean;
};
export function returnCandidateFingerprint(candidate: { reasons: ReturnReason[] }): string {
  const normalized=candidate.reasons.map(reason=>Object.fromEntries(Object.entries({
    ...reason,documentIds:[...reason.documentIds].sort(),
  }).sort(([a],[b])=>a<b?-1:a>b?1:0)));
  const serialized=normalized.map(reason=>JSON.stringify(reason)).sort();
  return `[${serialized.join(",")}]`;
}

/** Poll responses may arrive out of order; never roll back an acknowledged version. */
export function mergeCustomerReturnStates(
  previous: Record<string, CustomerReturnSharedState>, incoming: CustomerReturnSharedState[],
): Record<string, CustomerReturnSharedState> {
  const next = { ...previous };
  for (const state of incoming) {
    if (!next[state.clientKey] || next[state.clientKey].version <= state.version) next[state.clientKey] = state;
  }
  return next;
}
