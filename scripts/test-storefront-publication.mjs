#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") } });
const identity = await jiti.import("../src/lib/storefront-product-identity.ts");
const publicOilModule = await jiti.import("../src/lib/public-oil.ts");
const storefrontImage = await jiti.import("../src/lib/storefront-image.ts");

const selectedImageHref = storefrontImage.storefrontPublicImageHref("stable-public-id", "photo-id");
assert.equal(storefrontImage.isSafeStorefrontImageContentType("image/jpeg"), true);
assert.equal(storefrontImage.isSafeStorefrontImageContentType("image/svg+xml"), false);
assert.equal(selectedImageHref, "/api/public/oils/stable-public-id/image/photo-id");
assert.equal(storefrontImage.selectedStorefrontPublicPhotoId("stable-public-id", selectedImageHref), "photo-id");
assert.equal(storefrontImage.selectedStorefrontPublicPhotoId("another-product", selectedImageHref), null);
assert.equal(storefrontImage.selectedStorefrontPublicPhotoId("stable-public-id", `${selectedImageHref}?raw=1`), null);

const base = {
  id: "left",
  branchId: "branch-left",
  name: "Shell Helix Ultra 5W-40 4 л",
  groupPath: "Масла/Моторные масла",
  entityType: "product",
  brand: "Shell",
  article: "550040755",
  uomName: "шт",
  packageVolume: "4 л",
  sae: "5W-40",
  apiSpec: "SP",
  acea: "A3/B4",
  salePriceCents: 499000,
  archived: false,
};

assert.equal(identity.storefrontIdentityEvidence(base, { ...base, id: "right", branchId: "branch-right" }), "BRAND_ARTICLE");
assert.equal(identity.storefrontIdentityEvidence(base, { ...base, packageVolume: "1 л" }), null, "different package is a different SKU");
assert.equal(identity.storefrontIdentityEvidence(
  { ...base, article: null, barcodeEan13: "4601234567890" },
  { ...base, id: "right", article: null, barcodeEan13: "4601234567890" }
), "BARCODE");
assert.equal(identity.storefrontIdentityEvidence(
  { ...base, article: null, barcodeEan13: "4601234567890" },
  { ...base, id: "right", article: null, brand: "Mobil", barcodeEan13: "4601234567890" }
), null, "barcode never merges conflicting brands");
assert.deepEqual(identity.storefrontTechnicalConflicts(base, [{ ...base, sae: "5W-30" }]), ["SAE"]);
assert.deepEqual(identity.storefrontPublicationReadiness(base), []);
assert.ok(identity.storefrontPublicationReadiness({ ...base, packageVolume: null }).some((problem) => /facовк|fasовк|фасовк/u.test(problem)));
assert.ok(identity.storefrontPublicationReadiness({ ...base, salePriceCents: 0 }).some((problem) => /цен/u.test(problem)));

const now = new Date("2026-09-11T12:00:00.000Z");
const storefront = {
  branches: [
    {
      id: "public-dacha",
      branchId: "branch-dacha",
      publicName: "Дачная",
      publicAddress: "Адрес 1",
      publicPhone: "+70000000001",
      branch: { name: "Филиал 1", shortName: "Дачная", address: null, phone: null },
      stores: [{ storeId: "store-dacha" }],
    },
    {
      id: "public-gagarina",
      branchId: "branch-gagarina",
      publicName: "Гагарина",
      publicAddress: "Адрес 2",
      publicPhone: "+70000000002",
      branch: { name: "Филиал 2", shortName: "Гагарина", address: null, phone: null },
      stores: [{ storeId: "store-gagarina" }],
    },
  ],
};
const row = {
  id: "stable-public-id",
  slug: "oil-stable-public-id",
  publicName: null,
  publicDescription: null,
  publicImageHref: null,
  updatedAt: now,
  contentSource: {
    ...base,
    id: "source-product",
    branchId: "branch-dacha",
    description: "Из CRM",
    currencyName: "руб.",
  },
  bindings: [
    {
      branchId: "branch-dacha",
      localProduct: {
        ...base,
        id: "source-product",
        branchId: "branch-dacha",
        currencyName: "руб.",
        updatedAt: now,
        stockBalances: [
          { storeId: "store-dacha", available: { toNumber: () => 27.4 }, syncedAt: now },
          { storeId: "internal-dacha", available: { toNumber: () => 999 }, syncedAt: now },
        ],
      },
    },
    {
      branchId: "branch-gagarina",
      localProduct: {
        ...base,
        id: "gagarina-product",
        branchId: "branch-gagarina",
        salePriceCents: 529000,
        currencyName: "руб.",
        updatedAt: now,
        stockBalances: [{ storeId: "store-gagarina", available: { toNumber: () => 8.6 }, syncedAt: now }],
      },
    },
  ],
};
const publicCard = publicOilModule.mapStorefrontOilCard(row, storefront);
assert.equal(publicCard.id, "stable-public-id");
assert.equal(publicCard.offers.length, 2, "two branch rows become one public card with two offers");
assert.equal(publicCard.offers[0].available, 27.4, "fractional litres are preserved");
assert.equal(publicCard.offers[1].available, 8.6);
assert.equal(publicCard.available, 36);
assert.equal(publicCard.pricesDiffer, true);
assert.equal(publicCard.price, null, "a shared price is not invented when branch prices differ");
assert.deepEqual(publicCard.offers.map((offer) => offer.price), [4990, 5290]);
assert.equal("buyPrice" in publicCard, false, "cost data is not exposed");
assert.equal("supplier" in publicCard, false, "supplier data is not exposed");
const imageCard = publicOilModule.mapStorefrontOilCard({ ...row, publicImageHref: selectedImageHref }, storefront);
assert.equal(imageCard.imageHref, selectedImageHref, "only the explicitly selected public image href reaches the DTO");
const renamedCard = publicOilModule.mapStorefrontOilCard({ ...row, contentSource: { ...row.contentSource, name: "Новое название" } }, storefront);
assert.equal(renamedCard.id, publicCard.id, "renaming the source never changes the public id");
const missingBindingCard = publicOilModule.mapStorefrontOilCard({ ...row, bindings: row.bindings.slice(0, 1) }, storefront);
assert.equal(missingBindingCard.offers[1].availability, "NOT_LISTED");
assert.equal(missingBindingCard.offers[1].available, null, "missing link is not reported as physical zero");
const zeroCard = publicOilModule.mapStorefrontOilCard({
  ...row,
  bindings: [{
    ...row.bindings[0],
    localProduct: { ...row.bindings[0].localProduct, stockBalances: [] },
  }],
}, { ...storefront, branches: storefront.branches.slice(0, 1) });
assert.equal(zeroCard.offers[0].availability, "OUT_OF_STOCK");
assert.equal(zeroCard.offers[0].available, 0, "a successful read with no balance is canonical zero");

const clientApp = fs.readFileSync(resolve(root, "src/app/client-site/ClientSiteApp.tsx"), "utf8");
const clientApi = fs.readFileSync(resolve(root, "src/lib/client-site-api.ts"), "utf8");
const publicOil = fs.readFileSync(resolve(root, "src/lib/public-oil.ts"), "utf8");
const publicStorefrontImage = fs.readFileSync(resolve(root, "src/lib/public-storefront-image.ts"), "utf8");
const publicStorefrontImageRoute = fs.readFileSync(resolve(root, "src/app/api/public/oils/[id]/image/[photoId]/route.ts"), "utf8");
const globalCss = fs.readFileSync(resolve(root, "src/app/globals.css"), "utf8");
const clientCss = fs.readFileSync(resolve(root, "src/app/client-site/styles.css"), "utf8");
const clientCatchAllPage = fs.readFileSync(resolve(root, "src/app/client-site/[...segments]/page.tsx"), "utf8");
const rootLayout = fs.readFileSync(resolve(root, "src/app/layout.tsx"), "utf8");
const platformChrome = fs.readFileSync(resolve(root, "src/components/platform/PlatformChrome.tsx"), "utf8");
const storefrontPublication = fs.readFileSync(resolve(root, "src/lib/storefront-publication.ts"), "utf8");
const migration = fs.readFileSync(resolve(root, "prisma/migrations/20260911150000_storefront_oil_publication/migration.sql"), "utf8");
const photoPurposeMigration = fs.readFileSync(resolve(root, "prisma/migrations/20260912180000_product_photo_purpose/migration.sql"), "utf8");

assert.doesNotMatch(clientApp, /OILS\s*=\s*DEMO_OILS/u, "public UI must not restore demo products");
assert.doesNotMatch(clientApi, /Math\.floor\s*\(/u, "decimal availability must not be truncated");
assert.match(publicOil, /publicationState:\s*"PUBLISHED"/u, "public catalog must query only published cards");
assert.match(publicOil, /allowedStoreIds/u, "availability must use the configured store allowlist");
assert.match(publicOil, /balance\.available/u, "canonical available is used directly");
assert.match(publicStorefrontImage, /purpose:\s*"STOREFRONT"/u, "Avito photos must never be served by the public image route");
assert.doesNotMatch(publicStorefrontImage, /prisma\.storefrontProduct\.findFirst/u, "a public image miss must use one database query");
assert.match(storefrontPublication, /productId:\s*localProductId,\s*purpose:\s*"STOREFRONT"/u, "only storefront photos can be selected for the site");
assert.match(clientApp, /STOREFRONT_IMAGE_RETRY_DELAYS_MS/u, "storefront images retry transient failures");
assert.match(clientApp, /OilImageSkeleton/u, "storefront uses a neutral loading skeleton instead of a false product photo");
assert.match(clientApp, /width=\$\{imageWidth\}/u, "storefront requests display-sized product images");
assert.match(clientApp, /fetchPriority=\{product \|\| priority \? 'high' : 'auto'\}/u, "visible storefront photos receive high fetch priority");
assert.match(clientApp, /priority=\{idx < 3\}/u, "only the first visible storefront row competes for high-priority bandwidth");
assert.match(clientApp, /contentVisibility:\s*'auto'/u, "offscreen storefront cards skip unnecessary rendering work");
assert.match(clientApp, /new IntersectionObserver/u, "storefront photos load only near the viewport");
assert.match(clientApp, /retry=\$\{imageAttempt\}/u, "storefront image retries bypass a failed browser cache entry");
assert.match(clientApp, /\/api\/oils\?limit=24&offset=0/u, "the first catalog response is intentionally small");
assert.match(clientApp, /requestIdleCallback/u, "remaining catalog pages wait until initial rendering is idle");
assert.match(clientApp, /catalogLoadingMore \? `\$\{count\}\+` : count/u, "facet counts must not look final while catalog pages are still loading");
assert.match(clientApp, /window\.history\.pushState/u, "client-site links use real browser paths");
assert.doesNotMatch(clientApp, /window\.location\.hash\s*=/u, "new navigation must not create legacy hash URLs");
assert.match(clientCatchAllPage, /initialPath/u, "direct client-site routes preserve their server-known path");
assert.match(clientApi, /clientOilOffset/u, "catalog paging forwards an explicit offset");
assert.match(publicOil, /select:\s*STOREFRONT_OIL_ROW_SELECT/u, "catalog queries only the CRM fields exposed publicly");
assert.doesNotMatch(globalCss, /be\.cdn\.yclients\.com/u, "unrelated Yclients styles must not block storefront rendering");
assert.doesNotMatch(clientCss, /fonts\.googleapis\.com/u, "storefront fonts must use the bundled local files");
assert.doesNotMatch(rootLayout, /MessengerProvider|PlatformShell|MessengerWidget/u, "the root layout must not bundle employee chrome into every public page");
assert.match(platformChrome, /pathname\.startsWith\("\/client-site\/"\)/u, "all direct storefront routes bypass employee chrome");
assert.match(publicStorefrontImageRoute, /resize\(\{ width, height: width, fit: "inside", withoutEnlargement: true \}\)/u, "public image route produces bounded previews");
assert.match(publicStorefrontImageRoute, /webp\(\{ quality: 84/u, "public image route serves efficient WebP previews");
assert.match(publicStorefrontImageRoute, /public, max-age=31536000, immutable/u, "immutable photo ids are cached by browsers and the CDN");
assert.match(publicStorefrontImageRoute, /STOREFRONT_IMAGE_CACHE_MAX_BYTES/u, "derived storefront previews use a bounded server memory cache");
assert.match(publicStorefrontImageRoute, /X-Storefront-Image-Cache/u, "public image responses expose cache diagnostics");
assert.match(migration, /CREATE TABLE "storefront_products"/u);
assert.doesNotMatch(migration, /^\s*(INSERT|UPDATE|DELETE)\s/imu, "expand migration must not backfill or publish data");
assert.match(photoPurposeMigration, /ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'AVITO'/u, "existing photos become Avito photos safely");

console.log("storefront publication tests passed");
