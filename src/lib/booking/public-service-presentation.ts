export type PublicServiceGroup = "engine" | "transmission" | "fluids" | "other";

export type PublicServicePresentation = {
  customerName: string;
  customerDescription: string | null;
  group: PublicServiceGroup;
};

const OTHER_WORKS = /(?:выставление\s+уровня|диагностик|сброс\s+сервисного|редуктор|haldex|раздаточн)/iu;
const ENGINE_OIL = /(?:замена.*моторного\s+масла|масло.*двигател)/iu;
const TRANSMISSION = /(?:замена.*(?:акпп|dsg|cvt|вариатор|коробк|трансмис)|(?:акпп|dsg|cvt|вариатор|трансмис).*масл)/iu;
const FLUIDS = /(?:жидкост|антифриз|охлаждающ|тормозн|фильтр|масл)/iu;

export function publicServicePresentation(name: string, description?: string | null): PublicServicePresentation {
  const internalName = name.trim();
  const sourceDescription = description?.trim() || null;
  const isEngineOilWithFilter = /(?:замена\s+моторного\s+масла.*масляного\s+фильтра)/iu.test(internalName);

  const customerName = isEngineOilWithFilter ? "Замена моторного масла" : internalName;
  const customerDescription = isEngineOilWithFilter
    ? sourceDescription || "С заменой масляного фильтра."
    : sourceDescription;

  const group: PublicServiceGroup = OTHER_WORKS.test(internalName)
    ? "other"
    : ENGINE_OIL.test(internalName)
      ? "engine"
      : TRANSMISSION.test(internalName)
        ? "transmission"
        : FLUIDS.test(internalName)
          ? "fluids"
          : "other";

  return { customerName, customerDescription, group };
}

export function publicServiceGroupRank(group: PublicServiceGroup) {
  return { engine: 0, transmission: 1, fluids: 2, other: 3 }[group];
}
