import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import {
  PRODUCT_ATTRIBUTE_FIELDS,
  findSimilarAttributeSuggestion,
  normalizeAttributeValue,
  parseStoredAttributeValues,
  productAttributeDictionaryMetadata,
  searchProductAttributeOptions,
  type ProductAttributeField,
} from "@/lib/product-attribute-values";
import { resolveProductFluidAttributeProfile } from "@/lib/product-fluid-profile";

type UsageEntry = { count: number; lastUsedAt: number };
type UsageCacheEntry = { expiresAt: number; values: Map<string, UsageEntry> };

const usageCache = new Map<string, UsageCacheEntry>();
const USAGE_CACHE_MS = 2 * 60 * 1000;

const requiredSourceByField: Record<ProductAttributeField, string[]> = {
  brand: ["brands.xml"],
  engineSae: ["engine-sae.xml"],
  transmissionSae: ["transmission-sae.xml"],
  packageVolume: ["package-volumes.xml"],
  acea: ["acea.xml"],
  engineApi: ["engine-api.xml"],
  transmissionApi: ["transmission-api.xml"],
  ilsac: ["engine-oem.xml", "engine-api.xml"],
  atf: ["atf.xml"],
  engineOem: ["engine-oem.xml"],
  transmissionOem: ["transmission-oem.xml"],
};

function isProductAttributeField(value: string): value is ProductAttributeField {
  return (PRODUCT_ATTRIBUTE_FIELDS as readonly string[]).includes(value);
}

function storedValueForField(field: ProductAttributeField, product: {
  brand: string | null;
  sae: string | null;
  packageVolume: string | null;
  acea: string | null;
  apiSpec: string | null;
  ilsac: string | null;
  atf: string | null;
  oem: string | null;
  oemAtf: string | null;
  groupPath: string | null;
  entityType: string;
}) {
  const profile = resolveProductFluidAttributeProfile(product);
  if (field === "brand") return product.brand;
  if (field === "packageVolume") return product.packageVolume;
  if (field === "acea") return product.acea;
  if (field === "ilsac") return product.ilsac;
  if (field === "atf") return product.atf;
  if (field === "engineSae") return profile === "ENGINE_OIL" ? product.sae : null;
  if (field === "transmissionSae") return profile === "TRANSMISSION_FLUID" ? product.sae : null;
  if (field === "engineApi") return profile === "ENGINE_OIL" ? product.apiSpec : null;
  if (field === "transmissionApi") return profile === "TRANSMISSION_FLUID" ? product.apiSpec : null;
  if (field === "engineOem") return profile === "ENGINE_OIL" ? product.oem : null;
  return profile === "TRANSMISSION_FLUID" ? product.oemAtf : null;
}

async function fieldUsage(branchId: string, field: ProductAttributeField) {
  const cacheKey = `${branchId}:${field}`;
  const cached = usageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.values;
  const products = await prisma.localProduct.findMany({
    where: { branchId, archived: false },
    orderBy: { updatedAt: "desc" },
    take: 2500,
    select: {
      brand: true,
      sae: true,
      packageVolume: true,
      acea: true,
      apiSpec: true,
      ilsac: true,
      atf: true,
      oem: true,
      oemAtf: true,
      groupPath: true,
      entityType: true,
      updatedAt: true,
    },
  });
  const values = new Map<string, UsageEntry>();
  for (const product of products) {
    const stored = storedValueForField(field, product);
    for (const value of parseStoredAttributeValues(stored, field)) {
      const normalized = normalizeAttributeValue(field, value);
      if (normalized.status === "CUSTOM" || normalized.status === "AMBIGUOUS") continue;
      const current = values.get(normalized.value);
      values.set(normalized.value, {
        count: (current?.count ?? 0) + 1,
        lastUsedAt: Math.max(current?.lastUsedAt ?? 0, product.updatedAt.getTime()),
      });
    }
  }
  usageCache.set(cacheKey, { expiresAt: Date.now() + USAGE_CACHE_MS, values });
  return values;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  const fieldValue = request.nextUrl.searchParams.get("field") ?? "";
  if (!isProductAttributeField(fieldValue)) {
    return NextResponse.json({ error: "Неизвестный справочник характеристик" }, { status: 400 });
  }
  const field = fieldValue;
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.max(1, Math.min(50, Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "40", 10) || 40));
  const selected = request.nextUrl.searchParams.getAll("selected").map((value) => value.trim()).filter(Boolean);

  try {
    const usage = await fieldUsage(branchAccess.context.branchId!, field);
    const searchResults = searchProductAttributeOptions(field, query, 100);
    const rank = new Map(searchResults.map((option, index) => [option.value, index]));
    const resolvedSelected = selected.flatMap((value) =>
      parseStoredAttributeValues(value, field).flatMap((parsed) => {
        return [normalizeAttributeValue(field, parsed)];
      })
    );
    const selectedCanonical = resolvedSelected.flatMap((normalized) =>
      normalized.status === "CUSTOM" || normalized.status === "AMBIGUOUS" ? [] : [normalized.value]
    );
    const selectedSet = new Set(selectedCanonical);
    const options = searchResults
      .sort((left, right) => {
        const selectedDifference = Number(selectedSet.has(right.value)) - Number(selectedSet.has(left.value));
        if (selectedDifference) return selectedDifference;
        if (query) return (rank.get(left.value) ?? 999) - (rank.get(right.value) ?? 999);
        const leftUsage = usage.get(left.value);
        const rightUsage = usage.get(right.value);
        const recentDifference = (rightUsage?.lastUsedAt ?? 0) - (leftUsage?.lastUsedAt ?? 0);
        if (recentDifference) return recentDifference;
        const countDifference = (rightUsage?.count ?? 0) - (leftUsage?.count ?? 0);
        if (countDifference) return countDifference;
        return left.value.localeCompare(right.value, "ru", { numeric: true, sensitivity: "base" });
      })
      .slice(0, limit)
      .map((option) => ({ ...option, usageCount: usage.get(option.value)?.count ?? 0 }));

    const normalization = query ? normalizeAttributeValue(field, query) : null;
    const suggestion = query
      ? normalization && normalization.status !== "CUSTOM" && normalization.value !== query.trim()
        ? normalization.value
        : findSimilarAttributeSuggestion(field, query)
      : null;
    const availableSourceNames = new Set(productAttributeDictionaryMetadata.sourceFiles.map((source) => String(source.fileName ?? "")));
    const fieldSourceComplete = requiredSourceByField[field].every((fileName) => availableSourceNames.has(fileName));

    return NextResponse.json({
      field,
      options,
      suggestion,
      normalization,
      resolvedSelected,
      metadata: {
        version: productAttributeDictionaryMetadata.version,
        generatedAt: productAttributeDictionaryMetadata.generatedAt,
        complete: fieldSourceComplete,
        missingSource: !fieldSourceComplete,
      },
    });
  } catch (error) {
    console.error("[product-attribute-options]", error);
    return NextResponse.json({ error: "Не удалось загрузить справочник" }, { status: 500 });
  }
}
