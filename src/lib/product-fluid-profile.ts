export type ProductFluidAttributeProfile = "ENGINE_OIL" | "TRANSMISSION_FLUID" | "OTHER";

export type ProductFluidProfileInput = {
  groupPath?: string | null;
  groupCode?: string | null;
  categoryCode?: string | null;
  entityType?: string | null;
};

function normalizeProfileText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolves which technical dictionary family a product uses in one place.
 * Structured codes win over human group labels; services never receive fluid fields.
 */
export function resolveProductFluidAttributeProfile(product: ProductFluidProfileInput): ProductFluidAttributeProfile {
  if (normalizeProfileText(product.entityType) === "service") return "OTHER";

  const structured = normalizeProfileText([product.groupCode, product.categoryCode].filter(Boolean).join(" "));
  const group = normalizeProfileText(product.groupPath);
  const value = `${structured} ${group}`.trim();
  if (!value) return "OTHER";

  if (
    /(?:^| )(?:transmission\p{L}*|gear oil|atf|cvt|dct|dsg|акпп|мкпп|кпп|вариатор\p{L}*|трансмис\p{L}*|редуктор\p{L}*|дифференциал\p{L}*|раздаточн\p{L}*)(?: |$)/u.test(value)
  ) {
    return "TRANSMISSION_FLUID";
  }

  if (
    /(?:^| )(?:engine oil|motor oil|engine lubricant|моторн\p{L}* масл\p{L}*|масл\p{L}* для двигател\p{L}*|двигател\p{L}*)(?: |$)/u.test(value)
    || (/(?:^| )(?:масло|масла|oil)(?: |$)/u.test(value)
      && !/(?:антифриз|охлаждающ|тормозн|гур|power steering|hydraulic|гидравл)/u.test(value))
  ) {
    return "ENGINE_OIL";
  }

  return "OTHER";
}

export function isFluidAttributeProfile(profile: ProductFluidAttributeProfile) {
  return profile === "ENGINE_OIL" || profile === "TRANSMISSION_FLUID";
}
