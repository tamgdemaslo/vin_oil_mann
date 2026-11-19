import { isEngineOilServiceCapacity } from "@/lib/maintenance-quote";
import type { MannTechnicalVehicleContext } from "@/lib/mann-technical-applicability";
import type { MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import { normalizeEngineCode } from "@/lib/vehicle-normalization";

export function withMannEngineOilReference(
  profile: MannUnifiedTechnicalProfile | null,
  vehicle: MannTechnicalVehicleContext,
): MannUnifiedTechnicalProfile | null {
  const engine = normalizeEngineCode(vehicle.engineCode);
  if (!/^(?:M)?271\.?940$/.test(engine ?? "")
    || !/\b(?:W203|S203|CL203|203[. ](?:042|242|742))\b/i.test([vehicle.model, vehicle.generation].join(" "))) {
    return profile;
  }
  if (profile?.items.some(item => item.systemCode === "ENGINE_OIL"
    && (item.capacities.some(isEngineOilServiceCapacity) || item.researchVolumeText))) {
    return profile;
  }

  return {
    transmissionOptions: [],
    containsCatalogPreview: false,
    ...profile,
    status: !profile || profile.status === "none" ? "active" : profile.status,
    items: [...(profile?.items ?? []), {
      revisionId: "daimler:BF18.00-P-1001-01L:203:271.940",
      systemCode: "ENGINE_OIL",
      systemLabel: "Моторное масло",
      capacities: [{ qualifier: "EXACT", nominalLiters: 5.5, serviceContext: "WITH_FILTER", serviceContextLabel: "с фильтром" }],
      specifications: [],
      viscosityGrades: [],
      evidence: [{
        publisher: "Daimler AG",
        title: "BF18.00-P-1001-01L (AR18.00-P-1250QK)",
        url: "https://ww2-secure.justanswer.com/uploads/Chezario/2011-04-22_072451_w203_check_oil_pressure.pdf",
        pdfPage: 2,
      }],
      sourceStatus: "primary_source",
      requiresReview: false,
      automaticSelectionEligible: false,
      userConfirmedTransmission: false,
    }],
  };
}
