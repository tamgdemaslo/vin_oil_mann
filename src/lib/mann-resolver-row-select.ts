import type { Prisma } from '@prisma/client';

// Keep the real VIN resolver projection aligned with offline ranking inputs.
// In particular, bounded generation evidence requires the model period.
export const MANN_RESOLVER_ROW_SELECT = {
  vehicleVariantKey: true,
  make: true,
  makeNormalized: true,
  model: true,
  modelNormalized: true,
  modelYears: true,
  vehicleText: true,
  effectiveVehicleText: true,
  engineCode: true,
  engineCodeNormalized: true,
  kw: true,
  hp: true,
  vehicleYears: true,
  vehicleYearFrom: true,
  vehicleYearTo: true,
  condition: true,
} as const satisfies Prisma.MannFilterApplicationSelect;
