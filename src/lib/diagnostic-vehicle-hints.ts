import type { VehicleHints } from "@/data/diagnostic-catalog";

type DiagnosticVehicleHintSource = {
  decoded?: {
    gearType?: string | null;
    drive?: string | null;
    fuelTypePrimary?: string | null;
    modification?: string | null;
    trim?: string | null;
    generation?: string | null;
    bodyName?: string | null;
    basicParams?: string | null;
    lineup?: string | null;
    model?: string | null;
  } | null;
  oilInfo?: {
    transmission?: {
      code?: string | null;
      gearbox?: string | null;
      fluid?: string | null;
      note?: string | null;
    } | null;
  } | null;
} | null;

function hintText(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ").toLowerCase();
}

export function inferDiagnosticVehicleHintsFromLookup(source: DiagnosticVehicleHintSource): VehicleHints {
  const decoded = source?.decoded;
  const transmission = source?.oilInfo?.transmission;
  const gearboxText = hintText(transmission?.code, transmission?.gearbox, transmission?.fluid, transmission?.note, decoded?.gearType);
  const vehicleText = hintText(
    decoded?.drive,
    decoded?.modification,
    decoded?.trim,
    decoded?.generation,
    decoded?.bodyName,
    decoded?.basicParams,
    decoded?.lineup,
    decoded?.model
  );
  const fuelText = hintText(decoded?.fuelTypePrimary, decoded?.basicParams, decoded?.modification);

  const automatic = Boolean(transmission) || /\b(a\/t|at|auto|automatic|cvt|dct|dsg)\b|акп|автомат|вариатор|робот/i.test(gearboxText);
  const manual = /\b(m\/t|mt|manual|mechanic)\b|мкп|механ/i.test(gearboxText) && !automatic;
  const awd = /\b(awd|4wd|4x4|quattro|xdrive|4matic)\b|all[-\s]?wheel|полный|полнопривод/i.test(vehicleText);
  const frontOrRearDrive = /\b(fwd|rwd|2wd)\b|передний|задний/i.test(vehicleText);
  const hybrid = /\b(hev|phev|hybrid)\b|гибрид/i.test(fuelText);
  const electric = /\b(bev|ev|electric)\b|электро/i.test(fuelText);

  return {
    ...(automatic ? { hasAtf: true, hasManualGearbox: false } : {}),
    ...(manual ? { hasAtf: false, hasManualGearbox: true } : {}),
    ...(awd ? { awd: true } : frontOrRearDrive ? { awd: false } : {}),
    ...(electric ? { electric: true } : {}),
    ...(hybrid ? { hybrid: true } : {}),
  };
}
