#!/usr/bin/env node

import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDatabaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl) throw new Error("DATABASE_URL is required for the disposable storefront integration database.");
const parsedDatabaseUrl = new URL(testDatabaseUrl);
if (
  !["127.0.0.1", "localhost", "::1"].includes(parsedDatabaseUrl.hostname.toLowerCase())
  || !parsedDatabaseUrl.pathname.toLowerCase().includes("storefront_test")
) {
  throw new Error("Storefront DB integration tests are restricted to a localhost database named storefront_test.");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") } });
const publication = await jiti.import("../src/lib/storefront-publication.ts");
const publicOil = await jiti.import("../src/lib/public-oil.ts");
const publicStorefrontImage = await jiti.import("../src/lib/public-storefront-image.ts");
const tenantStore = await jiti.import("../src/lib/request-tenant-store.ts");
const dbModule = await jiti.import("../src/lib/db.ts");
const setup = new PrismaClient();
const appPrisma = dbModule.prisma;

process.env.PUBLIC_STOREFRONT_SLUG = "integration-storefront";

const group = await setup.businessGroup.create({
  data: { id: "group-storefront-test", name: "TGM test", slug: "tgm-storefront-test" },
});
const branches = await Promise.all([
  setup.branch.create({
    data: {
      id: "branch-dacha-test",
      businessGroupId: group.id,
      name: "Филиал Дачная",
      shortName: "Дачная",
      slug: "dacha-test",
      address: "Дачная, тест",
      phone: "+70000000001",
    },
  }),
  setup.branch.create({
    data: {
      id: "branch-gagarina-test",
      businessGroupId: group.id,
      name: "Филиал Гагарина",
      shortName: "Гагарина",
      slug: "gagarina-test",
      address: "Гагарина, тест",
      phone: "+70000000002",
    },
  }),
]);
const [dacha, gagarina] = branches;
const stores = await Promise.all([
  setup.localStore.create({ data: { id: "store-dacha-public", branchId: dacha.id, name: "Дачная основной", isMain: true } }),
  setup.localStore.create({ data: { id: "store-dacha-internal", branchId: dacha.id, name: "Дачная карантин" } }),
  setup.localStore.create({ data: { id: "store-gagarina-public", branchId: gagarina.id, name: "Гагарина основной", isMain: true } }),
]);
const [dachaPublicStore, dachaInternalStore, gagarinaPublicStore] = stores;
const storefront = await setup.storefront.create({
  data: {
    id: "storefront-test",
    businessGroupId: group.id,
    slug: process.env.PUBLIC_STOREFRONT_SLUG,
    name: "Integration storefront",
    branches: {
      create: [
        {
          id: "public-branch-dacha",
          branchId: dacha.id,
          publicName: "Дачная",
          publicAddress: dacha.address,
          publicPhone: dacha.phone,
          sortOrder: 0,
        },
        {
          id: "public-branch-gagarina",
          branchId: gagarina.id,
          publicName: "Гагарина",
          publicAddress: gagarina.address,
          publicPhone: gagarina.phone,
          sortOrder: 1,
        },
      ],
    },
  },
});
await setup.storefrontBranchStore.createMany({
  data: [
    { id: "public-store-dacha", storefrontBranchId: "public-branch-dacha", branchId: dacha.id, storeId: dachaPublicStore.id },
    { id: "public-store-gagarina", storefrontBranchId: "public-branch-gagarina", branchId: gagarina.id, storeId: gagarinaPublicStore.id },
  ],
});

function oil(id, branchId, overrides = {}) {
  return {
    id,
    branchId,
    entityType: "product",
    name: "Shell Helix Ultra 5W-40 4 л",
    groupPath: "Масла/Моторные масла",
    brand: "Shell",
    article: "550040755",
    uomName: "шт",
    packageVolume: "4 л",
    sae: "5W-40",
    apiSpec: "SP",
    acea: "A3/B4",
    salePriceCents: 499_000,
    currencyName: "руб.",
    ...overrides,
  };
}

const [dachaOil, gagarinaOil] = await Promise.all([
  setup.localProduct.create({ data: oil("oil-dacha", dacha.id) }),
  setup.localProduct.create({ data: oil("oil-gagarina", gagarina.id, { salePriceCents: 529_000 }) }),
]);
const dachaPhoto = await setup.localProductPhoto.create({
  data: {
    id: "photo-dacha-public",
    branchId: dacha.id,
    productId: dachaOil.id,
    fileName: "shell-helix.jpg",
    contentType: "image/jpeg",
    sizeBytes: 4,
    data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  },
});
await setup.localStockBalance.createMany({
  data: [
    { id: "balance-dacha-public", branchId: dacha.id, productId: dachaOil.id, storeId: dachaPublicStore.id, quantity: "30.000", reserve: "2.600", available: "27.400" },
    { id: "balance-dacha-internal", branchId: dacha.id, productId: dachaOil.id, storeId: dachaInternalStore.id, quantity: "999.000", reserve: "0", available: "999.000" },
    { id: "balance-gagarina-public", branchId: gagarina.id, productId: gagarinaOil.id, storeId: gagarinaPublicStore.id, quantity: "10.000", reserve: "1.400", available: "8.600" },
  ],
});

function summary(branch) {
  return {
    id: branch.id,
    businessGroupId: group.id,
    name: branch.name,
    shortName: branch.shortName,
    displayName: branch.shortName,
    slug: branch.slug,
    status: branch.status,
    address: branch.address,
    timezone: branch.timezone,
    phone: branch.phone,
    email: branch.email,
    legacyOrganizationId: branch.legacyOrganizationId,
  };
}

function context(branch, owner = true) {
  return {
    user: { login: owner ? "owner-test" : "employee-test", name: "Test", role: owner ? "owner" : "admin" },
    userId: owner ? "owner-test" : "employee-test",
    businessGroupId: group.id,
    groupRole: owner ? "group_owner" : null,
    branchRole: owner ? "branch_owner" : "employee",
    permissions: [],
    isGroupOwner: owner,
    canManageBranches: owner,
    mode: "branch",
    branchId: branch.id,
    organizationId: null,
    branch: summary(branch),
    branches: branches.map(summary),
  };
}

function inBranch(branch, operation, owner = true) {
  return tenantStore.runWithRequestTenant({
    mode: "branch",
    branchId: branch.id,
    organizationId: null,
    allowedBranchIds: [branch.id],
    businessGroupId: group.id,
    userId: owner ? "owner-test" : "employee-test",
    permissions: [],
  }, () => operation(context(branch, owner)));
}

const firstPreview = await inBranch(dacha, (ctx) => publication.previewStorefrontPublication(ctx, {
  state: "PUBLISHED",
  productIds: [dachaOil.id],
}));
assert.equal(firstPreview.readyItems, 1);
const firstApply = await inBranch(dacha, (ctx) => publication.applyStorefrontPublication(ctx, firstPreview.batchId));
assert.equal(firstApply.appliedItems, 1);

const secondPreview = await inBranch(gagarina, (ctx) => publication.previewStorefrontPublication(ctx, {
  state: "PUBLISHED",
  productIds: [gagarinaOil.id],
}));
assert.equal(secondPreview.items[0].matchingEvidence, "BRAND_ARTICLE");
await inBranch(gagarina, (ctx) => publication.applyStorefrontPublication(ctx, secondPreview.batchId));
assert.equal(await setup.storefrontProduct.count({ where: { storefrontId: storefront.id } }), 1);
assert.equal(await setup.storefrontProductBinding.count(), 2);

const imageStatus = await inBranch(dacha, (ctx) => publication.setStorefrontPublicImage(ctx, dachaOil.id, dachaPhoto.id));
assert.equal(imageStatus.publicImagePhotoId, dachaPhoto.id);
assert.equal(imageStatus.photoCandidates.length, 1);
assert.equal(imageStatus.photoCandidates[0].id, dachaPhoto.id);
const selectedImage = await publicStorefrontImage.getSelectedPublicStorefrontImage(imageStatus.storefrontProductId, dachaPhoto.id);
assert.equal(selectedImage.contentType, "image/jpeg");
assert.deepEqual(Buffer.from(selectedImage.data), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

let list = await publicOil.listPublicOils({ limit: 10 });
assert.equal(list.total, 1);
const stableId = list.oils[0].id;
assert.equal(list.oils[0].imageHref, `/api/public/oils/${stableId}/image/${dachaPhoto.id}`);
assert.deepEqual(list.oils[0].offers.map((offer) => offer.available), [27.4, 8.6]);
assert.deepEqual(list.oils[0].offers.map((offer) => offer.price), [4990, 5290]);
assert.equal(list.oils[0].price, null);
assert.equal(list.oils[0].available, 36);
assert.equal(list.oils[0].offers.some((offer) => offer.available === 999), false, "non-allowlisted store must not leak");
assert.equal("buyPriceCents" in list.oils[0], false);

await setup.localProduct.update({ where: { id: dachaOil.id }, data: { name: "Shell Helix Ultra renamed 5W-40 4 л" } });
assert.equal((await publicOil.getPublicOilById(stableId)).id, stableId);
assert.match((await publicOil.getPublicOilById(stableId)).name, /renamed/u);

await setup.localProduct.update({ where: { id: gagarinaOil.id }, data: { name: "Shell Helix Ultra source G 5W-40 4 л" } });
await inBranch(gagarina, (ctx) => publication.changeStorefrontProductContentSource(ctx, gagarinaOil.id));
assert.match((await publicOil.getPublicOilById(stableId)).name, /source G/u);
assert.equal((await setup.storefrontProductAudit.count({ where: { action: "CHANGE_CONTENT_SOURCE" } })), 1);

await setup.localStockBalance.update({
  where: { productId_storeId: { productId: dachaOil.id, storeId: dachaPublicStore.id } },
  data: { reserve: "25.000", available: "5.200" },
});
list = await publicOil.listPublicOils({ limit: 10 });
assert.equal(list.oils[0].offers[0].available, 5.2, "canonical available is not reserve-subtracted twice");
await setup.localStockBalance.update({
  where: { productId_storeId: { productId: dachaOil.id, storeId: dachaPublicStore.id } },
  data: { available: "0" },
});
list = await publicOil.listPublicOils({ limit: 10 });
assert.equal(list.oils[0].offers[0].availability, "OUT_OF_STOCK");
assert.equal(list.total, 1, "zero stock does not hide the card");

const hidePreview = await inBranch(gagarina, (ctx) => publication.previewStorefrontPublication(ctx, {
  state: "HIDDEN",
  productIds: [gagarinaOil.id],
}));
await inBranch(gagarina, (ctx) => publication.applyStorefrontPublication(ctx, hidePreview.batchId));
assert.equal((await publicOil.listPublicOils({ limit: 10 })).total, 0);
assert.equal(await publicOil.getPublicOilById(stableId), null);
assert.equal(await publicStorefrontImage.getSelectedPublicStorefrontImage(stableId, dachaPhoto.id), null);
assert.deepEqual((await publicOil.getPublicOilFilters()).brands, []);

const republishPreview = await inBranch(dacha, (ctx) => publication.previewStorefrontPublication(ctx, {
  state: "PUBLISHED",
  productIds: [dachaOil.id],
}));
const republish = await inBranch(dacha, (ctx) => publication.applyStorefrontPublication(ctx, republishPreview.batchId));
const repeat = await inBranch(dacha, (ctx) => publication.applyStorefrontPublication(ctx, republishPreview.batchId));
assert.equal(republish.status, "APPLIED");
assert.deepEqual(repeat, republish, "reapplying a batch is idempotent");
assert.equal(await setup.storefrontProduct.count({ where: { storefrontId: storefront.id } }), 1);

const oneLiter = await setup.localProduct.create({ data: oil("oil-dacha-one-liter", dacha.id, { packageVolume: "1 л", name: "Shell Helix Ultra 5W-40 1 л" }) });
const oneLiterPreview = await inBranch(dacha, (ctx) => publication.previewStorefrontPublication(ctx, {
  state: "PUBLISHED",
  productIds: [oneLiter.id],
}));
assert.equal(oneLiterPreview.items[0].storefrontProductId, null, "different package must not merge");
await inBranch(dacha, (ctx) => publication.applyStorefrontPublication(ctx, oneLiterPreview.batchId));
assert.equal(await setup.storefrontProduct.count({ where: { storefrontId: storefront.id } }), 2);
const oneLiterCard = (await publicOil.listPublicOils({ limit: 10 })).oils.find((item) => item.id !== stableId);
assert.equal(oneLiterCard.offers[1].availability, "NOT_LISTED");
assert.equal(oneLiterCard.offers[1].available, null);

const stalePreview = await inBranch(dacha, (ctx) => publication.previewStorefrontPublication(ctx, {
  state: "HIDDEN",
  productIds: [oneLiter.id],
}));
await setup.localProduct.update({ where: { id: oneLiter.id }, data: { description: "changed after preview" } });
const staleApply = await inBranch(dacha, (ctx) => publication.applyStorefrontPublication(ctx, stalePreview.batchId));
assert.equal(staleApply.failedItems, 1);
assert.equal(staleApply.items[0].result, "CONFLICT");

await assert.rejects(
  () => inBranch(dacha, (ctx) => publication.previewStorefrontPublication(ctx, { state: "HIDDEN", productIds: [dachaOil.id] }), false),
  (error) => error?.status === 403
);

console.log("storefront publication database integration tests passed");
await Promise.all([setup.$disconnect(), appPrisma.$disconnect()]);
