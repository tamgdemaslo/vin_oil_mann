#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") } });
const identity = await jiti.import("../src/lib/storefront-product-identity.ts");

const branchNames = process.argv
  .filter((argument) => argument.startsWith("--branch="))
  .map((argument) => argument.slice("--branch=".length).trim())
  .filter(Boolean);
const targets = branchNames.length ? branchNames : ["Дачная", "Гагарина"];
const summaryOnly = process.argv.includes("--summary");

const databaseUrl = process.env.STOREFRONT_AUDIT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("STOREFRONT_AUDIT_DATABASE_URL or DATABASE_URL is required for a locally restored Timeweb snapshot.");
  process.exit(1);
}
const databaseHost = new URL(databaseUrl).hostname.toLowerCase();
if (!["127.0.0.1", "localhost", "::1"].includes(databaseHost)) {
  throw new Error("Аудит разрешён только на локально восстановленной актуальной копии Timeweb; прямое подключение к production запрещено.");
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

function canonical(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleUpperCase("ru-RU").replace(/Ё/g, "Е").replace(/\s+/g, " ");
}

function barcodeKeys(product) {
  return [product.barcodeEan13, product.barcodeEan8, product.barcodeCode128]
    .map((value) => canonical(value).replace(/\s+/g, ""))
    .filter(Boolean)
    .map((value) => `barcode:${value}`);
}

function candidateKeys(product) {
  const keys = barcodeKeys(product);
  const brand = canonical(product.brand);
  const article = canonical(product.article);
  if (brand && article) keys.push(`article:${brand}:${article}`);
  if (product.sourceProductId) keys.push(`source:${product.sourceProductId}`);
  keys.push(`id:${product.id}`);
  return [...new Set(keys)];
}

function branchMatches(branch, requestedName) {
  const needle = canonical(requestedName);
  return [branch.name, branch.shortName, branch.slug].some((value) => canonical(value) === needle);
}

function compactProduct(product) {
  return {
    id: product.id,
    name: product.name,
    article: product.article,
    brand: product.brand,
    uomName: product.uomName,
    packageVolume: product.packageVolume,
    sae: product.sae,
    salePrice: product.salePriceCents > 0 ? product.salePriceCents / 100 : null,
  };
}

try {
  const snapshot = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const branches = await tx.branch.findMany({
      where: { status: "active" },
      select: {
        id: true,
        businessGroupId: true,
        slug: true,
        name: true,
        shortName: true,
        address: true,
        phone: true,
        localStores: {
          where: { archived: false },
          select: { id: true, name: true, isMain: true, archived: true },
          orderBy: [{ isMain: "desc" }, { name: "asc" }],
        },
      },
      orderBy: [{ businessGroupId: "asc" }, { name: "asc" }],
    });
    const selected = targets.map((target) => {
      const matches = branches.filter((branch) => branchMatches(branch, target));
      if (matches.length !== 1) {
        throw new Error(`Branch "${target}" resolved to ${matches.length} rows; use the exact CRM name or slug with --branch=.`);
      }
      return matches[0];
    });
    if (new Set(selected.map((branch) => branch.businessGroupId)).size !== 1) {
      throw new Error("Selected branches do not belong to one business group.");
    }
    if (selected.some((branch) => branch.localStores.length === 0)) {
      throw new Error("Every selected branch must have at least one active CRM store.");
    }
    const products = await tx.localProduct.findMany({
      where: { branchId: { in: selected.map((branch) => branch.id) }, archived: false },
      orderBy: [{ branchId: "asc" }, { name: "asc" }],
    });
    return { branches: selected, products };
  }, { isolationLevel: "RepeatableRead" });

  const byBranch = new Map(snapshot.branches.map((branch) => [
    branch.id,
    snapshot.products.filter((product) => product.branchId === branch.id),
  ]));
  const oilByBranch = new Map([...byBranch].map(([branchId, products]) => [
    branchId,
    products.filter((product) => {
      const problems = identity.storefrontPublicationReadiness(product);
      return !problems.includes("Товар не распознан как моторное масло.");
    }),
  ]));

  const [leftBranch, rightBranch] = snapshot.branches;
  const rightProducts = oilByBranch.get(rightBranch.id) ?? [];
  const rightIndex = new Map();
  for (const product of rightProducts) {
    for (const key of candidateKeys(product)) {
      const values = rightIndex.get(key) ?? [];
      values.push(product);
      rightIndex.set(key, values);
    }
  }

  const pairs = [];
  const ambiguous = [];
  const unmatched = [];
  for (const product of oilByBranch.get(leftBranch.id) ?? []) {
    const candidates = [...new Map(candidateKeys(product)
      .flatMap((key) => rightIndex.get(key) ?? [])
      .map((candidate) => [candidate.id, candidate])).values()]
      .flatMap((candidate) => {
        const evidence = identity.storefrontIdentityEvidence(product, candidate, {
          sourceLineage: product.sourceProductId === candidate.id || candidate.sourceProductId === product.id,
        });
        return evidence ? [{ candidate, evidence }] : [];
      });
    if (candidates.length === 1) {
      const candidate = candidates[0];
      pairs.push({
        left: compactProduct(product),
        right: compactProduct(candidate.candidate),
        evidence: candidate.evidence,
        conflicts: identity.storefrontTechnicalConflicts(product, [candidate.candidate]),
      });
    } else if (candidates.length > 1) {
      ambiguous.push({ left: compactProduct(product), candidates: candidates.map((item) => ({ ...compactProduct(item.candidate), evidence: item.evidence })) });
    } else {
      unmatched.push(compactProduct(product));
    }
  }

  const report = {
    mode: "READ_ONLY",
    generatedAt: new Date().toISOString(),
    businessGroupId: snapshot.branches[0].businessGroupId,
    branches: snapshot.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      shortName: branch.shortName,
      slug: branch.slug,
      address: branch.address,
      phone: branch.phone,
      activeStores: branch.localStores,
      suggestedStoreId: branch.localStores.length === 1
        ? branch.localStores[0].id
        : branch.localStores.filter((store) => store.isMain).length === 1
          ? branch.localStores.find((store) => store.isMain)?.id ?? null
          : null,
      catalogRows: byBranch.get(branch.id)?.length ?? 0,
      motorOilCandidates: oilByBranch.get(branch.id)?.length ?? 0,
      publicationReady: (oilByBranch.get(branch.id) ?? []).filter((product) => identity.storefrontPublicationReadiness(product).length === 0).length,
    })),
    matching: summaryOnly
      ? {
          counts: { confirmedCandidates: pairs.length, ambiguous: ambiguous.length, unmatchedFromFirstBranch: unmatched.length },
          confirmedCandidateSample: pairs.slice(0, 10),
          ambiguousSample: ambiguous.slice(0, 10),
          unmatchedSample: unmatched.slice(0, 10),
        }
      : {
          confirmedCandidates: pairs,
          ambiguous,
          unmatchedFromFirstBranch: unmatched,
          counts: { confirmedCandidates: pairs.length, ambiguous: ambiguous.length, unmatchedFromFirstBranch: unmatched.length },
        },
    nextStep: "Review the report, choose explicit store IDs, then configure the storefront through the owner-only settings/API after the schema migration is approved.",
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
