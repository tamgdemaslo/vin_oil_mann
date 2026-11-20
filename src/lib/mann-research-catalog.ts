import { mannResearchScope, mannResearchScopeMatches, MANN_RESEARCH_SCOPE_NOTICE } from "@/lib/mann-research-scope";
import type { MannTechnicalVehicleContext } from "@/lib/mann-technical-applicability";
import { splitMannEngineCodeList } from "@/lib/mann-engine-code-list";
import { engineOilViscosities, hasResolvedFluidResearchVolume } from "@/lib/maintenance-quote";
import { loadSelectedMannApplications } from "@/lib/mann-selected-applications";
import { isEngineOilServiceCapacity } from "@/lib/maintenance-quote";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeEngineCode, normalizeVehicleMake, normalizeVehicleModel } from "@/lib/vehicle-normalization";
import { parseFluidCapacities } from "@/lib/fluid-capacity-parser";
import type { MannTransmissionType, MannUnifiedTechnicalProfile, MannTechnicalProfileItem } from "@/lib/mann-unified-technical-profile";

const METHOD = "AI_SELECTED_MANN_RESEARCH_V1";
const MANUAL_METHOD = "MANUAL_SELECTED_MANN_RESEARCH_V1";
type ResearchItem = { systemCode: string; specification: string; volumeText: string; sourceUrl: string; sourceTitle: string; excerpt: string };
type Application = { vehicleVariantKey: string; make: string; model: string; effectiveVehicleText: string | null; vehicleText: string | null; engineCode: string | null; vehicleYears?: string | null; modelYears?: string | null; kw?: string | null; hp?: string | null };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Use a precise engine only when every selected variant supports that code. */
export function mannResearchEngineCode(applications: Application[], engineCode?: string) {
  const code = normalizeEngineCode(engineCode);
  if (!code || !applications.length) return undefined;
  const codes = (row: Application) => splitMannEngineCodeList(row.engineCode).map(normalizeEngineCode);
  const keys = [...new Set(applications.map(row => row.vehicleVariantKey))];
  return keys.every(key => applications.some(row => row.vehicleVariantKey === key && codes(row).includes(code)))
    ? code : undefined;
}

export function mannResearchIdentity(applications: Application[], transmissionType?: MannTransmissionType, engineCode?: string, vehicleContext?: MannTechnicalVehicleContext) {
  const variants = [...new Set(applications.map(row => JSON.stringify({
    variantKey: row.vehicleVariantKey, make: row.make, model: row.model,
    modification: row.effectiveVehicleText || row.vehicleText, engineCode: engineCode ?? row.engineCode,
    productionYears: row.vehicleYears || row.modelYears, powerKw: row.kw, powerHp: row.hp,
  })))].sort().map(value => JSON.parse(value));
  return { source: "selected_mann_all_systems_v4", scope: mannResearchScope({ ...vehicleContext, engineCode: vehicleContext?.engineCode ?? engineCode }), variants, transmissionType: transmissionType ?? null, ...(engineCode ? { engineCode } : {}) };
}

const savedItemsSchema = z.array(z.object({
  systemCode: z.string(), specification: z.string(), volumeText: z.string(),
  sourceUrl: z.string().url(), sourceTitle: z.string(), excerpt: z.string(),
}));

async function materializeSavedResearch(input: { organizationId: string; variantKeys: string[]; transmissionType?: MannTransmissionType; engineCode?: string; vehicleContext?: MannTechnicalVehicleContext }) {
  const applications = await loadSelectedMannApplications(input.variantKeys);
  if (input.variantKeys.some(key => !applications.some(row => row.vehicleVariantKey === key))) return;
  const engineCode = mannResearchEngineCode(applications, input.engineCode);
  const vehicleKey = "mann-research:" + hash(mannResearchIdentity(applications, input.transmissionType, engineCode, input.vehicleContext));
  const records = await prisma.aIAgentTechnicalEvidence.findMany({ where: {
    organizationId: input.organizationId, vehicleKey, factType: "VIN_FLUID_RESEARCH_V1",
    invalidatedAt: null, status: { in: ["pending_review", "approved"] },
  }, orderBy: { createdAt: "desc" } });
  for (const record of records) {
    const facts = record.facts as { items?: unknown; catalogMaterialized?: boolean };
    if (facts.catalogMaterialized) continue;
    const items = savedItemsSchema.safeParse(facts.items);
    if (!items.success || !items.data.length) continue;
    await prisma.$transaction(async tx => {
      await persistMannResearchCatalog(tx, { ...input, applications, engineCode, evidenceId: record.id, items: items.data });
      await tx.aIAgentTechnicalEvidence.update({ where: { id: record.id }, data: { facts: JSON.parse(JSON.stringify({ ...facts, catalogMaterialized: true })) } });
    });
  }
  return engineCode;
}

/** Preserve source, normalized requirement and explicit MANN links as one transaction. */
export async function persistMannResearchCatalog(tx: Prisma.TransactionClient, input: {
  organizationId: string; variantKeys: string[]; applications: Application[];
  transmissionType?: MannTransmissionType; engineCode?: string; vehicleContext?: MannTechnicalVehicleContext; evidenceId: string; items: ResearchItem[]; sourceKind?: "manual_source_review";
}) {
  const keys = [...new Set(input.variantKeys)].sort();
  const manual = input.sourceKind === "manual_source_review";
  const method = manual ? MANUAL_METHOD : METHOD;
  const confidence = manual ? "manual_source_review" : "ai_research";
  const applications = keys.map(key => input.applications.find(row => row.vehicleVariantKey === key));
  if (applications.some(row => !row)) throw new Error("Модификация MANN не найдена при сохранении жидкостей");
  for (const item of input.items) {
    const scope = mannResearchScope({ ...input.vehicleContext, engineCode: input.vehicleContext?.engineCode ?? input.engineCode });
    const identity = { scopeVersion: 4, scope, organizationId: input.organizationId, keys, transmissionType: input.transmissionType ?? null, ...(input.engineCode ? { engineCode: input.engineCode } : {}), item, ...(manual ? { sourceKind: input.sourceKind } : {}) };
    const id = (manual ? "manual-fluid:" : "ai-fluid:") + hash(identity);
    const sourceId = id + ":source";
    const first = applications[0]!;
    const make = normalizeVehicleMake(first.make);
    const model = normalizeVehicleModel(first.model, make).canonical;
    if (!make || !model) throw new Error("Не удалось нормализовать модификацию MANN при сохранении жидкостей");
    const provenance = { scopeVersion: 4, scope, method, ...(manual ? { sourceKind: input.sourceKind } : {}), organizationId: input.organizationId, variantKeys: keys, transmissionType: input.transmissionType ?? null, engineCode: input.engineCode ?? null, evidenceId: input.evidenceId, item };
    await tx.fluidSourceRow.upsert({ where: { id: sourceId }, update: {}, create: {
      id: sourceId, sourceUrl: item.sourceUrl, pageTitle: item.sourceTitle,
      makeRaw: first.make, makeNormalized: make, modelRaw: first.model, modelNormalized: model,
      tableIndex: 0, rowIndex: 0, tableKind: confidence, systemNameRaw: item.systemCode,
      rawCellsJson: [item.specification, item.volumeText, item.excerpt], parsedRowJson: provenance,
    } });
    await tx.vehicleFluidRequirement.upsert({ where: { id }, update: {}, create: {
      id, sourceRowId: sourceId, sourceTableKey: method, sourceUrl: item.sourceUrl,
      make: first.make, makeNormalized: make, model: first.model, modelNormalized: model,
      engineCodeNormalized: input.engineCode ?? (applications.length === 1 ? normalizeEngineCode(first.engineCode) : null),
      transmissionType: input.transmissionType, systemCode: item.systemCode, systemNameRaw: item.systemCode,
      specificationText: item.specification || null, specificationsJson: item.specification ? [item.specification] : [],
      fillVolumeText: item.volumeText || null, capacitiesJson: JSON.parse(JSON.stringify(parseFluidCapacities(item.volumeText, item.systemCode).capacities)),
      contextConfidence: confidence, rawRequirementJson: provenance,
    } });
    for (const application of applications) {
      const row = application!;
      await tx.mannFluidRequirementLink.upsert({
        where: { requirementId_mannVariantKey: { requirementId: id, mannVariantKey: row.vehicleVariantKey } }, update: {},
        create: { id: id + ":" + hash(row.vehicleVariantKey), requirementId: id, mannVariantKey: row.vehicleVariantKey,
          mannMake: row.make, mannModel: row.model, mannVehicleText: row.effectiveVehicleText || row.vehicleText,
          mannEngineCode: row.engineCode, matchScore: 0, confidence, status: "review_required",
          matchMethod: method, evidenceJson: provenance },
      });
    }
  }
}

/** Read accumulated linked knowledge before considering another AI lookup. */
export async function addMannResearchCatalogToProfile(input: {
  organizationId: string; variantKeys: string[]; transmissionType?: MannTransmissionType; engineCode?: string; vehicleContext?: MannTechnicalVehicleContext; profile: MannUnifiedTechnicalProfile; materializeSaved?: boolean;
}): Promise<MannUnifiedTechnicalProfile> {
  const keys = [...new Set(input.variantKeys)].sort();
  const engineCode = input.materializeSaved === false
    ? mannResearchEngineCode(await loadSelectedMannApplications(keys), input.engineCode)
    : await materializeSavedResearch({ ...input, variantKeys: keys });
  const links = (await Promise.all([MANUAL_METHOD, METHOD].map(matchMethod => prisma.mannFluidRequirementLink.findMany({ where: {
    mannVariantKey: { in: keys }, matchMethod, status: { in: ["review_required", "confirmed"] },
    evidenceJson: { path: ["organizationId"], equals: input.organizationId },
  }, include: { requirement: { include: { sourceRow: true } } }, orderBy: { createdAt: "desc" }, take: 1000 })))).flat();
  const items: MannTechnicalProfileItem[] = [];
  let incompatibleResearch = false;
  const seen = new Set<string>();
  for (const link of links) {
    const raw = link.evidenceJson as { scopeVersion?: number; scope?: unknown; variantKeys?: string[]; transmissionType?: string | null; engineCode?: string | null };
    if (JSON.stringify(raw.variantKeys) !== JSON.stringify(keys) || (raw.transmissionType ?? null) !== (input.transmissionType ?? null)) continue;
    if (raw.engineCode && raw.engineCode !== engineCode) continue;
    if (raw.scopeVersion !== 4 || !mannResearchScopeMatches(raw.scope, { ...input.vehicleContext, engineCode: input.vehicleContext?.engineCode ?? input.engineCode })) { incompatibleResearch = true; continue; }
    const row = link.requirement;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const existing = input.profile.items.filter(item => item.systemCode === row.systemCode);
    const specifications = existing.some(item => item.specifications.length) ? [] : row.specificationText ? [row.specificationText] : [];
    const viscosityGrades = row.systemCode === "ENGINE_OIL" && !existing.some(item =>
      engineOilViscosities([...(item.viscosityGrades ?? []), ...item.specifications].join("; ")).length)
      ? engineOilViscosities(row.specificationText ?? "") : [];
    const hasVolume = existing.some(item => (row.systemCode === "ENGINE_OIL"
      ? item.capacities.some(isEngineOilServiceCapacity)
      : item.capacities.length > 0) || hasResolvedFluidResearchVolume(item.researchVolumeText, row.systemCode));
    const volumeText = hasVolume ? undefined : row.fillVolumeText ?? undefined;
    if (!specifications.length && !viscosityGrades.length && !volumeText) continue;
    items.push({ revisionId: row.id, systemCode: row.systemCode, systemLabel: row.systemNameRaw,
      capacities: [], specifications, viscosityGrades, evidence: [{ title: row.sourceRow.pageTitle ?? undefined, url: row.sourceUrl }],
      sourceStatus: "catalog_preview", requiresReview: true, userConfirmedTransmission: false, automaticSelectionEligible: false,
      researchVolumeText: volumeText, researchResult: true, recommendation: link.matchMethod === MANUAL_METHOD ? "Добавлено по опубликованному источнику. Требуется проверка применяемости." : "Найдено ИИ; сохранено в каталоге. Требуется проверка источника.",
    });
  }
  if (!items.length) return incompatibleResearch ? { ...input.profile, notice: [input.profile.notice, MANN_RESEARCH_SCOPE_NOTICE].filter(Boolean).join(" ") } : input.profile;
  return { ...input.profile, ...(incompatibleResearch ? { notice: [input.profile.notice, MANN_RESEARCH_SCOPE_NOTICE].filter(Boolean).join(" ") } : {}), items: [...input.profile.items, ...items], status: input.profile.status === "none" ? "catalog_preview" : input.profile.status, containsCatalogPreview: true };
}
