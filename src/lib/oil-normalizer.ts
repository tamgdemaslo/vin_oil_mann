/** Shared compatibility API used by the matcher, AI and product editor. */
import {
  normalizeAcea,
  normalizeEngineApi,
  normalizeEngineOemApproval,
  normalizeAttributeValues,
  normalizeIlsac,
} from "@/lib/product-attribute-values";
import type { RequirementsNorm } from "@/types/oil";

type MultiMatch = ReturnType<typeof normalizeAcea>;

function canonicalValues(results: MultiMatch) {
  return results
    .filter((result) => result.status !== "CUSTOM" && result.status !== "AMBIGUOUS")
    .map((result) => result.value);
}

/** Unknown text is ignored by matcher normalization, but remains lossless in product fields. */
export function normalizeSAE(value: string): string[] {
  return canonicalValues(normalizeAttributeValues("engineSae", value));
}

export function normalizeOEM(value: string): string[] {
  return canonicalValues(normalizeEngineOemApproval(value));
}

export function normalizeACEA(value: string): string[] {
  return canonicalValues(normalizeAcea(value));
}

export function normalizeAPI(value: string): string[] {
  return canonicalValues(normalizeEngineApi(value));
}

export function normalizeILSAC(value: string): string[] {
  return canonicalValues(normalizeIlsac(value));
}

export function buildRequirementsNorm(raw: {
  sae?: string | null;
  oem?: string | null;
  acea?: string | null;
  api?: string | null;
  ilsac?: string | null;
}): RequirementsNorm {
  return {
    sae: normalizeSAE(raw.sae ?? ""),
    oem: normalizeOEM(raw.oem ?? ""),
    acea: normalizeACEA(raw.acea ?? ""),
    api: normalizeAPI(raw.api ?? ""),
    ilsac: normalizeILSAC(raw.ilsac ?? ""),
  };
}
