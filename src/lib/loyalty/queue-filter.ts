import type { ReturnCandidate } from "@/lib/customer-return-candidates";
import { customerReturnTab, type ReturnTab } from "@/lib/customer-return-workflow";
import type { CustomerReturnSharedState } from "@/lib/customer-return-shared-types";

export type QueueFilters = { tab: ReturnTab; todayResult?: string | null; scenario: string; search: string };

export function matchesLoyaltyQueueFilter(candidate: ReturnCandidate, state: CustomerReturnSharedState | undefined, filters: QueueFilters) {
  const { tab, todayResult, scenario, search } = filters;
  return customerReturnTab(candidate, state) === tab
    && (!todayResult || (!state?.historyServiceDate && (todayResult === "processing" ? ["queued", "sending"].includes(state?.deliveryStatus ?? "") : state?.deliveryStatus === todayResult)))
    && (scenario === "all" || candidate.reasons.some((reason) => reason.scenario === scenario))
    && (!search.trim() || [candidate.displayName, candidate.phone, ...candidate.reasons.map((reason) => reason.vehicle)]
      .filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase()));
}
