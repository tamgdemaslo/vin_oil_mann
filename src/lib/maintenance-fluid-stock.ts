import { prisma } from "@/lib/db";
import { fluidSpecificationMatches } from "@/lib/ai-assistant/material-selection";
import { normalizeAtf, normalizeTransmissionApi, normalizeTransmissionSae, parseStoredAttributeValues } from "@/lib/product-attribute-values";
import { resolveProductFluidAttributeProfile } from "@/lib/product-fluid-profile";
import { quoteLitresPerUnit, type QuoteStockProduct } from "@/lib/maintenance-quote";
import { MANN_FLUID_SYSTEMS, type MannFluidSystem } from "@/lib/mann-fluid-systems";

export type MaintenanceStockFluidSystem = Exclude<MannFluidSystem, "ENGINE_OIL">;
export const MAINTENANCE_STOCK_FLUID_SYSTEMS = [
  "ENGINE_COOLANT", "BRAKE_FLUID", "AUTOMATIC_TRANSMISSION", "MANUAL_TRANSMISSION",
  "CVT_TRANSMISSION", "ROBOT_TRANSMISSION", "POWER_STEERING", "TRANSFER_CASE",
  "FRONT_DIFFERENTIAL", "REAR_DIFFERENTIAL", "AWD_COUPLING",
] as const satisfies readonly MaintenanceStockFluidSystem[];
export type MaintenanceFluidStockProduct = QuoteStockProduct & {
  compatibilityEvidence: string;
  approvalStatus: "unknown" | "manufacturer_claim" | "official_approval";
  requiresManualReview: boolean;
  /** Internal supplier reference metadata; never infers technical approval. */
  rosskoBrand?: string | null; rosskoPartNumber?: string | null;
  packageVolume?: string | null; packageUnit?: string | null; markingMode?: string | null;
};
export type MaintenanceFluidStockResult = { products: MaintenanceFluidStockProduct[]; reason?: string };
const TRANSMISSION_SYSTEMS = new Set<MaintenanceStockFluidSystem>([
  "AUTOMATIC_TRANSMISSION", "MANUAL_TRANSMISSION", "CVT_TRANSMISSION", "ROBOT_TRANSMISSION",
  "TRANSFER_CASE", "FRONT_DIFFERENTIAL", "REAR_DIFFERENTIAL", "AWD_COUPLING",
]);
const NEGATIVE_DECLARATION = /(?:не\s+(?:соответств|подход|совместим|рекоменд|одобрен)|запрещ|кроме|исключая|not\s+(?:approved|compatible|suitable|recommended|meet|comply)|incompatible|except|exclude|prohibit)/iu;
const SAFE_NORMALIZATIONS = new Set(["CANONICAL", "SAFE_NORMALIZED", "VERIFIED_ALIAS"]);
const categoryText = (value: unknown) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// This exception carries no inferred Dexron backward compatibility: a primary
// PS requirement and the typed ATF card must name the SAME dictionary grade.
function exactDexronGrade(value: string): string | null {
  const values = normalizeAtf(value.trim().replace(/^ATF\s+/i, ""));
  if (values.length !== 1 || !SAFE_NORMALIZATIONS.has(values[0].status)) return null;
  return /^Dexron\s+(?:II[B-E]?|III(?:D|E|F|G|H|Hl)?|VI)$/i.test(values[0].value) ? values[0].value : null;
}
function canonicalDexronText(value: string): string {
  return value.replace(/\b(?:ATF\s+)?DEXRON[ -]*(?:III(?:[ -]*(?:D|E|F|G|H|Hl))?|II(?:[ -]*[B-E])?|VI)\b/gi,
    raw => exactDexronGrade(raw) ?? raw);
}
function powerSteeringAtfGrades(system: MaintenanceStockFluidSystem, specifications: string[]): string[] | null {
  if (system !== "POWER_STEERING") return null;
  const grades = specifications.map(exactDexronGrade);
  return grades.every((value): value is string => Boolean(value)) ? grades : null;
}
function productTypeMatches(product: { groupPath?: string | null; entityType?: string; sae?: string | null }, system: MaintenanceStockFluidSystem, steeringAtfGrades: string[] | null) {
  if (product.entityType === "service") return false;
  const profile = resolveProductFluidAttributeProfile(product);
  const group = categoryText(product.groupPath);
  if (TRANSMISSION_SYSTEMS.has(system)) {
    if (profile !== "TRANSMISSION_FLUID") return false;
    // Explicitly typed CVT/DCT/ATF product groups cannot silently cross roles.
    if (/(?:^| )(?:cvt|вариатор\p{L}*)(?: |$)/u.test(group) && system !== "CVT_TRANSMISSION") return false;
    if (/(?:^| )(?:dct|dsg|робот\p{L}*)(?: |$)/u.test(group) && system !== "ROBOT_TRANSMISSION") return false;
    return true;
  }
  if (profile === "TRANSMISSION_FLUID" && system === "POWER_STEERING" && steeringAtfGrades?.length) {
    const explicitlyAtf = /(?:^| )(?:atf|акпп|automatic transmission)(?: |$)/u.test(group);
    const otherRole = /(?:^| )(?:gear|редуктор\p{L}*|дифференциал\p{L}*|раздаточн\p{L}*|cvt|вариатор\p{L}*|dct|dsg|робот\p{L}*|мкпп)(?: |$)/u.test(group);
    const gearSae = normalizeTransmissionSae(product.sae);
    return explicitlyAtf && !otherRole && !SAFE_NORMALIZATIONS.has(gearSae.status);
  }
  if (profile === "ENGINE_OIL" || profile === "TRANSMISSION_FLUID") return false;
  if (system === "ENGINE_COOLANT") return /(?:антифриз|охлаждающ\p{L}* жидкост|coolant|antifreeze)/u.test(group);
  if (system === "BRAKE_FLUID") return /(?:тормозн\p{L}* жидкост|brake fluid)/u.test(group);
  if (system === "POWER_STEERING") return /(?:^| )(?:гур|гидроусилител\p{L}*|power steering|steering fluid)(?: |$)/u.test(group);
  return false;
}

// DOT spacing is a spelling normalization only. DOT4, DOT4LV and DOT5.1 remain
// different declarations; coolant colour and generic G-numbers are not aliases.
const exactOtherDeclaration = (value: string) => value.normalize("NFKC").replace(/\bDOT[ -]*([345](?:\.\d)?)(?:\s*(LV))?\b/gi,
  (_raw, number: string, lowViscosity?: string) => `DOT${number}${lowViscosity ? "LV" : ""}`);

export async function loadMaintenanceFluidStock(input: {
  branchId: string; storeId: string; systemCode: MaintenanceStockFluidSystem;
  specifications: string[]; viscosity?: string;
  /** Server-side supplier reference discovery only; not accepted by stock API. */
  includeUnavailable?: boolean; productId?: string;
}): Promise<MaintenanceFluidStockResult> {
  if (input.systemCode === ("ENGINE_OIL" as string) || !MANN_FLUID_SYSTEMS.includes(input.systemCode)) throw new Error("Unsupported non-engine fluid system");
  const clauses = [...new Set(input.specifications.flatMap(value => parseStoredAttributeValues(value)))];
  const specifications = clauses.filter(value => !/^SAE\s+/i.test(value));
  if (!specifications.length) return { products: [], reason: "Укажите точные требования жидкости выбранного агрегата." };
  // A SAE clause inside a stored requirement constrains the SAE field too.
  // It cannot vanish, replace an OEM/API requirement, or disagree with the UI.
  const viscosityRequirements = [...clauses.filter(value => /^SAE\s+/i.test(value)), ...(input.viscosity?.trim() ? [input.viscosity.trim()] : [])]
    .map(value => normalizeTransmissionSae(value.replace(/^SAE\s+/i, "")));
  if (viscosityRequirements.length && (!TRANSMISSION_SYSTEMS.has(input.systemCode)
    || viscosityRequirements.some(value => !SAFE_NORMALIZATIONS.has(value.status))
    || new Set(viscosityRequirements.map(value => value.value)).size !== 1)) {
    return { products: [], reason: "Вязкость не подтверждена словарём или требования противоречат друг другу. Проверьте их вручную." };
  }
  const requiredSae = viscosityRequirements[0] ?? null;
  const steeringAtfGrades = powerSteeringAtfGrades(input.systemCode, specifications);
  const { branchId, storeId } = input;
  const rows = await prisma.localProduct.findMany({
    where: { branchId, archived: false, entityType: { not: "service" }, ...(input.productId ? { id: input.productId } : {}), ...(input.includeUnavailable ? {} : { stockBalances: { some: { branchId, storeId, available: { gt: 0 } } } }) },
    select: {
      id: true, name: true, article: true, brand: true, entityType: true, groupPath: true,
      sae: true, oem: true, atf: true, oemAtf: true, apiSpec: true, searchText: true,
      uomName: true, packageVolume: true, markingMode: true, salePriceCents: true, rosskoBrand: true, rosskoPartNumber: true,
      stockBalances: { where: { branchId, storeId }, select: { available: true } },
    },
    orderBy: { name: "asc" },
  });
  const products = rows.flatMap((row): MaintenanceFluidStockProduct[] => {
    if (!productTypeMatches(row, input.systemCode, steeringAtfGrades)) return [];
    if (requiredSae) {
      const actual = normalizeTransmissionSae(row.sae);
      if (!SAFE_NORMALIZATIONS.has(actual.status) || actual.value !== requiredSae.value) return [];
    }
    const structured = [row.atf, row.oemAtf, row.oem, row.apiSpec].filter((value): value is string => Boolean(value?.trim()));
    const negativeContext = [row.searchText, ...structured].filter(Boolean).join("; ");
    // Search prose can veto a declaration but can never create a positive one.
    const negatives = parseStoredAttributeValues(negativeContext).filter(value => NEGATIVE_DECLARATION.test(value));
    const withNegatives = (value: string | null | undefined) => [value, ...negatives].filter(Boolean).join("; ");
    const crossRoleSteeringAtf = input.systemCode === "POWER_STEERING" && resolveProductFluidAttributeProfile(row) === "TRANSMISSION_FLUID";
    const normalizedAtfGrades = (value: string | null) => parseStoredAttributeValues(value).map(value => exactDexronGrade(value) ?? value).join("; ");
    const matched = specifications.every((specification, index) => {
      if (crossRoleSteeringAtf) {
        return Boolean(steeringAtfGrades) && fluidSpecificationMatches({
          atf: canonicalDexronText(withNegatives(normalizedAtfGrades(row.atf))), oemAtf: canonicalDexronText(normalizedAtfGrades(row.oemAtf)), searchText: negativeContext,
        }, steeringAtfGrades![index]);
      }
      if (TRANSMISSION_SYSTEMS.has(input.systemCode)) {
        if (/^API\s+/i.test(specification)) {
          const required = normalizeTransmissionApi(specification.replace(/^API\s+/i, ""));
          const actual = normalizeTransmissionApi(row.apiSpec);
          // Unknown clauses cannot disappear while normalizing a known GL code.
          if (!required.length || required.some(value => !SAFE_NORMALIZATIONS.has(value.status))) return false;
          return required.every(value => actual.some(candidate => SAFE_NORMALIZATIONS.has(candidate.status) && candidate.value === value.value)
            && fluidSpecificationMatches({ atf: withNegatives(actual.filter(candidate => SAFE_NORMALIZATIONS.has(candidate.status)).map(candidate => candidate.value).join("; ")), oemAtf: null, searchText: negativeContext }, value.value));
        }
        return fluidSpecificationMatches({ atf: withNegatives(row.atf), oemAtf: row.oemAtf, searchText: negativeContext }, specification);
      }
      // Other fluid families have no verified broad equivalence dictionary.
      // Only exact positive technical card fields count; names and attributes
      // are never mined to invent a declaration or an official approval.
      return fluidSpecificationMatches({ atf: exactOtherDeclaration(withNegatives(structured.join("; "))), oemAtf: null, searchText: exactOtherDeclaration(negativeContext) }, exactOtherDeclaration(specification));
    });
    if (!matched) return [];
    return [{
      id: row.id, name: row.name, article: row.article ?? "", brand: row.brand,
      price: row.salePriceCents / 100, available: row.stockBalances.reduce((sum, stock) => sum + Number(stock.available), 0),
      unit: row.uomName ?? "шт.", litresPerUnit: quoteLitresPerUnit(row), sae: row.sae ?? "", oem: row.oemAtf ?? row.oem ?? row.atf ?? "",
      compatibilityEvidence: `Положительные технические поля карточки: ${specifications.join("; ")}${requiredSae ? `; SAE ${requiredSae.value}` : ""}. ${crossRoleSteeringAtf ? " Для ГУР указан тот же точный класс Dexron, что в карточке типизированного ATF; эквивалентность других классов не предполагается." : ""} Официальное одобрение не подтверждено. Проверьте применяемость, цену и фасовку перед добавлением.`,
      approvalStatus: "unknown", requiresManualReview: true,
      ...(input.includeUnavailable ? { rosskoBrand: row.rosskoBrand, rosskoPartNumber: row.rosskoPartNumber, packageVolume: row.packageVolume, packageUnit: row.uomName, markingMode: row.markingMode } : {}),
    }];
  });
  return products.length ? { products } : { products: [], reason: "На выбранном складе нет товара с подтверждённым типом жидкости и всеми указанными техническими декларациями. Проверьте характеристики карточек вручную." };
}
