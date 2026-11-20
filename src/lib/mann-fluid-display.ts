import { mannCapacityLabel } from "@/lib/mann-capacity-label";
import type { MannTechnicalProfileItem } from "@/lib/mann-unified-technical-profile";
import type { MannFluidResearchResult } from "@/lib/mann-fluid-research";

/** Saved partial discoveries supplement a unique existing card, just as live
 * discoveries do. Never flatten distinct component/condition alternatives. */
export function mannFluidDisplayItems(items: MannTechnicalProfileItem[], live: MannFluidResearchResult["items"] = []) {
  const visible = items.filter(item => [...item.specifications, ...item.viscosityGrades].some(value => value.trim())
    || item.researchVolumeText?.trim() || (!item.requiresReview && item.capacities.some(capacity => mannCapacityLabel(capacity).trim())));
  const moved = visible.filter(item => item.researchResult && item.evidence.some(source => source.url)
    && visible.filter(base => !base.researchResult && base.systemCode === item.systemCode
      && (!item.componentModel || base.componentModel === item.componentModel)).length === 1);
  const researchItems = [...live, ...moved.flatMap(item => item.evidence.flatMap(source => source.url ? [{
    systemCode: item.systemCode as MannFluidResearchResult["items"][number]["systemCode"],
    specification: [...item.specifications, ...item.viscosityGrades].join("; "),
    volumeText: item.researchVolumeText ?? "", sourceUrl: source.url,
    sourceTitle: source.title ?? source.publisher ?? "Сохранённый источник", excerpt: "",
  }] : []))];
  return { catalogItems: visible.filter(item => !moved.includes(item)), researchItems };
}
