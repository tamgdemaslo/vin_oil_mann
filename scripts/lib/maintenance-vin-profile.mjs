/** The read-only audit exercises the same saved-catalog scope gate as execution. */
export function createMaintenanceVinProfileLoader(options, dependencies) {
  const {getMannUnifiedTechnicalProfile,withMannEngineOilReference,addMannResearchCatalogToProfile}=dependencies;
  return async (variantKeys,vehicleContext,transmissionType)=>{
    vehicleContext={...vehicleContext,confirmedTransmissionType:transmissionType};
    let profile=await getMannUnifiedTechnicalProfile(variantKeys,transmissionType,vehicleContext);
    profile=withMannEngineOilReference(profile,vehicleContext)??profile;
    profile=await addMannResearchCatalogToProfile({organizationId:options.organization,variantKeys,transmissionType,
      engineCode:vehicleContext.engineCode,vehicleContext,profile,
      ...(options['match-only']?{materializeSaved:false}:{}),
    });
    return withMannEngineOilReference(profile,vehicleContext)??profile;
  };
}
