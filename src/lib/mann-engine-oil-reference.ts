import { isEngineOilServiceCapacity } from "@/lib/maintenance-quote";
import type { MannTechnicalVehicleContext } from "@/lib/mann-technical-applicability";
import type { MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import { normalizeEngineCode } from "@/lib/vehicle-normalization";

export function withMannEngineOilReference(
  profile: MannUnifiedTechnicalProfile | null,
  vehicle: MannTechnicalVehicleContext,
): MannUnifiedTechnicalProfile | null {
  const engine = normalizeEngineCode(vehicle.engineCode);
  // M111.955 must not inherit the later M271.940's 5.5 l capacity.
  // Daimler WIS BF18.00-P-1001-01L: 111.951/955/981, with filter 7.0 l.
  // Ravenol's exact 203.045 application independently lists 7 l and MB 229.5.
  if (/^M111\.?955$/.test(engine ?? "") && /\bW203\b/i.test([vehicle.model, vehicle.generation].join(" "))
    && /MERCEDES/i.test(vehicle.make ?? "")) {
    if (profile?.items.some(item => item.systemCode === "ENGINE_OIL")) return profile;
    return {
      transmissionOptions: [], containsCatalogPreview: false, ...profile,
      status: !profile || profile.status === "none" ? "active" : profile.status,
      items: [...(profile?.items ?? []), {
        revisionId: "daimler:BF18.00-P-1001-01L:203:111.955",
        systemCode: "ENGINE_OIL", systemLabel: "Моторное масло",
        capacities: [{ qualifier: "EXACT", nominalLiters: 7, serviceContext: "WITH_FILTER", serviceContextLabel: "с фильтром" }],
        specifications: ["MB 229.5"], viscosityGrades: [],
        evidence: [{ publisher: "Daimler AG", title: "BF18.00-P-1001-01L, двигатель 111.955: 7.0 л с фильтром",
          url: "https://lemon-manuals.org.ua/Mercedes%20Benz/2005/C230%202D%20Coupe%2C%20Automatic/Repair%20and%20Diagnosis/Engine%20Mechanical/Lubrication%20System/Lubrication%2C%20Oil%20Cooling%20--%20203%20Chassis/Testing%20%26%20Repair/Remove%20oil%20level%20sensor%2C%20install%20-%20AR18.40-P-5111PR/" },
          { publisher: "RAVENOL", title: "C 200 Kompressor 203.045, двигатель 111.955: 7 л, MB 229.5",
          url: "https://choise.ravenol.com/1-cars/365-mercedes-benz/1433-c-klass-w203-s203-cl203/83364-c-200-kompressor-203-045245745/" }],
        sourceStatus: "primary_source", requiresReview: false,
        automaticSelectionEligible: true, userConfirmedTransmission: false,
      }],
    };
  }

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
