import type { PosterHistoryRow } from "@/lib/job-order-poster-types";

type RawPos = {
  quantity?: number;
  discount?: number;
  assortment?: { name?: string; meta?: { type?: string; href?: string } };
};

export type PosterBortJournalFromMs = {
  rows: PosterHistoryRow[];
  totalMatching: number;
  sinceVisitRu: string;
};

export async function fetchPosterBortJournalFromMoySklad(params: {
  agentHref: string;
  currentDemandId: string;
  currentVin: string;
  currentPlate: string;
  currentMileage: number;
  rawRows: RawPos[];
  displayVisits?: number;
}): Promise<PosterBortJournalFromMs | null> {
  void params;
  return null;
}
