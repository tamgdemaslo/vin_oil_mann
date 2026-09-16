/** One fixed inventory for every selected MANN modification, including empty rows. */
export const MANN_FLUID_SYSTEMS = ["ENGINE_OIL", "ENGINE_COOLANT", "BRAKE_FLUID", "AUTOMATIC_TRANSMISSION", "MANUAL_TRANSMISSION", "CVT_TRANSMISSION", "ROBOT_TRANSMISSION", "POWER_STEERING", "TRANSFER_CASE", "FRONT_DIFFERENTIAL", "REAR_DIFFERENTIAL", "AWD_COUPLING"] as const;
export type MannFluidSystem = typeof MANN_FLUID_SYSTEMS[number];
export const MANN_FLUID_GROUP_IDS = ["basic", "transmission", "drivetrain", "auxiliary"] as const;
export type MannFluidGroup = typeof MANN_FLUID_GROUP_IDS[number];
export const MANN_FLUID_GROUPS: Record<MannFluidGroup, { label: string; systems: MannFluidSystem[] }> = {
  basic: { label: "Основные жидкости", systems: ["ENGINE_OIL", "ENGINE_COOLANT", "BRAKE_FLUID"] },
  transmission: { label: "Коробки передач", systems: ["AUTOMATIC_TRANSMISSION", "MANUAL_TRANSMISSION", "CVT_TRANSMISSION", "ROBOT_TRANSMISSION"] },
  drivetrain: { label: "Редукторы и раздатка", systems: ["TRANSFER_CASE", "FRONT_DIFFERENTIAL", "REAR_DIFFERENTIAL"] },
  auxiliary: { label: "ГУР и муфта", systems: ["POWER_STEERING", "AWD_COUPLING"] },
};
export const MANN_FLUID_LABELS: Record<MannFluidSystem, string> = {
  ENGINE_OIL: "Моторное масло", ENGINE_COOLANT: "Антифриз", BRAKE_FLUID: "Тормозная жидкость",
  AUTOMATIC_TRANSMISSION: "АКПП", MANUAL_TRANSMISSION: "МКПП", CVT_TRANSMISSION: "Вариатор", ROBOT_TRANSMISSION: "Робот",
  POWER_STEERING: "ГУР", TRANSFER_CASE: "Раздатка", FRONT_DIFFERENTIAL: "Передний редуктор", REAR_DIFFERENTIAL: "Задний редуктор", AWD_COUPLING: "Муфта полного привода",
};
